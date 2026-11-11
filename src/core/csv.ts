import { centavosToInput } from './money'
import { alive, type Account, type Category, type FixedBill, type Transaction } from './types'

function escapeCell(value: string): string {
  // Neutralise spreadsheet formula injection, then quote when needed.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export interface CsvLookups {
  categories: readonly Category[]
  accounts: readonly Account[]
  fixedBills: readonly FixedBill[]
}

/** Live transactions as CSV, oldest first. Amounts are in pesos with up to two decimals. */
export function transactionsToCSV(transactions: readonly Transaction[], lookups: CsvLookups): string {
  const categoryName = new Map(lookups.categories.map((c) => [c.id, c.name]))
  const accountName = new Map(lookups.accounts.map((a) => [a.id, a.name]))
  const billName = new Map(lookups.fixedBills.map((b) => [b.id, b.name]))

  const header = ['date', 'type', 'amount', 'category', 'bill', 'account', 'to_account', 'note', 'one_time']
  const rows = alive(transactions)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((t) => [
      t.date,
      t.type,
      centavosToInput(t.amount),
      t.categoryId ? (categoryName.get(t.categoryId) ?? '') : '',
      t.fixedBillId ? (billName.get(t.fixedBillId) ?? '') : '',
      accountName.get(t.accountId) ?? '',
      t.toAccountId ? (accountName.get(t.toAccountId) ?? '') : '',
      t.note,
      t.isOneTime ? 'yes' : 'no',
    ])

  return [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n'
}
