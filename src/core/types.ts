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

export type AccountType = 'cash' | 'bank' | 'credit_card' | 'loan'

/** Accounts whose balance is money owed: credit cards and loans. */
export function isDebtAccount(type: AccountType): boolean {
  return type === 'credit_card' || type === 'loan'
}

export interface Account extends SyncFields {
  name: string
  type: AccountType
  /** For a credit card or loan this is the amount owed when it was added. */
  openingBalance: Centavos
  statementDay: number | null
  dueDay: number | null
  /** A credit card's minimum due, or a loan's monthly minimum payment. */
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
  /** Set when a recurring template created this transaction (Premium). */
  recurringTemplateId?: string | null
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

// ---------------------------------------------------------------------------
// Premium records
// ---------------------------------------------------------------------------

export type RecurringSchedule =
  | { kind: 'monthly'; day: number }
  | { kind: 'twiceMonthly'; days: [number, number] }
  /** Every `every` weeks on the weekday of the start date (1 = weekly). */
  | { kind: 'weekly'; every: number }

/** A transaction that repeats on a schedule. Occurrences are created up to today. */
export interface RecurringTemplate extends SyncFields {
  type: TransactionType
  amount: Centavos
  categoryId: string | null
  accountId: string
  toAccountId: string | null
  note: string
  fixedBillId: string | null
  schedule: RecurringSchedule
  startDate: ISODate
  endDate: ISODate | null
  paused: boolean
  /** No occurrence before this date is created (set on create, edit and resume). */
  activeFrom: ISODate
}

export type DebtStrategy = 'highestInterest' | 'smallestBalance' | 'custom'

/** A one-off extra payment toward debts in a given month, such as 13th-month pay. */
export interface ExtraDebtPayment {
  id: string
  /** YYYY-MM */
  month: string
  amount: Centavos
}

/** The debt payoff plan (a single record). */
export interface DebtPlan extends SyncFields {
  strategy: DebtStrategy
  /** Account ids in the chosen order, for the custom strategy. */
  customOrder: string[]
  /** Null means "use the safe credit card payment". */
  monthlyAmount: Centavos | null
  extras: ExtraDebtPayment[]
  /** Debt-free goal as YYYY-MM, or null. */
  goalMonth: string | null
  /** When true, Home shows this month's planned payment per debt. */
  inUse: boolean
}
