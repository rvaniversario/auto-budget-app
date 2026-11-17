import type { Table } from 'dexie'
import {
  pesos,
  type Account,
  type AppSnapshot,
  type Category,
  type Centavos,
  type DebtPlan,
  type FixedBill,
  type RecurringTemplate,
  type ISODate,
  type Settings,
  type SyncFields,
  type Transaction,
} from '@/core'
import { BACKUP_APP_ID, BACKUP_SCHEMA_VERSION, type BackupFile } from './backup'
import { createDatabase, TABLES, type AutoBudgetDB } from './db'
import { newId, nextUpdatedAt, nowISO } from './ids'
import type { NewRecord, RecordPatch, Repository } from './repository'
import { defaultCategories } from './seed'

export const DEFAULT_DEBT_PLAN: NewRecord<DebtPlan> = {
  strategy: 'highestInterest',
  customOrder: [],
  monthlyAmount: null,
  extras: [],
  goalMonth: null,
  inUse: false,
}

export const DEFAULT_SETTINGS: NewRecord<Settings> = {
  monthlySalary: 0,
  payFrequency: 'monthly',
  paydayDay: 30,
  bufferAmount: pesos(3_000),
  theme: 'system',
  onboardingComplete: false,
}

function stamp<T extends SyncFields>(input: NewRecord<T>): T {
  const now = nowISO()
  return { ...input, id: newId(), createdAt: now, updatedAt: now, deletedAt: null } as T
}

async function listAlive<T extends SyncFields>(table: Table<T, string>): Promise<T[]> {
  return table.filter((r) => !r.deletedAt).toArray()
}

async function getAlive<T extends SyncFields>(table: Table<T, string>, id: string): Promise<T | undefined> {
  const row = await table.get(id)
  return row && !row.deletedAt ? row : undefined
}

/** Apply a change to one record, moving updatedAt forward (see nextUpdatedAt). */
async function touch<T extends SyncFields>(table: Table<T, string>, id: string, change: (row: T) => void): Promise<void> {
  await table
    .where(':id')
    .equals(id)
    .modify((row: T) => {
      change(row)
      row.updatedAt = nextUpdatedAt(row.updatedAt)
    })
}

async function patch<T extends SyncFields>(table: Table<T, string>, id: string, changes: RecordPatch<T>): Promise<void> {
  // Never let callers overwrite sync fields through a patch.
  const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = changes as Partial<T>
  void _id
  void _c
  void _u
  void _d
  await touch(table, id, (row) => Object.assign(row, rest))
}

async function softDelete<T extends SyncFields>(table: Table<T, string>, id: string): Promise<void> {
  await touch(table, id, (row) => {
    row.deletedAt = nowISO()
  })
}

export class DexieRepository implements Repository {
  readonly db: AutoBudgetDB

  constructor(db: AutoBudgetDB = createDatabase()) {
    this.db = db
  }

  // ---- Settings -----------------------------------------------------------

  async getSettings() {
    const all = await listAlive(this.db.settings)
    return all[0]
  }

  async saveSettings(changes: RecordPatch<Settings>) {
    return this.db.transaction('rw', this.db.settings, async () => {
      const existing = await this.getSettings()
      if (existing) {
        await patch(this.db.settings, existing.id, changes)
        return (await this.db.settings.get(existing.id)) as Settings
      }
      const created = stamp<Settings>({ ...DEFAULT_SETTINGS, ...changes })
      await this.db.settings.add(created)
      return created
    })
  }

  // ---- Accounts -----------------------------------------------------------

  async listAccounts() {
    const order: Record<Account['type'], number> = { cash: 0, bank: 1, ewallet: 2, credit_card: 3, loan: 4, debt: 5 }
    const rows = await listAlive(this.db.accounts)
    return rows.sort((a, b) => order[a.type] - order[b.type] || a.createdAt.localeCompare(b.createdAt))
  }
  getAccount(id: string) {
    return getAlive(this.db.accounts, id)
  }
  async addAccount(input: NewRecord<Account>) {
    const record = stamp<Account>(input)
    await this.db.accounts.add(record)
    return record
  }
  updateAccount(id: string, changes: RecordPatch<Account>) {
    return patch(this.db.accounts, id, changes)
  }
  deleteAccount(id: string) {
    return softDelete(this.db.accounts, id)
  }

  // ---- Categories ---------------------------------------------------------

  async listCategories() {
    const rows = await listAlive(this.db.categories)
    return rows.sort((a, b) => a.sortOrder - b.sortOrder)
  }
  async addCategory(input: NewRecord<Category>) {
    const record = stamp<Category>(input)
    await this.db.categories.add(record)
    return record
  }
  updateCategory(id: string, changes: RecordPatch<Category>) {
    return patch(this.db.categories, id, changes)
  }
  deleteCategory(id: string) {
    return softDelete(this.db.categories, id)
  }

  // ---- Fixed bills --------------------------------------------------------

  async listFixedBills() {
    const rows = await listAlive(this.db.fixedBills)
    return rows.sort((a, b) => a.dueDay - b.dueDay || a.createdAt.localeCompare(b.createdAt))
  }
  async addFixedBill(input: NewRecord<FixedBill>) {
    const record = stamp<FixedBill>(input)
    await this.db.fixedBills.add(record)
    return record
  }
  updateFixedBill(id: string, changes: RecordPatch<FixedBill>) {
    return patch(this.db.fixedBills, id, changes)
  }
  deleteFixedBill(id: string) {
    return softDelete(this.db.fixedBills, id)
  }

  // ---- Transactions -------------------------------------------------------

  async listTransactions() {
    const rows = await listAlive(this.db.transactions)
    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
  }
  getTransaction(id: string) {
    return getAlive(this.db.transactions, id)
  }
  async addTransaction(input: NewRecord<Transaction>) {
    const record = stamp<Transaction>(input)
    await this.db.transactions.add(record)
    return record
  }
  updateTransaction(id: string, changes: RecordPatch<Transaction>) {
    return patch(this.db.transactions, id, changes)
  }
  deleteTransaction(id: string) {
    return softDelete(this.db.transactions, id)
  }
  async restoreTransaction(id: string) {
    await touch(this.db.transactions, id, (row) => {
      row.deletedAt = null
    })
  }

  // ---- Spending estimates -------------------------------------------------

  listSpendingEstimates() {
    return listAlive(this.db.spendingEstimates)
  }

  async setSpendingEstimate(categoryId: string, amount: Centavos) {
    await this.db.transaction('rw', this.db.spendingEstimates, async () => {
      const existing = (await this.db.spendingEstimates.where('categoryId').equals(categoryId).toArray()).find(
        (e) => !e.deletedAt,
      )
      if (existing) await patch(this.db.spendingEstimates, existing.id, { amount })
      else await this.db.spendingEstimates.add(stamp({ categoryId, amount }))
    })
  }

  // ---- Budget overrides ---------------------------------------------------

  listBudgetOverrides() {
    return listAlive(this.db.budgetOverrides)
  }

  private async upsertOverride(periodStart: ISODate, key: string, amount: Centavos) {
    const existing = (await this.db.budgetOverrides.where('[periodStart+key]').equals([periodStart, key]).toArray()).find(
      (o) => !o.deletedAt,
    )
    if (existing) await patch(this.db.budgetOverrides, existing.id, { amount })
    else await this.db.budgetOverrides.add(stamp({ periodStart, key, amount }))
  }

  async setBudgetOverride(periodStart: ISODate, key: string, amount: Centavos) {
    await this.db.transaction('rw', this.db.budgetOverrides, () => this.upsertOverride(periodStart, key, amount))
  }

  async setBudgetOverrides(periodStart: ISODate, entries: { key: string; amount: Centavos }[]) {
    await this.db.transaction('rw', this.db.budgetOverrides, async () => {
      for (const e of entries) await this.upsertOverride(periodStart, e.key, e.amount)
    })
  }

  async moveBudgetOverrides(moves: { from: ISODate; to: ISODate }[]) {
    const real = moves.filter((m) => m.from !== m.to)
    if (!real.length) return
    await this.db.transaction('rw', this.db.budgetOverrides, async () => {
      // Read every source first and retire it, so chained moves (A→B, B→C) don't collide.
      const pending: { to: ISODate; key: string; amount: Centavos }[] = []
      for (const m of real) {
        const rows = (await this.db.budgetOverrides.where('periodStart').equals(m.from).toArray())
          .filter((o) => !o.deletedAt)
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
        for (const r of rows) {
          pending.push({ to: m.to, key: r.key, amount: r.amount })
          await softDelete(this.db.budgetOverrides, r.id)
        }
      }
      for (const p of pending) await this.upsertOverride(p.to, p.key, p.amount)
    })
  }

  async clearBudgetOverride(periodStart: ISODate, key: string) {
    await this.db.transaction('rw', this.db.budgetOverrides, async () => {
      const rows = await this.db.budgetOverrides.where('[periodStart+key]').equals([periodStart, key]).toArray()
      for (const r of rows) if (!r.deletedAt) await softDelete(this.db.budgetOverrides, r.id)
    })
  }

  // ---- Recurring templates (Premium) ---------------------------------------

  async listRecurringTemplates() {
    const rows = await listAlive(this.db.recurringTemplates)
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  async addRecurringTemplate(input: NewRecord<RecurringTemplate>) {
    const record = stamp<RecurringTemplate>(input)
    await this.db.recurringTemplates.add(record)
    return record
  }
  updateRecurringTemplate(id: string, changes: RecordPatch<RecurringTemplate>) {
    return patch(this.db.recurringTemplates, id, changes)
  }
  deleteRecurringTemplate(id: string) {
    return softDelete(this.db.recurringTemplates, id)
  }

  async addRecurringOccurrences(occurrences: Transaction[]): Promise<number> {
    if (!occurrences.length) return 0
    return this.db.transaction('rw', this.db.transactions, async () => {
      // Deterministic ids: skip any that exist, including ones the user deleted.
      const existing = await this.db.transactions.bulkGet(occurrences.map((o) => o.id))
      const fresh = occurrences.filter((_, i) => !existing[i])
      if (fresh.length) await this.db.transactions.bulkAdd(fresh)
      return fresh.length
    })
  }

  // ---- Debt plan (Premium) --------------------------------------------------

  async getDebtPlan() {
    const all = await listAlive(this.db.debtPlans)
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  }

  async saveDebtPlan(changes: RecordPatch<DebtPlan>) {
    return this.db.transaction('rw', this.db.debtPlans, async () => {
      const existing = await this.getDebtPlan()
      if (existing) {
        await patch(this.db.debtPlans, existing.id, changes)
        return (await this.db.debtPlans.get(existing.id)) as DebtPlan
      }
      const created = stamp<DebtPlan>({ ...DEFAULT_DEBT_PLAN, ...changes })
      await this.db.debtPlans.add(created)
      return created
    })
  }

  // ---- Snapshot -----------------------------------------------------------

  async getSnapshot(): Promise<AppSnapshot | null> {
    return this.db.transaction('r', TABLES.map((t) => this.db.table(t)), async () => {
      const settings = await this.getSettings()
      if (!settings) return null
      const [accounts, categories, fixedBills, transactions, estimates, overrides, recurringTemplates, debtPlan] = await Promise.all([
        this.listAccounts(),
        this.listCategories(),
        this.listFixedBills(),
        this.listTransactions(),
        this.listSpendingEstimates(),
        this.listBudgetOverrides(),
        this.listRecurringTemplates(),
        this.getDebtPlan(),
      ])
      return { settings, accounts, categories, fixedBills, transactions, estimates, overrides, recurringTemplates, debtPlan: debtPlan ?? null }
    })
  }

  // ---- Backup -------------------------------------------------------------

  async exportBackup(): Promise<BackupFile> {
    return this.db.transaction('r', TABLES.map((t) => this.db.table(t)), async () => ({
      app: BACKUP_APP_ID,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: nowISO(),
      data: {
        settings: await this.db.settings.toArray(),
        accounts: await this.db.accounts.toArray(),
        categories: await this.db.categories.toArray(),
        fixedBills: await this.db.fixedBills.toArray(),
        transactions: await this.db.transactions.toArray(),
        spendingEstimates: await this.db.spendingEstimates.toArray(),
        budgetOverrides: await this.db.budgetOverrides.toArray(),
        recurringTemplates: await this.db.recurringTemplates.toArray(),
        debtPlans: await this.db.debtPlans.toArray(),
      },
    }))
  }

  /**
   * True when this device is linked to an online account. Replacing or wiping
   * data must then leave tombstones, or the next sync would bring it back.
   */
  private async isLinked(): Promise<boolean> {
    return Boolean((await this.db.syncMeta.get('userId'))?.value)
  }

  async importBackup(backup: BackupFile) {
    const { data } = backup
    const tables = [...TABLES.map((t) => this.db.table(t)), this.db.syncMeta]
    await this.db.transaction('rw', tables, async () => {
      if (!(await this.isLinked())) {
        await Promise.all(TABLES.map((t) => this.db.table(t).clear()))
        for (const t of TABLES) await this.db.table(t).bulkAdd(data[t])
        return
      }
      // Linked: the backup's records must win over the online copy, and records
      // missing from the backup are deleted everywhere.
      const now = nowISO()
      for (const t of TABLES) {
        const table = this.db.table<SyncFields, string>(t)
        const incoming = data[t] as SyncFields[]
        const keep = new Set(incoming.map((r) => r.id))
        await table
          .filter((r) => !keep.has(r.id) && !r.deletedAt)
          .modify((r) => {
            r.deletedAt = now
            r.updatedAt = nextUpdatedAt(r.updatedAt)
          })
        const existing = await table.bulkGet(incoming.map((r) => r.id))
        await table.bulkPut(
          incoming.map((r, i) => {
            const prev = existing[i]?.updatedAt
            const newest = prev && Date.parse(prev) > Date.parse(r.updatedAt) ? prev : r.updatedAt
            return { ...r, updatedAt: nextUpdatedAt(newest) }
          }),
        )
      }
    })
  }

  async deleteAllData() {
    const tables = [...TABLES.map((t) => this.db.table(t)), this.db.syncMeta]
    await this.db.transaction('rw', tables, async () => {
      if (await this.isLinked()) {
        // Soft-delete so the deletion reaches the online backup and other devices.
        const now = nowISO()
        for (const t of TABLES) {
          await this.db
            .table<SyncFields, string>(t)
            .filter((r) => !r.deletedAt)
            .modify((r) => {
              r.deletedAt = now
              r.updatedAt = nextUpdatedAt(r.updatedAt)
            })
        }
      } else {
        await Promise.all(TABLES.map((t) => this.db.table(t).clear()))
      }
      // Income defaults have fixed ids, so they may replace a tombstone just
      // written above; stamp them newer than it so sync keeps the fresh copy.
      const fresh = defaultCategories()
      const previous = await this.db.categories.bulkGet(fresh.map((c) => c.id))
      await this.db.categories.bulkPut(fresh.map((c, i) => (previous[i] ? { ...c, updatedAt: nextUpdatedAt(previous[i]!.updatedAt) } : c)))
    })
  }
}
