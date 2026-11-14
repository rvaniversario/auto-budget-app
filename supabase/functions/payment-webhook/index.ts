// POST /payment-webhook: called by the payment gateway, never by the app.
//
// Verifies the signature, processes each event once, and is the only place
// that grants Premium for a payment or takes it back after a refund.
// Failures are written to payment_webhook_log for investigation.

import { adminClient } from '../_shared/http.ts'
import { receiptEmail, sendEmail } from '../_shared/email.ts'
import { InvalidSignatureError, methodLabel, paymentProvider, type WebhookEvent } from '../_shared/payments.ts'

const ok = (body: Record<string, unknown> = { received: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Use POST', { status: 405 })
  const admin = adminClient()
  const provider = paymentProvider()
  const raw = await req.text()

  const log = async (error: string, event?: Partial<{ eventId: string; type: string }>) => {
    console.error('payment-webhook:', error)
    let payload: unknown = null
    try {
      payload = JSON.parse(raw)
    } catch {
      payload = { unparsed: raw.slice(0, 2000) }
    }
    await admin.from('payment_webhook_log').insert({
      provider: provider.name,
      event_id: event?.eventId ?? null,
      event_type: event?.type ?? null,
      error,
      payload,
    })
  }

  let event: WebhookEvent
  try {
    event = await provider.parseWebhook(req.headers, raw)
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      await log(`Rejected: ${err.message}`)
      return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 401 })
    }
    await log(`Could not parse: ${String(err)}`)
    return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
  }

  if (event.kind === 'ignored') return ok({ ignored: event.type })

  // Process each event (and each refund) once, even when the gateway retries.
  const dedupeId = event.kind === 'refunded' ? `refund:${event.refundId}` : event.eventId
  const { data: seen } = await admin.from('payment_events').select('id').eq('id', dedupeId).maybeSingle()
  if (seen) return ok({ duplicate: true })

  try {
    if (event.kind === 'paid') {
      const { data: result, error } = await admin.rpc('record_payment', {
        p_purchase_id: event.purchaseId,
        p_provider_payment_id: event.paymentId,
        p_amount: event.amount,
        p_currency: event.currency,
        p_payment_method: event.method,
        p_paid_at: event.paidAt?.toISOString() ?? null,
        p_raw: event.raw,
      })
      if (error) throw error
      if (result === 'unknown_purchase' || result === 'amount_mismatch') {
        await log(`Payment not applied: ${result} (purchase ${event.purchaseId}, payment ${event.paymentId})`, { eventId: event.eventId, type: 'paid' })
      }
      if (result === 'paid') await sendReceipt(admin, event.purchaseId)
    } else {
      const { data: result, error } = await admin.rpc('record_refund', {
        p_provider_payment_id: event.paymentId,
        p_refunded_amount: event.amount,
        p_raw: event.raw,
      })
      if (error) throw error
      if (result === 'unknown_payment') await log(`Refund for unknown payment ${event.paymentId}`, { eventId: event.eventId, type: 'refunded' })
    }
    await admin.from('payment_events').insert({ id: dedupeId, provider: provider.name, type: event.kind })
    return ok()
  } catch (err) {
    await log(`Processing failed: ${err instanceof Error ? err.message : JSON.stringify(err)}`, { eventId: event.eventId, type: event.kind })
    // Non-2xx makes the gateway retry later.
    return new Response(JSON.stringify({ error: 'processing failed' }), { status: 500 })
  }
})

async function sendReceipt(admin: ReturnType<typeof adminClient>, purchaseId: string) {
  const { data: p } = await admin
    .from('purchases')
    .select('id, user_id, amount, payment_method, paid_at, receipt_sent_at, products(name)')
    .eq('id', purchaseId)
    .single()
  if (!p || p.receipt_sent_at || !p.user_id) return
  const { data: user } = await admin.auth.admin.getUserById(p.user_id)
  const email = user?.user?.email
  if (!email) return
  const product = (p.products as unknown as { name: string } | null)?.name ?? 'Auto Budget Premium'
  const sent = await sendEmail(
    receiptEmail({
      to: email,
      product,
      amount: p.amount,
      method: methodLabel(p.payment_method),
      paidAt: new Date(p.paid_at ?? Date.now()),
      reference: p.id,
    }),
  )
  if (sent) await admin.from('purchases').update({ receipt_sent_at: new Date().toISOString() }).eq('id', p.id)
}
