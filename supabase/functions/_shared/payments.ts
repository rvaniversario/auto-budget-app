// Payment gateway boundary. Server code talks to PaymentProvider only, so
// PayMongo can be replaced (or a store billing provider added) without
// touching the checkout or webhook logic.

export interface CheckoutInput {
  purchaseId: string
  userId: string
  email: string | null
  product: { code: string; name: string; amount: number; currency: string }
  successUrl: string
  cancelUrl: string
}

export type WebhookEvent =
  | {
      kind: 'paid'
      eventId: string
      purchaseId: string
      paymentId: string
      amount: number
      currency: string
      method: string | null
      paidAt: Date | null
      raw: unknown
    }
  | { kind: 'refunded'; eventId: string; refundId: string; paymentId: string; amount: number; raw: unknown }
  | { kind: 'ignored'; eventId: string; type: string }

export class InvalidSignatureError extends Error {
  constructor(message = 'Invalid webhook signature') {
    super(message)
    this.name = 'InvalidSignatureError'
  }
}

export interface PaymentProvider {
  readonly name: string
  createCheckout(input: CheckoutInput): Promise<{ checkoutId: string; url: string }>
  /** Verify the request really came from the provider, then describe the event. Throws InvalidSignatureError. */
  parseWebhook(headers: Headers, rawBody: string): Promise<WebhookEvent>
}

// ---------------------------------------------------------------------------
// PayMongo (https://docs.paymongo.com): hosted Checkout for GCash, Maya,
// cards and QR Ph. The app never sees card or wallet details.
// ---------------------------------------------------------------------------

// Overridable only so tests can point at a fake server.
const PAYMONGO_API = (Deno.env.get('PAYMONGO_API_URL') ?? 'https://api.paymongo.com/v1').replace(/\/+$/, '')
const METHODS = ['gcash', 'paymaya', 'card', 'qrph']
/** Signed webhook timestamps older than this are refused (replay protection). */
const MAX_SIGNATURE_AGE_SECONDS = 24 * 60 * 60

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message)))
}

interface PayMongoEvent {
  data?: {
    id?: string
    attributes?: { type?: string; livemode?: boolean; data?: Record<string, unknown> }
  }
}

export class PayMongoProvider implements PaymentProvider {
  readonly name = 'paymongo'
  private readonly secretKey: string
  private readonly webhookSecret: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: { secretKey: string; webhookSecret: string; fetchImpl?: typeof fetch }) {
    this.secretKey = opts.secretKey
    this.webhookSecret = opts.webhookSecret
    this.fetchImpl = opts.fetchImpl ?? fetch
  }

  /** Live keys start with sk_live_; events must match the key's mode. */
  get livemode(): boolean {
    return this.secretKey.startsWith('sk_live_')
  }

  async createCheckout(input: CheckoutInput) {
    const res = await this.fetchImpl(`${PAYMONGO_API}/checkout_sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${this.secretKey}:`)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        data: {
          attributes: {
            line_items: [{ name: input.product.name, amount: input.product.amount, currency: input.product.currency, quantity: 1 }],
            payment_method_types: METHODS,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            description: `${input.product.name} (one-time payment)`,
            reference_number: input.purchaseId,
            send_email_receipt: false,
            show_line_items: true,
            // Metadata values must be strings.
            metadata: { purchase_id: input.purchaseId, user_id: input.userId, product_code: input.product.code },
          },
        },
      }),
    })
    const body = await res.json().catch(() => null)
    const id = body?.data?.id
    const url = body?.data?.attributes?.checkout_url
    if (!res.ok || typeof id !== 'string' || typeof url !== 'string') {
      throw new Error(`PayMongo checkout failed (${res.status}): ${JSON.stringify(body?.errors ?? body)}`)
    }
    return { checkoutId: id, url }
  }

  async parseWebhook(headers: Headers, rawBody: string): Promise<WebhookEvent> {
    // Header: Paymongo-Signature: t=<timestamp>,te=<test signature>,li=<live signature>
    const header = headers.get('Paymongo-Signature') ?? ''
    const parts = Object.fromEntries(
      header.split(',').map((p) => {
        const i = p.indexOf('=')
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
      }),
    ) as Record<string, string | undefined>
    if (!parts.t) throw new InvalidSignatureError('Missing signature timestamp')

    let payload: PayMongoEvent
    try {
      payload = JSON.parse(rawBody)
    } catch {
      throw new InvalidSignatureError('Body is not JSON')
    }
    const attrs = payload.data?.attributes ?? {}
    const livemode = attrs.livemode === true
    if (livemode !== this.livemode) throw new InvalidSignatureError(`Event livemode=${livemode} does not match the configured key`)

    // Signed string: "<t>.<raw body>", HMAC-SHA256 with the webhook's secret key.
    const expected = await hmacSha256Hex(this.webhookSecret, `${parts.t}.${rawBody}`)
    const given = (livemode ? parts.li : parts.te) ?? ''
    if (!timingSafeEqual(expected, given)) throw new InvalidSignatureError()
    const age = Math.abs(Date.now() / 1000 - Number(parts.t))
    if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_SECONDS) throw new InvalidSignatureError('Signature timestamp too old')

    const eventId = String(payload.data?.id ?? '')
    const type = String(attrs.type ?? '')
    const resource = (attrs.data ?? {}) as { id?: string; attributes?: Record<string, unknown> }

    if (type === 'checkout_session.payment.paid') {
      const a = (resource.attributes ?? {}) as {
        metadata?: Record<string, string>
        reference_number?: string
        payments?: { id: string; attributes: { status: string; amount: number; currency: string; paid_at?: number; source?: { type?: string } } }[]
      }
      // A session produces at most one successful payment.
      const payment = (a.payments ?? []).find((p) => p.attributes?.status === 'paid')
      const purchaseId = a.metadata?.purchase_id ?? a.reference_number
      if (!payment || !purchaseId) return { kind: 'ignored', eventId, type }
      return {
        kind: 'paid',
        eventId,
        purchaseId,
        paymentId: payment.id,
        amount: payment.attributes.amount,
        currency: payment.attributes.currency,
        method: payment.attributes.source?.type ?? null,
        paidAt: payment.attributes.paid_at ? new Date(payment.attributes.paid_at * 1000) : null,
        raw: payload,
      }
    }

    if (type === 'payment.refund.updated') {
      const a = (resource.attributes ?? {}) as { status?: string; payment_id?: string; amount?: number }
      if (a.status !== 'succeeded' || !a.payment_id || !resource.id) return { kind: 'ignored', eventId, type }
      return { kind: 'refunded', eventId, refundId: resource.id, paymentId: a.payment_id, amount: Number(a.amount ?? 0), raw: payload }
    }

    return { kind: 'ignored', eventId, type }
  }
}

/** The configured gateway. */
export function paymentProvider(): PaymentProvider {
  const secretKey = Deno.env.get('PAYMONGO_SECRET_KEY')
  const webhookSecret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')
  if (!secretKey || !webhookSecret) throw new Error('PAYMONGO_SECRET_KEY and PAYMONGO_WEBHOOK_SECRET must be set')
  return new PayMongoProvider({ secretKey, webhookSecret })
}

/** "GCash", "Maya", "Card", "QR Ph" for receipts. */
export function methodLabel(method: string | null | undefined): string | null {
  if (!method) return null
  return ({ gcash: 'GCash', paymaya: 'Maya', card: 'Card', qrph: 'QR Ph', grab_pay: 'GrabPay' } as Record<string, string>)[method] ?? method
}
