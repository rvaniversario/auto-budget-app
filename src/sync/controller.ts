/**
 * Runs online backup in the background: follows the sign-in state, links the
 * device to the account, and syncs after local changes, on reconnect, when
 * the app comes back to the foreground, and every few minutes.
 *
 * Screens read its state with useSync() and call the exported actions.
 */
import { localDatabase, onLocalChange } from '@/data'
import { ApiError, OfflineError, callApi, createHttpSyncApi, type HttpOptions, type RemoteStatus } from './api'
import { accessToken, signOutLocally, supabase, toCloudUser, type CloudUser } from './auth'
import { cloudConfig } from './config'
import { deviceLabel } from './device'
import { SyncEngine } from './engine'

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncState {
  /** Sign-in and backup are available in this build. */
  enabled: boolean
  /** The sign-in state is known (false only briefly at start-up). */
  ready: boolean
  user: CloudUser | null
  /** This device's data is linked to the signed-in account and syncing. */
  linked: boolean
  phase: SyncPhase
  /** Changes on this device not yet backed up. */
  pending: number
  lastSyncedAt: string | null
  error: string | null
  /** What is saved online (loaded on the Account screen). */
  remote: RemoteStatus | null
  /** Set when the device and the account both have a budget and the user must pick one. */
  choice: { localTransactions: number; remoteTransactions: number } | null
}

let state: SyncState = {
  enabled: cloudConfig !== null,
  ready: cloudConfig === null,
  user: null,
  linked: false,
  phase: 'idle',
  pending: 0,
  lastSyncedAt: null,
  error: null,
  remote: null,
  choice: null,
}

const listeners = new Set<() => void>()

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function getSyncState(): SyncState {
  return state
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// ---------------------------------------------------------------------------

let engine: SyncEngine | null = null
let http: HttpOptions | null = null
let started = false
let syncTimer: number | undefined
let pendingTimer: number | undefined
let lastAttempt = 0

const DEBOUNCE_MS = 2_000
const PERIODIC_MS = 5 * 60_000

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

async function refreshLocalStatus() {
  if (!engine) return
  const [pending, lastSyncedAt, linkedId] = await Promise.all([engine.pendingCount(), engine.lastSyncedAt(), engine.linkedUserId()])
  set({ pending, lastSyncedAt: lastSyncedAt ?? null, linked: !!linkedId && linkedId === state.user?.id })
}

function describe(err: unknown): { phase: SyncPhase; error: string | null } {
  if (err instanceof OfflineError) return { phase: 'offline', error: null }
  if (err instanceof ApiError && err.status === 401) return { phase: 'error', error: 'Your sign-in expired. Sign in again to keep backing up.' }
  console.error('Backup failed', err)
  return { phase: 'error', error: "Couldn't back up. We'll try again automatically." }
}

/** Back up now (and download changes from other devices). */
export async function syncNow(): Promise<void> {
  window.clearTimeout(syncTimer)
  if (!engine || !state.linked) return
  if (!isOnline()) {
    set({ phase: 'offline' })
    await refreshLocalStatus()
    return
  }
  lastAttempt = Date.now()
  set({ phase: 'syncing', error: null })
  try {
    await engine.sync()
    set({ phase: 'idle', error: null })
  } catch (err) {
    set(describe(err))
  }
  await refreshLocalStatus()
}

function scheduleSync(delay = DEBOUNCE_MS) {
  window.clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => void syncNow(), delay)
}

/** Link this device to the signed-in account, asking the user first if both have a budget. */
async function linkAccount(user: CloudUser) {
  if (!engine) return
  if (!isOnline()) {
    set({ phase: 'offline' })
    return
  }
  set({ phase: 'syncing', error: null })
  try {
    const plan = await engine.planLink()
    if (plan.kind === 'choose') {
      set({ phase: 'idle', choice: { localTransactions: plan.localTransactions, remoteTransactions: plan.remoteTransactions } })
      return
    }
    await engine.link(user.id, plan.kind)
    set({ phase: 'idle', linked: true })
  } catch (err) {
    set(describe(err))
  }
  await refreshLocalStatus()
}

/** The user's answer when both this device and the account have a budget. */
export async function resolveChoice(keep: 'device' | 'online'): Promise<void> {
  if (!engine || !state.user) return
  set({ choice: null, phase: 'syncing', error: null })
  try {
    await engine.link(state.user.id, keep === 'device' ? 'useLocal' : 'useRemote')
    set({ phase: 'idle', linked: true })
  } catch (err) {
    set(describe(err))
  }
  await refreshLocalStatus()
}

async function onUser(user: CloudUser | null) {
  if (!engine) return
  const previous = state.user
  set({ user, ready: true })
  if (!user) {
    if (previous) await engine.unlink()
    set({ linked: false, choice: null, remote: null, phase: 'idle', error: null })
    await refreshLocalStatus()
    return
  }
  const linkedId = await engine.linkedUserId()
  if (linkedId === user.id) {
    set({ linked: true })
    await syncNow()
  } else if (!state.choice) {
    await linkAccount(user)
  }
}

/** Start background backup. Safe to call more than once. */
export function startSync(): void {
  if (started || !cloudConfig) return
  started = true

  http = {
    baseUrl: cloudConfig.apiUrl,
    apiKey: cloudConfig.supabaseKey,
    getAccessToken: accessToken,
    deviceId: () => engine!.deviceId(),
    deviceLabel: deviceLabel(),
  }
  engine = new SyncEngine(localDatabase, createHttpSyncApi(http))

  // Supabase warns against awaiting its own calls inside this callback, so defer.
  supabase().auth.onAuthStateChange((_event, session) => {
    const user = toCloudUser(session?.user)
    if (user?.id === state.user?.id && state.ready) return
    window.setTimeout(() => void onUser(user), 0)
  })

  onLocalChange(() => {
    if (engine?.applying) return
    window.clearTimeout(pendingTimer)
    pendingTimer = window.setTimeout(() => void refreshLocalStatus(), 300)
    if (state.linked) scheduleSync()
  })

  window.addEventListener('online', () => {
    if (state.linked) void syncNow()
    else if (state.user && !state.choice) void linkAccount(state.user)
  })
  window.addEventListener('offline', () => set({ phase: 'offline' }))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.linked && Date.now() - lastAttempt > 60_000) void syncNow()
  })
  window.setInterval(() => {
    if (state.linked && document.visibilityState === 'visible') void syncNow()
  }, PERIODIC_MS)
}

/**
 * Call one of the project's server functions as the signed-in user, or
 * anonymously when `anonymous` is set and nobody is signed in.
 */
export function apiCall<T>(path: string, init: RequestInit = {}, options: { anonymous?: boolean } = {}): Promise<T> {
  if (!http) return Promise.reject(new ApiError(503, 'Online features are not available.'))
  if (!isOnline()) return Promise.reject(new OfflineError())
  return callApi<T>(http, path, init, 20_000, options)
}

/** This device's id in the account's device list. */
export function thisDeviceId(): Promise<string | null> {
  return engine ? engine.deviceId() : Promise.resolve(null)
}

/** Load what is saved online, for the Account screen. */
export async function loadRemoteStatus(): Promise<void> {
  if (!http || !state.linked || !isOnline()) return
  try {
    set({ remote: await callApi<RemoteStatus>(http, 'sync/status') })
  } catch {
    // Keep showing the last known status.
  }
}

/** Sign out on this device. Data stays here; backup stops. */
export async function signOut(): Promise<void> {
  await signOutLocally()
  await onUser(null)
}

/** Permanently delete the account and everything saved online. Data on this device is kept. */
export async function deleteAccount(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!http) return { ok: false, error: 'Online backup is not available.' }
  if (!isOnline()) return { ok: false, error: "You're offline. Connect to the internet to delete your account." }
  try {
    await callApi(http, 'delete-account', { method: 'POST', body: '{}' })
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Couldn't reach the server. Try again." }
  }
  await signOut()
  return { ok: true }
}
