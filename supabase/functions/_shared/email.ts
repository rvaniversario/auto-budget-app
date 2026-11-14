// Transactional email: payment receipts and the trial-ending notice. No
// marketing email is ever sent.
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

/** ₱399 or ₱1,234.50: peso sign, no decimals when whole. */
export function formatPeso(centavos: number): string {
  const whole = centavos % 100 === 0
  return `₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}

const manila = (d: Date) => d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'long', year: 'numeric' })

export function receiptEmail(p: { to: string; product: string; amount: number; method: string | null; paidAt: Date; reference: string }): Email {
  const lines = [
    ['Item', p.product],
    ['Amount', `${formatPeso(p.amount)} (one-time payment)`],
    ['Date', manila(p.paidAt)],
    ...(p.method ? [['Paid with', p.method]] : []),
    ['Reference', p.reference],
  ]
  const support = Deno.env.get('SUPPORT_EMAIL')
  const table = `<table style="width:100%;margin:0 0 16px;border-collapse:collapse;font-size:15px">${lines
    .map(([k, v]) => `<tr><td style="padding:6px 0;color:#55635D">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${esc(v)}</td></tr>`)
    .join('')}</table>`
  return {
    to: p.to,
    subject: 'Your Auto Budget Premium receipt',
    text: [
      'Thank you. Auto Budget Premium is unlocked for good.',
      '',
      ...lines.map(([k, v]) => `${k}: ${v}`),
      '',
      'Pay once, keep it for good. Nothing renews.',
      ...(support ? [`Questions? Email ${support}.`] : []),
    ].join('\n'),
    html: layout(
      'Thank you. Premium is unlocked.',
      table + para('Pay once, keep it for good. Nothing renews.') + (support ? para(`Questions? Email ${support}.`) : ''),
    ),
  }
}

export function trialEndingEmail(p: { to: string; endsAt: Date; price: number; appUrl: string }): Email {
  const when = manila(p.endsAt)
  return {
    to: p.to,
    subject: 'Your Auto Budget Premium trial ends tomorrow',
    text: [
      `Your free trial of Auto Budget Premium ends on ${when}.`,
      'Everything free keeps working, and nothing you made with Premium is deleted.',
      `To keep Premium, unlock it for ${formatPeso(p.price)}, one time: ${p.appUrl}/premium`,
    ].join('\n\n'),
    html: layout(
      'Your free trial ends tomorrow',
      para(`Your free trial of Auto Budget Premium ends on ${when}.`) +
        para('Everything free keeps working, and nothing you made with Premium is deleted.') +
        `<p style="margin:0"><a href="${esc(p.appUrl)}/premium" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#0F6B4F;color:#FFFFFF;font-weight:600;text-decoration:none">Unlock Premium for ${esc(formatPeso(p.price))}</a></p>`,
    ),
  }
}
