/**
 * Domain types shared by core logic and the data layer.
 * Framework-free: no React, DOM or storage imports anywhere in src/core.
 */

/** Money is always integer centavos (₱1 = 100). Never a float. */
export type Centavos = number

/** Calendar date in local time, formatted YYYY-MM-DD. */
export type ISODate = string

/** Timestamp, ISO 8601 (Date.prototype.toISOString). */
export type ISODateTime = string

/** Fields every stored record carries so it can be synced later. */
export interface SyncFields {
  id: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
  /** Soft delete marker. Records with a value here are ignored everywhere. */
  deletedAt: ISODateTime | null
}

export type PayFrequency = 'monthly' | 'semimonthly'
export type ThemePreference = 'light' | 'dark' | 'system'

export interface Settings extends SyncFields {
  monthlySalary: Centavos
  payFrequency: PayFrequency
  /** 1–31. Clamped to the last day of shorter months. */
  paydayDay: number
  bufferAmount: Centavos
  theme: ThemePreference
  onboardingComplete: boolean
}

export type AccountType = 'cash' | 'bank' | 'credit_card'

export interface Account extends SyncFields {
  name: string
  type: AccountType
  /** For a credit card this is the amount owed when it was added. */
  openingBalance: Centavos
  statementDay: number | null
  dueDay: number | null
  minimumDue: Centavos | null
  /** Percent per month, for example 3 means 3%. */
  monthlyInterestRate: number | null
}

export type CategoryKind = 'essential' | 'optional'

export interface Category extends SyncFields {
  name: string
  kind: CategoryKind
  sortOrder: number
  archived: boolean
}

export interface FixedBill extends SyncFields {
  name: string
  amount: Centavos
  dueDay: number
}

export type TransactionType = 'expense' | 'income' | 'transfer'

export interface Transaction extends SyncFields {
  type: TransactionType
  amount: Centavos
  date: ISODate
  /** Expenses only. Null for bill payments, income and transfers. */
  categoryId: string | null
  accountId: string
  /** Transfers only. */
  toAccountId: string | null
  note: string
  fixedBillId: string | null
  /** Unusual expense: excluded from baselines and category totals. */
  isOneTime: boolean
}

export interface SpendingEstimate extends SyncFields {
  categoryId: string
  amount: Centavos
}

/** Key used in BudgetOverride for a per-month buffer change. */
export const BUFFER_KEY = 'buffer'

/**
 * A user change to this month's plan: a category budget (key = categoryId)
 * or the buffer (key = BUFFER_KEY). Scoped to one budget month.
 */
export interface BudgetOverride extends SyncFields {
  periodStart: ISODate
  key: string
  amount: Centavos
}

/** Records that are not soft-deleted. */
export function alive<T extends { deletedAt: string | null }>(records: readonly T[]): T[] {
  return records.filter((r) => !r.deletedAt)
}
