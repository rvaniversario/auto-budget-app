// deno test supabase/functions/_shared/payments_test.ts
import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { hmacSha256Hex, InvalidSignatureError, PayMongoProvider } from './payments.ts'

const SECRET = 'whsk_test_secret'
const provider = new PayMongoProvider({ secretKey: 'sk_test_abc', webhookSecret: SECRET })

function paidEvent(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'evt_1',
      type: 'event',
      attributes: {
        type: 'checkout_session.payment.paid',
        livemode: false,
        data: {
          id: 'cs_1',
          type: 'checkout_session',
          attributes: {
            reference_number: 'purchase-1',
            metadata: { purchase_id: 'purchase-1', user_id: 'user-1' },
            payments: [
              { id: 'pay_failed', attributes: { status: 'failed', amount: 39900, currency: 'PHP' } },
              { id: 'pay_1', attributes: { status: 'paid', amount: 39900, currency: 'PHP', paid_at: 1_700_000_000, source: { type: 'gcash' } } },
            ],
          },
        },
        ...overrides,
      },
    },
  }
}

async function signed(body: string, opts: { live?: boolean; t?: number; secret?: string } = {}) {
  const t = opts.t ?? Math.floor(Date.now() / 1000)
  const sig = await hmacSha256Hex(opts.secret ?? SECRET, `${t}.${body}`)
  return new Headers({ 'Paymongo-Signature': opts.live ? `t=${t},te=,li=${sig}` : `t=${t},te=${sig},li=` })
}

Deno.test('a correctly signed paid event is parsed', async () => {
  const body = JSON.stringify(paidEvent())
  const event = await provider.parseWebhook(await signed(body), body)
  assertEquals(event.kind, 'paid')
  if (event.kind !== 'paid') return
  assertEquals(event.purchaseId, 'purchase-1')
  assertEquals(event.paymentId, 'pay_1')
  assertEquals(event.amount, 39900)
  assertEquals(event.method, 'gcash')
  assertEquals(event.paidAt?.getTime(), 1_700_000_000_000)
})

Deno.test('a bad signature is rejected', async () => {
  const body = JSON.stringify(paidEvent())
  await assertRejects(async () => provider.parseWebhook(await signed(body, { secret: 'wrong' }), body), InvalidSignatureError)
})

Deno.test('a tampered body is rejected', async () => {
  const body = JSON.stringify(paidEvent())
  const headers = await signed(body)
  await assertRejects(() => provider.parseWebhook(headers, body.replace('39900', '1')), InvalidSignatureError)
})

Deno.test('a live event is rejected by a test-mode key', async () => {
  const body = JSON.stringify(paidEvent({ livemode: true }))
  await assertRejects(async () => provider.parseWebhook(await signed(body, { live: true }), body), InvalidSignatureError)
})

Deno.test('an old signature is rejected', async () => {
  const body = JSON.stringify(paidEvent())
  const t = Math.floor(Date.now() / 1000) - 3 * 24 * 3600
  await assertRejects(async () => provider.parseWebhook(await signed(body, { t }), body), InvalidSignatureError)
})

Deno.test('a missing header is rejected', async () => {
  const body = JSON.stringify(paidEvent())
  await assertRejects(() => provider.parseWebhook(new Headers(), body), InvalidSignatureError)
})

Deno.test('a succeeded refund is parsed; other refund states are ignored', async () => {
  const refund = (status: string) =>
    JSON.stringify({
      data: {
        id: 'evt_r',
        attributes: {
          type: 'payment.refund.updated',
          livemode: false,
          data: { id: 'ref_1', type: 'refund', attributes: { status, amount: 39900, payment_id: 'pay_1' } },
        },
      },
    })
  const ok = refund('succeeded')
  const event = await provider.parseWebhook(await signed(ok), ok)
  assertEquals(event, { kind: 'refunded', eventId: 'evt_r', refundId: 'ref_1', paymentId: 'pay_1', amount: 39900, raw: JSON.parse(ok) })
  const pending = refund('processing')
  assertEquals((await provider.parseWebhook(await signed(pending), pending)).kind, 'ignored')
})

Deno.test('unrelated events are ignored', async () => {
  const body = JSON.stringify({ data: { id: 'evt_x', attributes: { type: 'payout.deposited', livemode: false, data: {} } } })
  assertEquals((await provider.parseWebhook(await signed(body), body)).kind, 'ignored')
})
