/**
 * The project's own sync API (see supabase/functions/sync). The app talks to
 * these routes only, never to a database SDK, so the backend can move hosts.
 */

export interface SyncedData {
  id: string
  updatedAt: string
  deletedAt: string | null
  [field: string]: unknown
}

export interface SyncRecord {
  /** Local table name, for example "transactions". */
  collection: string
  data: SyncedData
}

export interface PullPage {
  records: SyncRecord[]
  /** Pass to the next pull to get only later changes. */
  cursor: number
  hasMore: boolean
}

export interface RemoteDevice {
  id: string
  label: string
  lastSeenAt: string
}

export interface RemoteStatus {
  /** Live (not deleted) records saved online, per collection. */
  counts: Record<string, number>
  devices: RemoteDevice[]
  cursor: number
}

export interface SyncApi {
  push(records: SyncRecord[]): Promise<{ accepted: number; ignored: number }>
  pull(since: number): Promise<PullPage>
  status(): Promise<RemoteStatus>
}

/** The server could not be reached (offline, DNS, timeout). Changes stay queued. */
export class OfflineError extends Error {
  constructor() {
    super('No connection')
    this.name = 'OfflineError'
  }
}

/** The server answered with an error. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export interface HttpOptions {
  /** Base URL of the server functions, for example https://xyz.supabase.co/functions/v1 */
  baseUrl: string
  /** Public client key sent as `apikey` (required by Supabase's gateway). */
  apiKey: string
  getAccessToken: () => Promise<string | null>
  deviceId: () => Promise<string>
  deviceLabel: string
  fetchImpl?: typeof fetch
}

/** Call one of the project's server functions as the signed-in user. */
export async function callApi<T>(
  opts: HttpOptions,
  path: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
  { anonymous = false }: { anonymous?: boolean } = {},
): Promise<T> {
  const token = await opts.getAccessToken()
  if (!token && !anonymous) throw new ApiError(401, 'Sign in required')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await (opts.fetchImpl ?? fetch)(`${opts.baseUrl.replace(/\/+$/, '')}/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        apikey: opts.apiKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Device-Id': await opts.deviceId(),
        'X-Device-Label': opts.deviceLabel,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new OfflineError()
  } finally {
    clearTimeout(timer)
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`)
  return body as T
}

export function createHttpSyncApi(opts: HttpOptions): SyncApi {
  return {
    push: (records) => callApi(opts, 'sync/push', { method: 'POST', body: JSON.stringify({ records }) }),
    pull: (since) => callApi(opts, `sync/pull?since=${since}&limit=500`),
    status: () => callApi(opts, 'sync/status'),
  }
}
