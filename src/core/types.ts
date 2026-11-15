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

/** How often income arrives. The budget month itself always starts on `paydayDay`. */
export type PayFrequency = 'monthly' | 'semimonthly' | 'weekly' | 'daily'
export type ThemePreference = 'light' | 'dark' | 'system'

/** Calendar month, formatted YYYY-MM. */
export type YearMonth = string

export interface Settings extends SyncFields {
  /**
   * Take-home pay for one payday: the whole month for monthly pay, one paycheck
   * for twice-a-month or weekly pay, one day worked for daily pay.
   * (The name predates the other frequencies and is kept for stored data.)
   */
  monthlySalary: Centavos
  payFrequency: PayFrequency
  /**
   * 1–31. The day the budget month starts; for monthly and twice-a-month pay
   * this is a payday. Clamped to the last day of shorter months.
   */
  paydayDay: number
  /** Twice a month: the other payday (1–31). Defaults from paydayDay, see pay.ts. */
  secondPaydayDay?: number
  /** Weekly: the weekday paid, 0 = Sunday … 6 = Saturday. */
  payWeekday?: number
  /** Daily: the weekdays worked and paid, 0 = Sunday … 6 = Saturday. */
  workWeekdays?: number[]
  /**
   * The real date of a month's budget-starting payday when it moves for a
   * weekend or holiday, keyed by the month of the regular payday.
   */
  paydayOverrides?: Record<YearMonth, ISODate>
  bufferAmount: Centavos
  theme: ThemePreference
  onboardingComplete: boolean
}

/**
 * `ewallet` is a mobile wallet such as GCash, Maya or PalawanPay; it behaves like a bank account.
 * `debt` is money owed outside a bank or lender (family, friends); it behaves like a loan,
 * but its monthly payment, due day and interest are optional.
 */
export type AccountType = 'cash' | 'bank' | 'ewallet' | 'credit_card' | 'loan' | 'debt'

/** Accounts whose balance is money owed: credit cards, loans and debts. */
export function isDebtAccount(type: AccountType): boolean {
  return type === 'credit_card' || type === 'loan' || type === 'debt'
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
  /**
   * Transfers only, optional: a charge on top of the amount (InstaPay, cash-in),
   * taken from the source account. It counts as spending; the amount does not.
   */
  fee?: Centavos
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
  /**
   * Transfers only, optional: a charge on top of the amount (InstaPay, cash-in),
   * taken from the source account. It counts as spending; the amount does not.
   */
  fee?: Centavos
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
