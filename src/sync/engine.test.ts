import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { pesos } from '@/core'
import { createDatabase } from '@/data/db'
import { DexieRepository } from '@/data/dexieRepository'
import type { PullPage, RemoteStatus, SyncApi, SyncRecord } from './api'
import { SyncEngine } from './engine'

/**
 * In-memory server with the same rules as supabase/migrations/*_sync.sql:
 * last write wins by updatedAt, a rev per accepted write, pulls after a cursor
 * that skip the caller's own writes on incremental pulls.
 */
class FakeServer {
  rows = new Map<string, { collection: string; data: SyncRecord['data']; rev: number; device: string }>()
  rev = 0

  api(device: string, pageSize = 500): SyncApi {
    const rows = this.rows
    const nextRev = () => ++this.rev
    const latestRev = () => this.rev
    return {
      async push(records) {
        let accepted = 0
        for (const r of records) {
          const key = `${r.collection}:${r.data.id}`
          const existing = rows.get(key)
          if (existing && Date.parse(existing.data.updatedAt) >= Date.parse(r.data.updatedAt)) continue
          rows.set(key, { collection: r.collection, data: structuredClone(r.data), rev: nextRev(), device })
          accepted++
        }
        return { accepted, ignored: records.length - accepted }
      },
      async pull(since): Promise<PullPage> {
        const page = [...rows.values()].filter((r) => r.rev > since).sort((a, b) => a.rev - b.rev).slice(0, pageSize)
        return {
          records: page
            .filter((r) => since === 0 || r.device !== device)
            .map((r) => ({ collection: r.collection, data: structuredClone(r.data) })),
          cursor: page.length ? page[page.length - 1].rev : since,
          hasMore: page.length === pageSize,
        }
      },
      async status(): Promise<RemoteStatus> {
        const counts: Record<string, number> = {}
        for (const r of rows.values()) if (!r.data.deletedAt) counts[r.collection] = (counts[r.collection] ?? 0) + 1
        return { counts, devices: [], cursor: latestRev() }
      },
    }
  }

  alive(collection: string) {
    return [...this.rows.values()].filter((r) => r.collection === collection && !r.data.deletedAt).map((r) => r.data)
  }
}

let n = 0
const repos: DexieRepository[] = []

function device(server: FakeServer, pageSize?: number) {
  const repo = new DexieRepository(createDatabase(`sync-test-${++n}`))
  repos.push(repo)
  const engine = new SyncEngine(repo.db, server.api(`device-${n}`, pageSize))
  return { repo, engine }
}

afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.db.delete()))
})

async function onboard(repo: DexieRepository, salary = 50_000) {
  await repo.saveSettings({ monthlySalary: pesos(salary), onboardingComplete: true })
}

const cash = { name: 'Wallet', type: 'cash' as const, openingBalance: 0, statementDay: null, dueDay: null, minimumDue: null, monthlyInterestRate: null }

async function expense(repo: DexieRepository, amount: number, note = '') {
  const [acc] = await repo.listAccounts()
  const account = acc ?? (await repo.addAccount(cash))
  return repo.addTransaction({
    type: 'expense',
    amount: pesos(amount),
    date: '2026-11-10',
    categoryId: null,
    accountId: account.id,
    toAccountId: null,
    note,
    fixedBillId: null,
    isOneTime: false,
  })
}

describe('SyncEngine', () => {
  it('uploads everything when the account is new', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    await expense(a.repo, 120)

    expect(await a.engine.planLink()).toEqual({ kind: 'useLocal' })
    await a.engine.link('user-1', 'useLocal')

    expect(server.alive('transactions')).toHaveLength(1)
    expect(server.alive('categories')).toHaveLength(6)
    expect(server.alive('settings')).toHaveLength(1)
    expect(await a.engine.pendingCount()).toBe(0)
    expect(await a.engine.linkedUserId()).toBe('user-1')
  })

  it('restores the online budget on a fresh device', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    await expense(a.repo, 120, 'lunch')
    await a.engine.link('user-1', 'useLocal')

    const b = device(server)
    // B has only partial onboarding and the seeded categories.
    await b.repo.saveSettings({ monthlySalary: pesos(1) })
    expect(await b.engine.planLink()).toEqual({ kind: 'useRemote' })
    await b.engine.link('user-1', 'useRemote')

    const snap = await b.repo.getSnapshot()
    expect(snap?.settings.monthlySalary).toBe(pesos(50_000))
    expect(snap?.transactions.map((t) => t.note)).toEqual(['lunch'])
    expect(snap?.categories).toHaveLength(6) // B's own seeded categories were replaced, not added
    expect(await b.engine.pendingCount()).toBe(0)
  })

  it('asks the user when both the device and the account have a budget', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    await expense(a.repo, 1)
    await expense(a.repo, 2)
    await a.engine.link('user-1', 'useLocal')

    const b = device(server)
    await onboard(b.repo, 70_000)
    await expense(b.repo, 3)
    expect(await b.engine.planLink()).toEqual({ kind: 'choose', localTransactions: 1, remoteTransactions: 2 })
  })

  it("replaces the online copy with this device's data when the user picks it", async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    await expense(a.repo, 1, 'from A')
    await a.engine.link('user-1', 'useLocal')

    const b = device(server)
    await onboard(b.repo, 70_000)
    await expense(b.repo, 3, 'from B')
    await b.engine.link('user-1', 'useLocal')

    expect(server.alive('transactions').map((t) => t.note)).toEqual(['from B'])
    expect(server.alive('settings').map((s) => s.monthlySalary)).toEqual([pesos(70_000)])

    // A converges on B's data.
    await a.engine.sync()
    const snap = await a.repo.getSnapshot()
    expect(snap?.transactions.map((t) => t.note)).toEqual(['from B'])
    expect(snap?.settings.monthlySalary).toBe(pesos(70_000))
  })

  it('keeps two devices in sync, including edits and deletes', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    const t = await expense(a.repo, 100, 'coffee')
    await a.engine.link('user-1', 'useLocal')
    const b = device(server)
    await b.engine.link('user-1', 'useRemote')

    await b.repo.updateTransaction(t.id, { note: 'coffee and bread' })
    await b.engine.sync()
    await a.engine.sync()
    expect((await a.repo.getTransaction(t.id))?.note).toBe('coffee and bread')

    await a.repo.deleteTransaction(t.id)
    await a.engine.sync()
    await b.engine.sync()
    expect(await b.repo.getTransaction(t.id)).toBeUndefined()
  })

  it('resolves concurrent edits by last write wins', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    const t = await expense(a.repo, 100, 'original')
    await a.engine.link('user-1', 'useLocal')
    const b = device(server)
    await b.engine.link('user-1', 'useRemote')

    await a.repo.updateTransaction(t.id, { note: 'edited on A' })
    await new Promise((r) => setTimeout(r, 5))
    await b.repo.updateTransaction(t.id, { note: 'edited on B, later' })

    // A syncs first, then B (whose edit is newer), then A again.
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    expect((await a.repo.getTransaction(t.id))?.note).toBe('edited on B, later')
    expect((await b.repo.getTransaction(t.id))?.note).toBe('edited on B, later')
  })

  it('an edit always wins over the version it replaced, even with a slow clock', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    const t = await expense(a.repo, 100, 'v1')
    // Simulate another device with a clock 1 hour ahead writing v2.
    const future = new Date(Date.now() + 3_600_000).toISOString()
    await server.api('other').push([{ collection: 'transactions', data: { ...t, note: 'v2', updatedAt: future } }])
    await a.engine.link('user-1', 'useRemote')
    expect((await a.repo.getTransaction(t.id))?.note).toBe('v2')

    await a.repo.updateTransaction(t.id, { note: 'v3' })
    await a.engine.sync()
    expect(server.alive('transactions')[0].note).toBe('v3')
  })

  it('counts changes waiting while offline and uploads them later', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    await a.engine.link('user-1', 'useLocal')
    expect(await a.engine.pendingCount()).toBe(0)

    await expense(a.repo, 5)
    await expense(a.repo, 6)
    expect(await a.engine.pendingCount()).toBe(3) // 2 transactions + the new cash account

    await a.engine.sync()
    expect(await a.engine.pendingCount()).toBe(0)
    expect(server.alive('transactions')).toHaveLength(2)
  })

  it('pages through large downloads', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    for (let i = 0; i < 12; i++) await expense(a.repo, i + 1)
    await a.engine.link('user-1', 'useLocal')

    const b = device(server, 5)
    await b.engine.link('user-1', 'useRemote')
    expect(await b.repo.listTransactions()).toHaveLength(12)
  })

  it('ignores collections from a newer app version without failing', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    await a.engine.link('user-1', 'useLocal')
    const now = new Date().toISOString()
    await server.api('v2-client').push([{ collection: 'recurringTemplates', data: { id: 'r1', updatedAt: now, deletedAt: null } }])
    await expect(a.engine.sync()).resolves.toBeDefined()
  })

  it('deleting all data while linked deletes it online too', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    await expense(a.repo, 5)
    await a.engine.link('user-1', 'useLocal')

    await a.repo.deleteAllData()
    await a.engine.sync()
    expect(server.alive('transactions')).toHaveLength(0)
    expect(server.alive('settings')).toHaveLength(0)
    expect(await a.repo.listTransactions()).toHaveLength(0)
    expect(await a.repo.listCategories()).toHaveLength(6) // fresh defaults
  })

  it('importing a backup while linked replaces the online copy', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    await expense(a.repo, 5, 'before backup')
    const backup = await a.repo.exportBackup()
    await expense(a.repo, 6, 'after backup')
    await a.engine.link('user-1', 'useLocal')
    expect(server.alive('transactions')).toHaveLength(2)

    await a.repo.importBackup(backup)
    await a.engine.sync()
    expect(server.alive('transactions').map((t) => t.note)).toEqual(['before backup'])
  })

  it('signing out stops syncing but keeps data on the device', async () => {
    const server = new FakeServer()
    const a = device(server)
    await onboard(a.repo)
    await expense(a.repo, 5)
    await a.engine.link('user-1', 'useLocal')
    await a.engine.unlink()

    expect(await a.engine.linkedUserId()).toBeUndefined()
    expect(await a.repo.listTransactions()).toHaveLength(1)
    await expense(a.repo, 9)
    expect(await a.engine.sync()).toEqual({ pushed: 0, pulled: 0 })
    expect(server.alive('transactions')).toHaveLength(1)
  })
})
