import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pesos } from '@/core'
import { parseBackup } from './backup'
import { createDatabase } from './db'
import { DexieRepository } from './dexieRepository'

let repo: DexieRepository
let n = 0

beforeEach(() => {
  repo = new DexieRepository(createDatabase(`test-${++n}`))
})
afterEach(async () => {
  await repo.db.delete()
})

describe('DexieRepository', () => {
  it('seeds the default categories', async () => {
    const cats = await repo.listCategories()
    expect(cats.map((c) => `${c.name}:${c.kind}`)).toEqual([
      'Groceries:essential',
      'Food:essential',
      'Transport:essential',
      'Load and data:essential',
      'Dining out:optional',
      'Shopping:optional',
    ])
  })

  it('creates settings with defaults then patches them', async () => {
    expect(await repo.getSnapshot()).toBeNull()
    const s = await repo.saveSettings({ monthlySalary: pesos(60_000) })
    expect(s.bufferAmount).toBe(pesos(3_000))
    expect(s.onboardingComplete).toBe(false)
    await repo.saveSettings({ paydayDay: 15 })
    const again = await repo.getSettings()
    expect(again?.id).toBe(s.id)
    expect(again?.paydayDay).toBe(15)
    expect(again?.monthlySalary).toBe(pesos(60_000))
  })

  it('stamps sync fields and soft-deletes', async () => {
    const bank = await repo.addAccount({
      name: 'Bank', type: 'bank', openingBalance: 0, statementDay: null, dueDay: null, minimumDue: null, monthlyInterestRate: null,
    })
    expect(bank.id).toMatch(/^[0-9a-f-]{36}$/)
    const t = await repo.addTransaction({
      type: 'expense', amount: 100, date: '2026-11-01', categoryId: null, accountId: bank.id,
      toAccountId: null, note: '', fixedBillId: null, isOneTime: false,
    })
    expect(t.deletedAt).toBeNull()
    await repo.deleteTransaction(t.id)
    expect(await repo.listTransactions()).toEqual([])
    const raw = await repo.db.transactions.get(t.id)
    expect(raw?.deletedAt).not.toBeNull()
    await repo.restoreTransaction(t.id)
    expect(await repo.listTransactions()).toHaveLength(1)
  })

  it('upserts estimates and overrides', async () => {
    await repo.setSpendingEstimate('cat', 100)
    await repo.setSpendingEstimate('cat', 200)
    expect((await repo.listSpendingEstimates()).map((e) => e.amount)).toEqual([200])

    await repo.setBudgetOverrides('2026-10-30', [{ key: 'a', amount: 1 }, { key: 'b', amount: 2 }])
    await repo.setBudgetOverride('2026-10-30', 'a', 5)
    await repo.clearBudgetOverride('2026-10-30', 'b')
    const o = await repo.listBudgetOverrides()
    expect(o.map((x) => `${x.key}=${x.amount}`)).toEqual(['a=5'])
  })

  it('exports, validates and re-imports a backup', async () => {
    await repo.saveSettings({ monthlySalary: pesos(50_000), onboardingComplete: true })
    await repo.addFixedBill({ name: 'Rent', amount: pesos(10_000), dueDay: 5 })
    const backup = await repo.exportBackup()
    const text = JSON.stringify(backup)

    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)

    await repo.deleteAllData()
    expect(await repo.getSettings()).toBeUndefined()
    expect(await repo.listFixedBills()).toEqual([])
    expect(await repo.listCategories()).toHaveLength(6)

    if (parsed.ok) await repo.importBackup(parsed.backup)
    expect((await repo.getSettings())?.monthlySalary).toBe(pesos(50_000))
    expect((await repo.listFixedBills()).map((b) => b.name)).toEqual(['Rent'])
  })

  it('rejects bad backups', () => {
    expect(parseBackup('not json')).toMatchObject({ ok: false })
    expect(parseBackup('{"app":"other"}')).toMatchObject({ ok: false, error: 'This file is not an Auto Budget backup.' })
    expect(parseBackup('{"app":"auto-budget","schemaVersion":99}')).toMatchObject({ ok: false })
    expect(parseBackup('{"app":"auto-budget","schemaVersion":1,"exportedAt":"x","data":{}}')).toMatchObject({ ok: false })
  })
})
