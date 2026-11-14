// Transactional email: the trial-ending notice. Purchase receipts come from
// Google Play. No marketing email is ever sent.
//
// Backends, first configured wins:
//   RESEND_API_KEY + EMAIL_FROM   production (https://resend.com)
//   MAILPIT_URL                   local development (the Supabase CLI's mail catcher)
// With neither, emails are logged and skipped.

export interface Email {
  to: string
  subject: string
  text: string
  html: string
}

export async function sendEmail(email: Email): Promise<boolean> {
  const from = Deno.env.get('EMAIL_FROM') ?? 'Auto Budget <no-reply@example.com>'
  const resendKey = Deno.env.get('RESEND_API_KEY')
  const mailpit = Deno.env.get('MAILPIT_URL')
  try {
    if (resendKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      })
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
      return true
    }
    if (mailpit) {
      const match = from.match(/^(.*)<(.+)>$/)
      const res = await fetch(`${mailpit.replace(/\/+$/, '')}/api/v1/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          From: { Email: (match?.[2] ?? from).trim(), Name: (match?.[1] ?? '').trim() },
          To: [{ Email: email.to }],
          Subject: email.subject,
          Text: email.text,
          HTML: email.html,
        }),
      })
      if (!res.ok) throw new Error(`Mailpit ${res.status}: ${await res.text()}`)
      return true
    }
    console.warn('No email backend configured; skipped:', email.subject, 'to', email.to)
    return false
  } catch (err) {
    console.error('Email failed', { subject: email.subject, err })
    return false
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function layout(title: string, rows: string): string {
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#F3F5F4;font-family:Inter,Arial,sans-serif;color:#14201B">
<div style="max-width:480px;margin:0 auto;padding:28px;border-radius:16px;background:#FFFFFF">
<h1 style="margin:0 0 16px;font-size:22px">${esc(title)}</h1>${rows}</div></body></html>`
}

const para = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5">${esc(s)}</p>`

const manila = (d: Date) => d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'long', year: 'numeric' })

export function trialEndingEmail(p: { to: string; endsAt: Date; appUrl: string }): Email {
  const when = manila(p.endsAt)
  return {
    to: p.to,
    subject: 'Your Auto Budget Premium trial ends tomorrow',
    text: [
      `Your free trial of Auto Budget Premium ends on ${when}.`,
      'Everything free keeps working, and nothing you made with Premium is deleted.',
      `To keep Premium, unlock it once in the Auto Budget Android app. It works on the web too: ${p.appUrl}/premium`,
    ].join('\n\n'),
    html: layout(
      'Your free trial ends tomorrow',
      para(`Your free trial of Auto Budget Premium ends on ${when}.`) +
        para('Everything free keeps working, and nothing you made with Premium is deleted.') +
        para('To keep Premium, unlock it once in the Auto Budget Android app. It works on the web too.') +
        `<p style="margin:0"><a href="${esc(p.appUrl)}/premium" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#0F6B4F;color:#FFFFFF;font-weight:600;text-decoration:none">See Premium</a></p>`,
    ),
  }
}
