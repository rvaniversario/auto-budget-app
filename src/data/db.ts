import Dexie, { type Table } from 'dexie'
import type {
  Account,
  BudgetOverride,
  Category,
  DebtPlan,
  FixedBill,
  RecurringTemplate,
  Settings,
  SpendingEstimate,
  Transaction,
} from '@/core'
import { defaultCategories, INCOME_DEFAULTS, INCOME_DEFAULTS_UPDATED_AT, incomeCategory } from './seed'

/** The version of a record the server is known to hold. Key: `${collection}:${id}`. */
export interface SyncStateRow {
  key: string
  updatedAt: string
}

/** Small key-value store for the sync engine (cursor, linked account, device id). */
export interface SyncMetaRow {
  key: string
  value: unknown
}

export type AutoBudgetDB = Dexie & {
  settings: Table<Settings, string>
  accounts: Table<Account, string>
  categories: Table<Category, string>
  fixedBills: Table<FixedBill, string>
  transactions: Table<Transaction, string>
  spendingEstimates: Table<SpendingEstimate, string>
  budgetOverrides: Table<BudgetOverride, string>
  recurringTemplates: Table<RecurringTemplate, string>
  debtPlans: Table<DebtPlan, string>
  syncState: Table<SyncStateRow, string>
  syncMeta: Table<SyncMetaRow, string>
  localCache: Table<SyncMetaRow, string>
}

/** Tables holding the user's data. These are backed up, exported and synced. */
export const TABLES = [
  'settings',
  'accounts',
  'categories',
  'fixedBills',
  'transactions',
  'spendingEstimates',
  'budgetOverrides',
  'recurringTemplates',
  'debtPlans',
] as const

export type DataTable = (typeof TABLES)[number]

const DATA_TABLES = new Set<string>(TABLES)

type ChangeListener = (table: DataTable) => void
const changeListeners = new Set<ChangeListener>()

/** Called after any write to a data table commits to the page (any database instance). */
export function onLocalChange(listener: ChangeListener): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

export function createDatabase(name = 'auto-budget'): AutoBudgetDB {
  const db = new Dexie(name) as AutoBudgetDB
  // updatedAt is indexed on every table so sync can find changes since a timestamp.
  db.version(1).stores({
    settings: 'id, updatedAt',
    accounts: 'id, type, updatedAt',
    categories: 'id, sortOrder, updatedAt',
    fixedBills: 'id, updatedAt',
    transactions: 'id, date, accountId, categoryId, updatedAt',
    spendingEstimates: 'id, categoryId, updatedAt',
    budgetOverrides: 'id, [periodStart+key], periodStart, updatedAt',
  })
  // Version 2: online backup and sync bookkeeping. Existing stores are untouched.
  db.version(2).stores({
    syncState: 'key',
    syncMeta: 'key',
  })
  // Version 3 (Premium): recurring templates, the debt plan, and a device-only
  // cache (the last known entitlement). Existing stores are untouched.
  db.version(3).stores({
    recurringTemplates: 'id, updatedAt',
    debtPlans: 'id, updatedAt',
    localCache: 'key',
  })
  // Version 4: add the default income categories to budgets made before they
  // existed. Skips any name already present, including deleted ones, so a
  // category the user removed doesn't come back.
  db.version(4)
    .stores({})
    .upgrade(async (tx) => {
      const existing = (await tx.table('categories').toArray()) as Category[]
      const names = new Set(existing.map((c) => c.name.trim().toLowerCase()))
      const ids = new Set(existing.map((c) => c.id))
      let sortOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1
      const missing = INCOME_DEFAULTS.filter((d) => !names.has(d.name.toLowerCase()) && !ids.has(d.id))
      await tx.table('categories').bulkAdd(missing.map((d) => incomeCategory(d, sortOrder++, INCOME_DEFAULTS_UPDATED_AT)))
    })
  db.on('populate', async (tx) => {
    await tx.table('categories').bulkAdd(defaultCategories())
  })
  // Tell the sync engine when user data changes, whichever code path wrote it.
  db.use({
    stack: 'dbcore',
    name: 'auto-budget-change-notify',
    create(down) {
      return {
        ...down,
        table(tableName) {
          const table = down.table(tableName)
          if (!DATA_TABLES.has(tableName)) return table
          return {
            ...table,
            mutate(req) {
              return table.mutate(req).then((res) => {
                for (const listener of changeListeners) listener(tableName as DataTable)
                return res
              })
            },
          }
        },
      }
    },
  })
  return db
}
