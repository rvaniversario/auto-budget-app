import { isInPeriod, type BudgetPeriod } from './dates'
import { sum } from './money'
import { alive, type Account, type Centavos, type Transaction } from './types'

/**
 * Balance of an account from its opening balance and every live transaction.
 *
 * Cash/bank: money held.  opening + income − expenses − transfers out + transfers in.
 * Credit card: amount owed. opening + card expenses − transfers into the card
 *              (+ transfers out of the card, i.e. cash advances; − income/refunds).
 */
export function getAccountBalance(account: Account, transactions: readonly Transaction[]): Centavos {
  let held = 0 // movement from the account holder's point of view: + means more money
  for (const t of alive(transactions)) {
    if (t.type === 'transfer') {
      if (t.accountId === account.id) held -= t.amount
      if (t.toAccountId === account.id) held += t.amount
    } else if (t.accountId === account.id) {
      held += t.type === 'income' ? t.amount : -t.amount
    }
  }
  return account.type === 'credit_card' ? account.openingBalance - held : account.openingBalance + held
}

/** Is this transaction spending? Only expenses are. Transfers (including card payments) never are. */
export function isSpending(t: Transaction): boolean {
  return t.type === 'expense' && !t.deletedAt
}

/** Live expenses dated within the period. */
export function expensesInPeriod(transactions: readonly Transaction[], period: Pick<BudgetPeriod, 'start' | 'end'>): Transaction[] {
  return transactions.filter((t) => isSpending(t) && isInPeriod(t.date, period))
}

/**
 * Spending per category in a period. Excludes one-time expenses (they are
 * planned for separately), bill payments without a category, and transfers.
 */
export function categoryTotals(
  transactions: readonly Transaction[],
  period: Pick<BudgetPeriod, 'start' | 'end'>,
): Map<string, Centavos> {
  const totals = new Map<string, Centavos>()
  for (const t of expensesInPeriod(transactions, period)) {
    if (t.isOneTime || !t.categoryId) continue
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) + t.amount)
  }
  return totals
}

/** Total of one-time expenses in a period. */
export function oneTimeTotal(transactions: readonly Transaction[], period: Pick<BudgetPeriod, 'start' | 'end'>): Centavos {
  return sum(expensesInPeriod(transactions, period).filter((t) => t.isOneTime).map((t) => t.amount))
}

/** All spending in a period (categories, bills and one-time). */
export function totalSpent(transactions: readonly Transaction[], period: Pick<BudgetPeriod, 'start' | 'end'>): Centavos {
  return sum(expensesInPeriod(transactions, period).map((t) => t.amount))
}

/** Payments made to a card (transfers into it) during a period. */
export function cardPaymentsInPeriod(
  cardId: string,
  transactions: readonly Transaction[],
  period: Pick<BudgetPeriod, 'start' | 'end'>,
): Centavos {
  return sum(
    alive(transactions)
      .filter((t) => t.type === 'transfer' && t.toAccountId === cardId && isInPeriod(t.date, period))
      .map((t) => t.amount),
  )
}

/** Bill payments in a period: expenses with no category (logged against a fixed bill or "Bills"). */
export function billPaymentsTotal(transactions: readonly Transaction[], period: Pick<BudgetPeriod, 'start' | 'end'>): Centavos {
  return sum(
    expensesInPeriod(transactions, period)
      .filter((t) => !t.isOneTime && !t.categoryId)
      .map((t) => t.amount),
  )
}
