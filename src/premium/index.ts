import { useEffect, useState, useSyncExternalStore } from 'react'
import { evaluateEntitlement, type Entitlement } from './entitlement'
import { getPremiumState, subscribePremium, type PremiumState } from './store'

export { premiumEnabled } from './config'
export { evaluateEntitlement, type Entitlement, type RawEntitlement } from './entitlement'
export { PREMIUM_FEATURES, featuresFirst, premiumFeature, type PremiumFeature, type PremiumFeatureId } from './features'
export { refreshPremium, startPremium, startTrial, type PurchaseRecord } from './store'

export interface UseEntitlement extends Entitlement {
  loading: boolean
  /** Signed in (Premium is tied to an account). */
  signedIn: boolean
  purchases: PremiumState['purchases']
}

/** Re-render every minute so a trial locks on time while the app is open. */
function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** The user's Premium status. Gate screens with <PremiumGate>, not with this directly. */
export function useEntitlement(): UseEntitlement {
  const state = useSyncExternalStore(subscribePremium, getPremiumState, getPremiumState)
  const now = useMinuteTick()
  return {
    ...evaluateEntitlement(state.userId ? state.raw : null, new Date(now)),
    loading: state.loading,
    signedIn: state.userId !== null,
    purchases: state.purchases,
  }
}
