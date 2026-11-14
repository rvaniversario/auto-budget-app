// POST /delete-account: permanently deletes the caller's account and every
// online record (sync rows cascade from auth.users). Data on the user's
// devices is not touched; the app keeps or clears it as the user chose.

import { adminClient, errorResponse, getCaller, json, preflight } from '../_shared/http.ts'

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return errorResponse(req, 405, 'Use POST')

  const caller = await getCaller(req)
  if (!caller) return errorResponse(req, 401, 'Sign in required')

  const { error } = await adminClient().auth.admin.deleteUser(caller.user.id)
  if (error) {
    console.error('delete-account failed', { user: caller.user.id, error })
    return errorResponse(req, 500, "Couldn't delete the account. Try again later.")
  }
  return json(req, { deleted: true })
})
