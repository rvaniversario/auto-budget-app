import { addDays, isInPeriod, type BudgetPeriod } from './dates'
import { sum } from './money'
import { alive, isDebtAccount, type Account, type Centavos, type ISODate, type Transaction } from './types'

/**
 * Balance of an account from its opening balance and every live transaction.
 *
 * Cash/bank: money held.  opening + income − expenses − transfers out + transfers in.
 * Credit card or loan: amount owed. opening + card expenses − transfers into it
 *              (+ transfers out of the card, i.e. cash advances; − income/refunds).
 * A transfer's fee also leaves (or is charged to) the source account.
 */
export function getAccountBalance(account: Account, transactions: readonly Transaction[]): Centavos {
  let held = 0 // movement from the account holder's point of view: + means more money
  for (const t of alive(transactions)) {
    if (t.type === 'transfer') {
      if (t.accountId === account.id) held -= t.amount + transferFee(t)
      if (t.toAccountId === account.id) held += t.amount
    } else if (t.accountId === account.id) {
      held += t.type === 'income' ? t.amount : -t.amount
    }
  }
  return isDebtAccount(account.type) ? account.openingBalance - held : account.openingBalance + held
}

/** Income logged in the period, on any account. This is the month's income: nothing is projected. */
export function incomeTotal(transactions: readonly Transaction[], period: Pick<BudgetPeriod, 'start' | 'end'>): Centavos {
  return sum(transactions.filter((t) => t.type === 'income' && !t.deletedAt && isInPeriod(t.date, period)).map((t) => t.amount))
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

/** A transfer's fee, or 0. Only transfers carry fees. */
export function transferFee(t: Pick<Transaction, 'type' | 'fee'>): Centavos {
  return t.type === 'transfer' && t.fee && t.fee > 0 ? t.fee : 0
}

/** Fees paid on transfers in a period. They are spending, outside any category. */
export function transferFeesTotal(transactions: readonly Transaction[], period: Pick<BudgetPeriod, 'start' | 'end'>): Centavos {
  return sum(
    alive(transactions)
      .filter((t) => isInPeriod(t.date, period))
      .map(transferFee),
  )
}

/** All spending in a period (categories, bills, one-time and transfer fees). */
export function totalSpent(transactions: readonly Transaction[], period: Pick<BudgetPeriod, 'start' | 'end'>): Centavos {
  return sum(expensesInPeriod(transactions, period).map((t) => t.amount)) + transferFeesTotal(transactions, period)
}

/** Payments made to a card, loan or debt (transfers into it) during a period. */
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

/**
 * What is left from every budget month before `start`: income − spending −
 * payments to debts (credit cards, loans and money owed). Negative when
 * earlier months spent more than came in.
 */
export function carryOverBefore(transactions: readonly Transaction[], debtIds: readonly string[], start: ISODate): Centavos {
  const before = { start: '0000-01-01', end: addDays(start, -1) }
  const paid = sum(debtIds.map((id) => cardPaymentsInPeriod(id, transactions, before)))
  return incomeTotal(transactions, before) - totalSpent(transactions, before) - paid
}
