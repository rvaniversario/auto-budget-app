// Premium status. Premium is bought only through Google Play in the Android
// app (verify-play-purchase); this function reads it for both apps.
//
//   GET  /premium/status       -> { entitlement, purchases, serverTime }
//                                 Without sign-in: { entitlement: null, purchases: [] }
//   POST /premium/start-trial  -> { entitlement }  (409 when already used or owned)

import { adminClient, errorResponse, getCaller, json, preflight } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  const route = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop()
  const caller = await getCaller(req)

  try {
    if (route === 'status' && req.method === 'GET') {
      if (!caller) return json(req, { entitlement: null, purchases: [], serverTime: new Date().toISOString() })

      // Testers listed in tester_grants get Premium on sign-in with a matching verified email.
      const grant = await adminClient().rpc('apply_tester_grant', { p_user_id: caller.user.id })
      if (grant.error) console.error('apply_tester_grant failed', { user: caller.user.id, err: grant.error })

      const [ent, purchases] = await Promise.all([
        caller.db.from('entitlements').select('plan, source, starts_at, expires_at, trial_used, legacy_sync').maybeSingle(),
        caller.db
          .from('purchases')
          .select('id, provider, order_id, status, paid_at, created_at')
          .in('status', ['paid', 'refunded'])
          .order('created_at', { ascending: false }),
      ])
      if (ent.error) throw ent.error
      if (purchases.error) throw purchases.error
      return json(req, {
        entitlement: ent.data ?? { plan: 'free', source: null, starts_at: null, expires_at: null, trial_used: false, legacy_sync: false },
        purchases: (purchases.data ?? []).map((p) => ({
          id: p.id,
          provider: p.provider,
          orderId: p.order_id,
          status: p.status,
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
