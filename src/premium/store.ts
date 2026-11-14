/**
 * Premium state on the device. The server decides; this keeps the last known
 * answer in IndexedDB so Premium works offline (a purchase indefinitely, a
 * trial until its cached end date) and refreshes it when it can.
 *
 * It runs whenever online features are available, even with the Premium flag
 * off, because sync across devices depends on it: it tells the sync engine
 * whether the signed-in account may sync (setSyncAllowed).
 */
import { localDatabase } from '@/data'
import { ApiError, OfflineError, apiCall, cloudEnabled, getSyncState, setSyncAllowed, subscribeSync } from '@/sync'
import { evaluateEntitlement, type RawEntitlement } from './entitlement'

/** A Premium purchase record. Purchases happen in the Android app through Google Play. */
export interface PurchaseRecord {
  id: string
  provider: string
  /** Google Play order ID. */
  orderId: string | null
  status: 'paid' | 'refunded'
  date: string
}

interface StatusResponse {
  entitlement: RawEntitlement | null
  purchases: PurchaseRecord[]
}

export interface PremiumState {
  /** Nothing known yet (first load, no cache). */
  loading: boolean
  userId: string | null
  raw: RawEntitlement | null
  purchases: PurchaseRecord[]
  fetchedAt: string | null
}

let state: PremiumState = { loading: cloudEnabled, userId: null, raw: null, purchases: [], fetchedAt: null }
const listeners = new Set<() => void>()

function set(patch: Partial<PremiumState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
  reportSync()
}

/** Tell the sync engine whether the signed-in account may sync, once that is known. */
function reportSync() {
  if (!state.userId || state.loading) return
  setSyncAllowed(state.userId, evaluateEntitlement(state.raw).canSync)
}

export const getPremiumState = () => state
export function subscribePremium(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const cacheKey = (userId: string | null) => `premium:${userId ?? 'guest'}`

async function readCache(userId: string | null): Promise<StatusResponse & { fetchedAt: string } | undefined> {
  try {
    return (await localDatabase.localCache.get(cacheKey(userId)))?.value as StatusResponse & { fetchedAt: string }
  } catch {
    return undefined
  }
}

async function writeCache(userId: string | null, value: StatusResponse & { fetchedAt: string }) {
  try {
    await localDatabase.localCache.put({ key: cacheKey(userId), value })
  } catch {
    // The cache is a convenience; ignore storage errors.
  }
}

let inflight: Promise<void> | null = null
let lastRefresh = 0

/** Ask the server for the current entitlement. Keeps the cached answer when offline. */
export function refreshPremium(): Promise<void> {
  if (!cloudEnabled) return Promise.resolve()
  inflight ??= (async () => {
    const userId = state.userId
    try {
      const res = await apiCall<StatusResponse>('premium/status', {}, { anonymous: true })
      if (userId !== state.userId) return // signed in or out meanwhile; that change refreshes again
      const fetchedAt = new Date().toISOString()
      set({ loading: false, raw: res.entitlement, purchases: res.purchases ?? [], fetchedAt })
      await writeCache(userId, { ...res, fetchedAt })
    } catch (err) {
      if (!(err instanceof OfflineError) && !(err instanceof ApiError && err.status === 401)) console.warn('Premium status refresh failed', err)
      set({ loading: false })
    } finally {
      lastRefresh = Date.now()
      inflight = null
    }
  })()
  return inflight
}

async function onUser(userId: string | null) {
  const cached = await readCache(userId)
  set({
    userId,
    raw: cached?.entitlement ?? null,
    purchases: cached?.purchases ?? [],
    fetchedAt: cached?.fetchedAt ?? null,
    loading: !cached,
  })
  await refreshPremium()
}

let started = false

/** Follow sign-in, and refresh on open, after sign-in and when the app regains focus. */
export function startPremium(): void {
  if (started || !cloudEnabled) return
  started = true
  let lastUser: string | null | undefined
  const check = () => {
    const sync = getSyncState()
    if (!sync.ready) return
    const userId = sync.user?.id ?? null
    if (userId === lastUser) return
    lastUser = userId
    void onUser(userId)
  }
  subscribeSync(check)
  check()
  const onFocus = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRefresh > 30_000) void refreshPremium()
  }
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onFocus)
  window.addEventListener('online', () => void refreshPremium())
  // A trial can end while the app is open: re-check every minute.
  window.setInterval(reportSync, 60_000)
}

/** Start the one free trial. */
export async function startTrial(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await apiCall('premium/start-trial', { method: 'POST', body: '{}' })
    await refreshPremium()
    return { ok: true }
  } catch (err) {
    if (err instanceof OfflineError) return { ok: false, error: "You're offline. Connect to the internet to start the trial." }
    if (err instanceof ApiError) return { ok: false, error: err.message }
    return { ok: false, error: "Couldn't start the trial. Try again." }
  }
}

