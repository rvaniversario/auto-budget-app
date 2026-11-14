/** The entitlement row as the server returns it. */
export interface RawEntitlement {
  plan: 'free' | 'premium'
  source: 'trial' | 'purchase' | 'grant' | null
  starts_at: string | null
  /** Null means permanent. */
  expires_at: string | null
  trial_used: boolean
}

export interface Entitlement {
  isPremium: boolean
  /** Bought or granted: never expires. */
  isLifetime: boolean
  source: RawEntitlement['source']
  expiresAt: string | null
  /** Whole days left in a running trial (1 on the last day), else null. */
  daysLeft: number | null
  /** The free trial can still be started (guests too: after signing in). */
  trialAvailable: boolean
  /** When a trial ran out without a purchase; null otherwise. */
  trialEndedAt: string | null
}

const DAY = 86_400_000

/**
 * Premium is active when the plan is premium and it has no end date (bought)
 * or the end date is still ahead (trial). Works offline from a cached row.
 */
export function evaluateEntitlement(raw: RawEntitlement | null, now: Date = new Date()): Entitlement {
  if (!raw) {
    return { isPremium: false, isLifetime: false, source: null, expiresAt: null, daysLeft: null, trialAvailable: true, trialEndedAt: null }
  }
  const expires = raw.expires_at ? Date.parse(raw.expires_at) : null
  const isPremium = raw.plan === 'premium' && (expires === null || expires > now.getTime())
  const isLifetime = isPremium && expires === null
  const runningTrial = isPremium && raw.source === 'trial' && expires !== null
  const trialEnded = raw.plan === 'premium' && raw.source === 'trial' && expires !== null && expires <= now.getTime()
  return {
    isPremium,
    isLifetime,
    source: raw.source,
    expiresAt: raw.expires_at,
    daysLeft: runningTrial ? Math.max(1, Math.ceil((expires! - now.getTime()) / DAY)) : null,
    trialAvailable: !raw.trial_used && !isPremium,
    trialEndedAt: trialEnded ? raw.expires_at : null,
  }
}

/** ₱399, ₱1,234.50: peso sign, no decimals when whole. */
export function formatPrice(centavos: number): string {
  const whole = centavos % 100 === 0
  return `₱${(centavos / 100).toLocaleString('en-PH', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`
}
