/** The entitlement row as the server returns it. */
export interface RawEntitlement {
  plan: 'free' | 'premium'
  source: 'trial' | 'purchase' | 'grant' | null
  starts_at: string | null
  /** Null means permanent. */
  expires_at: string | null
  trial_used: boolean
  /** Synced before version 2: sync stays free for good. Missing in older caches. */
  legacy_sync?: boolean
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
  /** Sync across devices is allowed: Premium, a running trial, or a legacy account. Mirrors can_sync on the server. */
  canSync: boolean
  /** Sync is free for this account because it synced before version 2. */
  legacySync: boolean
}

const DAY = 86_400_000

/**
 * Premium is active when the plan is premium and it has no end date (bought)
 * or the end date is still ahead (trial). Works offline from a cached row.
 */
export function evaluateEntitlement(raw: RawEntitlement | null, now: Date = new Date()): Entitlement {
  if (!raw) {
    return { isPremium: false, isLifetime: false, source: null, expiresAt: null, daysLeft: null, trialAvailable: true, trialEndedAt: null, canSync: false, legacySync: false }
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
    canSync: isPremium || raw.legacy_sync === true,
    legacySync: raw.legacy_sync === true,
  }
}

