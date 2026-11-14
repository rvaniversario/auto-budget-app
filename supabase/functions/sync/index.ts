// The project's sync API. The app talks only to these routes, never to the
// database directly, so the backend can move hosts without client changes.
//
//   POST /sync/push            { records: [{ collection, data }] }  -> { accepted, ignored }
//   GET  /sync/pull?since=N    -> { records: [{ collection, data }], cursor, hasMore }
//   GET  /sync/status          -> { counts, devices, cursor }
//
// Every request needs `Authorization: Bearer <access token>` and an
// `X-Device-Id` header (plus an optional `X-Device-Label`, e.g. "iPhone").
//
// Sync is a Premium feature: accounts that cannot sync (see can_sync) get
// 403 with code "sync_requires_premium".

import { errorResponse, getCaller, json, preflight } from '../_shared/http.ts'

const SYNC_REQUIRES_PREMIUM = 'sync_requires_premium'

function premiumRequired(req: Request): Response {
  return json(req, { error: 'Sync is part of Premium.', code: SYNC_REQUIRES_PREMIUM }, 403)
}

const MAX_RECORDS = 500
const COLLECTION = /^[A-Za-z][A-Za-z0-9_]{0,39}$/
const MAX_RECORD_BYTES = 16_000

interface IncomingRecord {
  collection: string
  data: Record<string, unknown>
}

function validateRecords(body: unknown): IncomingRecord[] | string {
  const records = (body as { records?: unknown } | null)?.records
  if (!Array.isArray(records)) return 'records must be an array'
  if (records.length > MAX_RECORDS) return `At most ${MAX_RECORDS} records per push`
  for (const [i, r] of records.entries()) {
    const rec = r as Partial<IncomingRecord> | null
    if (!rec || typeof rec.collection !== 'string' || !COLLECTION.test(rec.collection)) return `records[${i}].collection is invalid`
    const data = rec.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) return `records[${i}].data must be an object`
    const id = data.id
    if (typeof id !== 'string' || id.length < 1 || id.length > 64) return `records[${i}].data.id is invalid`
    if (typeof data.updatedAt !== 'string' || Number.isNaN(Date.parse(data.updatedAt))) return `records[${i}].data.updatedAt is invalid`
    if (data.deletedAt !== null && data.deletedAt !== undefined && (typeof data.deletedAt !== 'string' || Number.isNaN(Date.parse(data.deletedAt))))
      return `records[${i}].data.deletedAt is invalid`
    if (JSON.stringify(data).length > MAX_RECORD_BYTES) return `records[${i}] is too large`
  }
  return records as IncomingRecord[]
}

function device(req: Request): { id: string; label: string } | null {
  const id = (req.headers.get('X-Device-Id') ?? '').trim()
  if (!id || id.length > 64) return null
  return { id, label: (req.headers.get('X-Device-Label') ?? '').trim().slice(0, 60) }
}

Deno.serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre

  const route = new URL(req.url).pathname.replace(/\/+$/, '').split('/').pop()

  const caller = await getCaller(req)
  if (!caller) return errorResponse(req, 401, 'Sign in required')

  try {
    if (route === 'status' && req.method === 'GET') {
      const { data, error } = await caller.db.rpc('sync_status')
      if (error) {
        if (error.hint === SYNC_REQUIRES_PREMIUM) return premiumRequired(req)
        throw error
      }
      return json(req, data)
    }

    const dev = device(req)
    if (!dev) return errorResponse(req, 400, 'X-Device-Id header required')

    if (route === 'push' && req.method === 'POST') {
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return errorResponse(req, 400, 'Body must be JSON')
      }
      const records = validateRecords(body)
      if (typeof records === 'string') return errorResponse(req, 400, records)
      const { data, error } = await caller.db.rpc('sync_push', {
        p_device_id: dev.id,
        p_device_label: dev.label,
        p_records: records,
      })
      if (error) {
        if (error.hint === SYNC_REQUIRES_PREMIUM) return premiumRequired(req)
        throw error
      }
      return json(req, data)
    }

    if (route === 'pull' && req.method === 'GET') {
      const params = new URL(req.url).searchParams
      const since = Number(params.get('since') ?? '0')
      const limit = Number(params.get('limit') ?? '500')
      if (!Number.isSafeInteger(since) || since < 0) return errorResponse(req, 400, 'since must be a whole number')
      const { data, error } = await caller.db.rpc('sync_pull', {
        p_device_id: dev.id,
        p_device_label: dev.label,
        p_since: since,
        p_limit: Number.isSafeInteger(limit) ? limit : 500,
      })
      if (error) {
        if (error.hint === SYNC_REQUIRES_PREMIUM) return premiumRequired(req)
        throw error
      }
      return json(req, data)
    }

    return errorResponse(req, 404, 'Not found')
  } catch (err) {
    console.error('sync failed', { route, user: caller.user.id, err })
    return errorResponse(req, 500, 'Sync failed. Try again later.')
  }
})
