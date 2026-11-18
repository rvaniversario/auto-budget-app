import type { Table } from 'dexie'
import { TABLES, type AutoBudgetDB } from '@/data/db'
import { newId, nextUpdatedAt } from '@/data/ids'
import { isUntouchedStarterAccount } from '@/data/seed'
import type { SyncApi, SyncedData, SyncRecord } from './api'

/**
 * Two-way sync between this device's IndexedDB and the online copy.
 *
 * - A record needs uploading when its updatedAt is newer than the version the
 *   server is known to hold (kept per record in `syncState`).
 * - Downloads are incremental: the server returns everything after a cursor.
 * - Conflicts resolve by last write wins on the record's updatedAt, the same
 *   rule the server applies, so every device converges on the same data.
 */

const META = {
  cursor: 'cursor',
  userId: 'userId',
  lastSyncedAt: 'lastSyncedAt',
  deviceId: 'deviceId',
  collections: 'collections',
} as const

const PUSH_BATCH = 500
const KNOWN = new Set<string>(TABLES)
/** When the set of synced tables changes, pull everything again so new tables fill in. */
const COLLECTIONS_SIGNATURE = TABLES.join(',')

const stateKey = (collection: string, id: string) => `${collection}:${id}`
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || 0 : 0)

function isRecord(data: unknown): data is SyncedData {
  const d = data as Partial<SyncedData> | null
  return !!d && typeof d === 'object' && typeof d.id === 'string' && typeof d.updatedAt === 'string'
}

export interface LocalSummary {
  /** The user has set up a budget here (anything beyond the default categories). */
  hasData: boolean
  transactions: number
}

/**
 * What to do the first time this device syncs with an account:
 * - `useLocal`: upload this device's data; online-only records are deleted.
 * - `useRemote`: replace this device's data with the online copy.
 * - `choose`: both have a budget, so the user must pick.
 */
export type LinkPlan =
  | { kind: 'useLocal' }
  | { kind: 'useRemote' }
  | { kind: 'choose'; localTransactions: number; remoteTransactions: number }

export class SyncEngine {
  /** True while downloaded changes are being written (ignore change notifications). */
  applying = false
  private queue: Promise<unknown> = Promise.resolve()

  private readonly db: AutoBudgetDB
  private readonly api: SyncApi

  constructor(db: AutoBudgetDB, api: SyncApi) {
    this.db = db
    this.api = api
  }

  /** Run sync operations one at a time. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async meta<T>(key: string): Promise<T | undefined> {
    return (await this.db.syncMeta.get(key))?.value as T | undefined
  }

  private setMeta(key: string, value: unknown) {
    return this.db.syncMeta.put({ key, value })
  }

  private dataTable(name: string): Table<SyncedData, string> {
    return this.db.table(name)
  }

  /** A random id for this browser's copy of the app, kept with its data. */
  async deviceId(): Promise<string> {
    const existing = await this.meta<string>(META.deviceId)
    if (existing) return existing
    const id = newId()
    await this.setMeta(META.deviceId, id)
    return id
  }

  /** The account this device's data is linked to, if any. */
  linkedUserId(): Promise<string | undefined> {
    return this.meta<string>(META.userId)
  }

  lastSyncedAt(): Promise<string | undefined> {
    return this.meta<string>(META.lastSyncedAt)
  }

  // ---- Local changes ------------------------------------------------------

  /** Records changed on this device that the server doesn't have yet. */
  async pendingChanges(): Promise<SyncRecord[]> {
    const known = new Map((await this.db.syncState.toArray()).map((r) => [r.key, r.updatedAt]))
    const out: SyncRecord[] = []
    for (const t of TABLES) {
      for (const row of await this.dataTable(t).toArray()) {
        const serverVersion = known.get(stateKey(t, row.id))
        if (serverVersion === undefined || time(row.updatedAt) > time(serverVersion)) out.push({ collection: t, data: row })
      }
    }
    return out
  }

  async pendingCount(): Promise<number> {
    return (await this.pendingChanges()).length
  }

  async localSummary(): Promise<LocalSummary> {
    const alive = <T extends { deletedAt: string | null }>(rows: T[]) => rows.filter((r) => !r.deletedAt)
    const transactions = alive(await this.db.transactions.toArray()).length
    // The starter Cash and Bank accounts alone don't make a budget worth keeping.
    const accounts = alive(await this.db.accounts.toArray()).filter((a) => !isUntouchedStarterAccount(a)).length
    const bills = alive(await this.db.fixedBills.toArray()).length
    return { hasData: transactions > 0 || accounts > 0 || bills > 0, transactions }
  }

  // ---- Upload and download ------------------------------------------------

  private async pushAll(): Promise<number> {
    const changes = await this.pendingChanges()
    for (let i = 0; i < changes.length; i += PUSH_BATCH) {
      const batch = changes.slice(i, i + PUSH_BATCH)
      await this.api.push(batch)
      // The server now holds this version or a newer one (which the next pull brings).
      await this.db.syncState.bulkPut(batch.map((r) => ({ key: stateKey(r.collection, r.data.id), updatedAt: r.data.updatedAt })))
    }
    return changes.length
  }

  /** Download every page after `cursor`. */
  private async fetchAll(cursor: number): Promise<{ records: SyncRecord[]; cursor: number }> {
    const records: SyncRecord[] = []
    for (;;) {
      const page = await this.api.pull(cursor)
      records.push(...page.records)
      cursor = page.cursor
      if (!page.hasMore) return { records, cursor }
    }
  }

  /**
   * Write downloaded records, keeping whichever version is newer. Must run
   * inside a transaction over the data tables and syncState.
   */
  private async applyRecords(records: SyncRecord[]): Promise<number> {
    let written = 0
    const byCollection = new Map<string, SyncedData[]>()
    for (const r of records) {
      if (!KNOWN.has(r.collection) || !isRecord(r.data)) continue // from a newer app version, or malformed
      const list = byCollection.get(r.collection) ?? []
      list.push(r.data)
      byCollection.set(r.collection, list)
    }
    for (const [collection, rows] of byCollection) {
      const table = this.dataTable(collection)
      const local = await table.bulkGet(rows.map((r) => r.id))
      const newer = rows.filter((r, i) => !local[i] || time(r.updatedAt) > time(local[i]!.updatedAt))
      if (newer.length) await table.bulkPut(newer)
      written += newer.length
      // Remember what the server holds. A newer local version stays pending and is uploaded.
      await this.db.syncState.bulkPut(rows.map((r) => ({ key: stateKey(collection, r.id), updatedAt: r.updatedAt })))
    }
    return written
  }

  private async withApplying<T>(fn: () => Promise<T>): Promise<T> {
    this.applying = true
    try {
      return await fn()
    } finally {
      this.applying = false
    }
  }

  private allTables() {
    return [...TABLES.map((t) => this.db.table(t)), this.db.syncState, this.db.syncMeta]
  }

  private async pullAll(): Promise<number> {
    let cursor = (await this.meta<number>(META.cursor)) ?? 0
    if ((await this.meta<string>(META.collections)) !== COLLECTIONS_SIGNATURE) cursor = 0
    const { records, cursor: next } = await this.fetchAll(cursor)
    return this.withApplying(() =>
      this.db.transaction('rw', this.allTables(), async () => {
        const n = await this.applyRecords(records)
        await this.setMeta(META.cursor, next)
        await this.setMeta(META.collections, COLLECTIONS_SIGNATURE)
        return n
      }),
    )
  }

  /** Upload local changes, then download changes from other devices. */
  sync(): Promise<{ pushed: number; pulled: number }> {
    return this.exclusive(async () => {
      if (!(await this.linkedUserId())) return { pushed: 0, pulled: 0 }
      const pushed = await this.pushAll()
      const pulled = await this.pullAll()
      await this.setMeta(META.lastSyncedAt, new Date().toISOString())
      return { pushed, pulled }
    })
  }

  // ---- Linking this device to an account ----------------------------------

  /** Decide how to combine this device's data with the account's online copy. */
  async planLink(): Promise<LinkPlan> {
    const [status, local] = await Promise.all([this.api.status(), this.localSummary()])
    const remoteHasBudget = (status.counts.settings ?? 0) > 0
    if (!remoteHasBudget) return { kind: 'useLocal' }
    if (!local.hasData) return { kind: 'useRemote' }
    return { kind: 'choose', localTransactions: local.transactions, remoteTransactions: status.counts.transactions ?? 0 }
  }

  /** Link this device to `userId` and make both copies the same, then keep them in sync. */
  link(userId: string, mode: 'useLocal' | 'useRemote'): Promise<void> {
    return this.exclusive(async () => {
      const { records, cursor } = await this.fetchAll(0)
      await this.withApplying(() =>
        this.db.transaction('rw', this.allTables(), async () => {
          await this.db.syncState.clear()
          if (mode === 'useRemote') {
            await Promise.all(TABLES.map((t) => this.db.table(t).clear()))
            await this.applyRecords(records)
          } else {
            await this.overrideRemote(records)
          }
          await this.setMeta(META.userId, userId)
          await this.setMeta(META.cursor, cursor)
          await this.setMeta(META.collections, COLLECTIONS_SIGNATURE)
        }),
      )
      await this.pushAll()
      await this.setMeta(META.lastSyncedAt, new Date().toISOString())
    })
  }

  /**
   * Make this device's data win: every local record is stamped newer than the
   * online version, and records that exist only online become deletions.
   */
  private async overrideRemote(remote: SyncRecord[]) {
    const now = new Date().toISOString()
    for (const t of TABLES) {
      const online = remote.filter((r) => r.collection === t && isRecord(r.data)).map((r) => r.data)
      if (!online.length) continue
      const table = this.dataTable(t)
      const local = await table.bulkGet(online.map((r) => r.id))
      const writes: SyncedData[] = online.map((r, i) => {
        const mine = local[i]
        const newest = mine && time(mine.updatedAt) > time(r.updatedAt) ? mine.updatedAt : r.updatedAt
        const updatedAt = nextUpdatedAt(newest)
        return mine ? { ...mine, updatedAt } : { ...r, deletedAt: r.deletedAt ?? now, updatedAt }
      })
      await table.bulkPut(writes)
      await this.db.syncState.bulkPut(online.map((r) => ({ key: stateKey(t, r.id), updatedAt: r.updatedAt })))
    }
  }

  /** Stop syncing (sign out). Data stays on the device. */
  unlink(): Promise<void> {
    return this.exclusive(async () => {
      await this.db.transaction('rw', [this.db.syncState, this.db.syncMeta], async () => {
        await this.db.syncState.clear()
        await Promise.all([META.userId, META.cursor, META.lastSyncedAt, META.collections].map((k) => this.db.syncMeta.delete(k)))
      })
    })
  }
}
