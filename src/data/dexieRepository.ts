import type { Table } from 'dexie'
import {
  pesos,
  type Account,
  type AppSnapshot,
  type Category,
  type Centavos,
  type FixedBill,
  type ISODate,
  type Settings,
  type SyncFields,
  type Transaction,
} from '@/core'
import { BACKUP_APP_ID, BACKUP_SCHEMA_VERSION, type BackupFile } from './backup'
import { createDatabase, TABLES, type AutoBudgetDB } from './db'
import { newId, nowISO } from './ids'
import type { NewRecord, RecordPatch, Repository } from './repository'
import { defaultCategories } from './seed'

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

async function patch<T extends SyncFields>(table: Table<T, string>, id: string, changes: RecordPatch<T>): Promise<void> {
  // Never let callers overwrite sync fields through a patch.
  const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = changes as Partial<T>
  void _id
  void _c
  void _u
  void _d
  // Dexie's UpdateSpec typing is stricter than our partial; the shape is correct.
  await table.update(id, { ...rest, updatedAt: nowISO() } as never)
}

async function softDelete<T extends SyncFields>(table: Table<T, string>, id: string): Promise<void> {
  const now = nowISO()
  await table.update(id, { deletedAt: now, updatedAt: now } as never)
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
    const order: Record<Account['type'], number> = { cash: 0, bank: 1, credit_card: 2 }
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
    await this.db.transactions.update(id, { deletedAt: null, updatedAt: nowISO() })
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

  async clearBudgetOverride(periodStart: ISODate, key: string) {
    await this.db.transaction('rw', this.db.budgetOverrides, async () => {
      const rows = await this.db.budgetOverrides.where('[periodStart+key]').equals([periodStart, key]).toArray()
      for (const r of rows) if (!r.deletedAt) await softDelete(this.db.budgetOverrides, r.id)
    })
  }

  // ---- Snapshot -----------------------------------------------------------

  async getSnapshot(): Promise<AppSnapshot | null> {
    return this.db.transaction('r', TABLES.map((t) => this.db.table(t)), async () => {
      const settings = await this.getSettings()
      if (!settings) return null
      const [accounts, categories, fixedBills, transactions, estimates, overrides] = await Promise.all([
        this.listAccounts(),
        this.listCategories(),
        this.listFixedBills(),
        this.listTransactions(),
        this.listSpendingEstimates(),
        this.listBudgetOverrides(),
      ])
      return { settings, accounts, categories, fixedBills, transactions, estimates, overrides }
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
      },
    }))
  }

  async importBackup(backup: BackupFile) {
    const { data } = backup
    await this.db.transaction('rw', TABLES.map((t) => this.db.table(t)), async () => {
      await Promise.all(TABLES.map((t) => this.db.table(t).clear()))
      await this.db.settings.bulkAdd(data.settings)
      await this.db.accounts.bulkAdd(data.accounts)
      await this.db.categories.bulkAdd(data.categories)
      await this.db.fixedBills.bulkAdd(data.fixedBills)
      await this.db.transactions.bulkAdd(data.transactions)
      await this.db.spendingEstimates.bulkAdd(data.spendingEstimates)
      await this.db.budgetOverrides.bulkAdd(data.budgetOverrides)
    })
  }

  async deleteAllData() {
    await this.db.transaction('rw', TABLES.map((t) => this.db.table(t)), async () => {
      await Promise.all(TABLES.map((t) => this.db.table(t).clear()))
      await this.db.categories.bulkAdd(defaultCategories())
    })
  }
}
