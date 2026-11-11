import Dexie, { type Table } from 'dexie'
import type { Account, BudgetOverride, Category, FixedBill, Settings, SpendingEstimate, Transaction } from '@/core'
import { defaultCategories } from './seed'

export type AutoBudgetDB = Dexie & {
  settings: Table<Settings, string>
  accounts: Table<Account, string>
  categories: Table<Category, string>
  fixedBills: Table<FixedBill, string>
  transactions: Table<Transaction, string>
  spendingEstimates: Table<SpendingEstimate, string>
  budgetOverrides: Table<BudgetOverride, string>
}

export const TABLES = [
  'settings',
  'accounts',
  'categories',
  'fixedBills',
  'transactions',
  'spendingEstimates',
  'budgetOverrides',
] as const

export function createDatabase(name = 'auto-budget'): AutoBudgetDB {
  const db = new Dexie(name) as AutoBudgetDB
  // updatedAt is indexed on every table so a future sync can pull changes since a timestamp.
  db.version(1).stores({
    settings: 'id, updatedAt',
    accounts: 'id, type, updatedAt',
    categories: 'id, sortOrder, updatedAt',
    fixedBills: 'id, updatedAt',
    transactions: 'id, date, accountId, categoryId, updatedAt',
    spendingEstimates: 'id, categoryId, updatedAt',
    budgetOverrides: 'id, [periodStart+key], periodStart, updatedAt',
  })
  db.on('populate', async (tx) => {
    await tx.table('categories').bulkAdd(defaultCategories())
  })
  return db
}
