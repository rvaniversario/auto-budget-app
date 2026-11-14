import { describe, expect, it } from 'vitest'
import { evaluateEntitlement, type RawEntitlement } from './entitlement'

const now = new Date('2026-11-12T12:00:00.000Z')
const raw = (over: Partial<RawEntitlement>): RawEntitlement => ({
  plan: 'free',
  source: null,
  starts_at: null,
  expires_at: null,
  trial_used: false,
  ...over,
})

describe('evaluateEntitlement', () => {
  it('guests and new accounts are free with the trial available', () => {
    expect(evaluateEntitlement(null, now)).toMatchObject({ isPremium: false, trialAvailable: true })
    expect(evaluateEntitlement(raw({}), now)).toMatchObject({ isPremium: false, trialAvailable: true, trialEndedAt: null })
  })

  it('a running trial is Premium with days left', () => {
    const e = evaluateEntitlement(raw({ plan: 'premium', source: 'trial', trial_used: true, expires_at: '2026-11-15T10:00:00.000Z' }), now)
    expect(e).toMatchObject({ isPremium: true, isLifetime: false, daysLeft: 3, trialAvailable: false, trialEndedAt: null })
  })

  it('the last hours of a trial count as 1 day left', () => {
    expect(evaluateEntitlement(raw({ plan: 'premium', source: 'trial', trial_used: true, expires_at: '2026-11-12T13:00:00.000Z' }), now).daysLeft).toBe(1)
  })

  it('an expired trial locks, even offline from the cache, and reports when it ended', () => {
    const e = evaluateEntitlement(raw({ plan: 'premium', source: 'trial', trial_used: true, expires_at: '2026-11-12T11:59:59.000Z' }), now)
    expect(e).toMatchObject({ isPremium: false, trialAvailable: false, trialEndedAt: '2026-11-12T11:59:59.000Z' })
  })

  it('a purchase never expires', () => {
    const e = evaluateEntitlement(raw({ plan: 'premium', source: 'purchase', trial_used: true }), new Date('2040-01-01'))
    expect(e).toMatchObject({ isPremium: true, isLifetime: true, daysLeft: null, trialAvailable: false })
  })

  it('a refunded account is free, without a trial-ended notice', () => {
    expect(evaluateEntitlement(raw({ plan: 'free', trial_used: true }), now)).toMatchObject({ isPremium: false, trialAvailable: false, trialEndedAt: null })
  })
})

