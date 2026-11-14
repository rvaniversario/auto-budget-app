// POST /create-checkout -> { url }
//
// Starts a one-time payment for Premium. The price always comes from the
// products table, never from the client. Refuses accounts that already own
// Premium.

import { adminClient, errorResponse, getCaller, json, preflight } from '../_shared/http.ts'
import { paymentProvider } from '../_shared/payments.ts'

const PRODUCT = 'premium_lifetime'

/** The app's public address, for the checkout's return links. */
function appUrl(req: Request): string | null {
  const configured = Deno.env.get('APP_URL')?.replace(/\/+$/, '')
  if (configured) return configured
  // Development fallback: trust the Origin only when it is listed.
  const origin = req.headers.get('Origin') ?? ''
  const allowed = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map((o) => o.trim())
  return origin && allowed.includes(origin) ? origin : null
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return errorResponse(req, 405, 'Use POST')

  const caller = await getCaller(req)
  if (!caller) return errorResponse(req, 401, 'Sign in required')
  const base = appUrl(req)
  if (!base) return errorResponse(req, 500, 'APP_URL is not configured')

  const admin = adminClient()
  try {
    const { data: ent, error: entErr } = await admin
      .from('entitlements')
      .select('plan, expires_at')
      .eq('user_id', caller.user.id)
      .maybeSingle()
    if (entErr) throw entErr
    if (ent?.plan === 'premium' && ent.expires_at === null) {
      return errorResponse(req, 409, 'Premium is already unlocked on this account.')
    }

    const { data: product, error: prodErr } = await admin
      .from('products')
      .select('code, name, amount, currency')
      .eq('code', PRODUCT)
      .eq('active', true)
      .single()
    if (prodErr || !product) throw prodErr ?? new Error('Product not found')

    const provider = paymentProvider()
    const { data: purchase, error: insErr } = await admin
      .from('purchases')
      .insert({ user_id: caller.user.id, provider: provider.name, product_code: product.code, amount: product.amount, currency: product.currency })
      .select('id')
      .single()
    if (insErr || !purchase) throw insErr

    const checkout = await provider.createCheckout({
      purchaseId: purchase.id,
      userId: caller.user.id,
      email: caller.user.email ?? null,
      product,
      successUrl: `${base}/premium/success?purchase=${purchase.id}`,
      cancelUrl: `${base}/premium`,
    })
    await admin.from('purchases').update({ provider_checkout_id: checkout.checkoutId }).eq('id', purchase.id)
    return json(req, { url: checkout.url, purchaseId: purchase.id })
  } catch (err) {
    console.error('create-checkout failed', { user: caller.user.id, err })
    return errorResponse(req, 502, "Couldn't start the payment. Try again in a moment.")
  }
})
