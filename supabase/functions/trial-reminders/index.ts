// POST /trial-reminders: run hourly by a scheduler (see DEPLOY.md). Emails
// each user whose free trial ends within the next 24 hours, once.
// Protected by CRON_SECRET; never called by the app.

import { adminClient } from '../_shared/http.ts'
import { sendEmail, trialEndingEmail } from '../_shared/email.ts'

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) {
    return new Response('Forbidden', { status: 403 })
  }
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '')
  const admin = adminClient()
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const [{ data: due, error }, { data: product }] = await Promise.all([
    admin
      .from('entitlements')
      .select('user_id, expires_at')
      .eq('plan', 'premium')
      .eq('source', 'trial')
      .is('trial_reminder_sent_at', null)
      .gt('expires_at', now.toISOString())
      .lte('expires_at', in24h.toISOString()),
    admin.from('products').select('amount').eq('code', 'premium_lifetime').single(),
  ])
  if (error) {
    console.error('trial-reminders query failed', error)
    return new Response(JSON.stringify({ error: 'query failed' }), { status: 500 })
  }

  let sent = 0
  for (const row of due ?? []) {
    const { data: user } = await admin.auth.admin.getUserById(row.user_id)
    const email = user?.user?.email
    if (!email) continue
    const ok = await sendEmail(trialEndingEmail({ to: email, endsAt: new Date(row.expires_at), price: product?.amount ?? 39900, appUrl }))
    if (ok) {
      await admin.from('entitlements').update({ trial_reminder_sent_at: new Date().toISOString() }).eq('user_id', row.user_id)
      sent++
    }
  }
  return new Response(JSON.stringify({ due: due?.length ?? 0, sent }), { headers: { 'Content-Type': 'application/json' } })
})
