import { pesos } from '../money'
import type {
  Account,
  BudgetOverride,
  Category,
  FixedBill,
  Settings,
  SpendingEstimate,
  SyncFields,
  Transaction,
} from '../types'
import type { AppSnapshot } from '../model'

let counter = 0
const meta = (prefix: string): SyncFields => ({
  id: `${prefix}-${++counter}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
})

export function settings(partial: Partial<Settings> = {}): Settings {
  return {
    ...meta('settings'),
    monthlySalary: pesos(60_000),
    payFrequency: 'monthly',
    paydayDay: 30,
    bufferAmount: pesos(3_000),
    theme: 'system',
    onboardingComplete: true,
    ...partial,
  }
}

export function account(partial: Partial<Account> = {}): Account {
  return {
    ...meta('acct'),
    name: 'Bank',
    type: 'bank',
    openingBalance: 0,
    statementDay: null,
    dueDay: null,
    minimumDue: null,
    monthlyInterestRate: null,
    ...partial,
  }
}

export function card(partial: Partial<Account> = {}): Account {
  return account({
    name: 'Visa',
    type: 'credit_card',
    openingBalance: pesos(50_000),
    statementDay: 5,
    dueDay: 25,
    minimumDue: pesos(2_500),
    monthlyInterestRate: 3,
    ...partial,
  })
}

export function category(partial: Partial<Category> = {}): Category {
  return { ...meta('cat'), name: 'Groceries', kind: 'essential', sortOrder: 0, archived: false, ...partial }
}

export function bill(partial: Partial<FixedBill> = {}): FixedBill {
  return { ...meta('bill'), name: 'Rent', amount: pesos(12_000), dueDay: 5, ...partial }
}

export function tx(partial: Partial<Transaction> & Pick<Transaction, 'accountId'>): Transaction {
  return {
    ...meta('tx'),
    type: 'expense',
    amount: pesos(100),
    date: '2026-11-01',
    categoryId: null,
    toAccountId: null,
    note: '',
    fixedBillId: null,
    isOneTime: false,
    ...partial,
  }
}

export function estimate(categoryId: string, amount: number): SpendingEstimate {
  return { ...meta('est'), categoryId, amount }
}

export function override(periodStart: string, key: string, amount: number, updatedAt = '2026-11-01T00:00:00.000Z'): BudgetOverride {
  return { ...meta('ovr'), periodStart, key, amount, updatedAt }
}

export function snapshot(partial: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    settings: settings(),
    accounts: [],
    categories: [],
    fixedBills: [],
    transactions: [],
    estimates: [],
    overrides: [],
    ...partial,
  }
}
