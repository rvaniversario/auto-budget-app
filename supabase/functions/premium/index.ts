// Premium status.
//
//   GET  /premium/status       -> { entitlement, product, receipts, serverTime }
//                                 Without sign-in: { entitlement: null, product, receipts: [] }
//   POST /premium/start-trial  -> { entitlement }  (409 when already used or owned)

import { adminClient, errorResponse, getCaller, json, preflight } from '../_shared/http.ts'
import { methodLabel } from '../_shared/payments.ts'

const PRODUCT = 'premium_lifetime'

async function activeProduct() {
  const { data, error } = await adminClient()
    .from('products')
    .select('code, name, amount, currency')
    .eq('code', PRODUCT)
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  return data
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const route = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop()
  const caller = await getCaller(req)

  try {
    if (route === 'status' && req.method === 'GET') {
      const product = await activeProduct()
      if (!caller) return json(req, { entitlement: null, product, receipts: [], serverTime: new Date().toISOString() })

      const [ent, purchases] = await Promise.all([
        caller.db.from('entitlements').select('plan, source, starts_at, expires_at, trial_used').maybeSingle(),
        caller.db
          .from('purchases')
          .select('id, product_code, amount, currency, status, payment_method, paid_at, created_at')
          .in('status', ['paid', 'refunded'])
          .order('created_at', { ascending: false }),
      ])
      if (ent.error) throw ent.error
      if (purchases.error) throw purchases.error
      return json(req, {
        entitlement: ent.data ?? { plan: 'free', source: null, starts_at: null, expires_at: null, trial_used: false },
        product,
        receipts: (purchases.data ?? []).map((p) => ({
          id: p.id,
          item: product?.name ?? 'Auto Budget Premium',
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          method: methodLabel(p.payment_method),
          date: p.paid_at ?? p.created_at,
        })),
        serverTime: new Date().toISOString(),
      })
    }

    if (route === 'start-trial' && req.method === 'POST') {
      if (!caller) return errorResponse(req, 401, 'Sign in required')
      const { data, error } = await caller.db.rpc('start_trial')
      if (error) {
        if (error.hint === 'trial_used') return errorResponse(req, 409, 'The free trial has already been used on this account.')
        if (error.hint === 'already_premium') return errorResponse(req, 409, 'Premium is already unlocked on this account.')
        throw error
      }
      return json(req, { entitlement: data })
    }

    return errorResponse(req, 404, 'Not found')
  } catch (err) {
    console.error('premium failed', { route, user: caller?.user.id, err })
    return errorResponse(req, 500, 'Something went wrong. Try again later.')
  }
})
