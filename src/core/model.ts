import { getCategoryBaselines, hasHistory } from './baseline'
import {
  buildBudgetPlan,
  buildCategoryBudgets,
  getCategoryStatus,
  percentUsed,
  totalByKind,
  type BudgetPlan,
  type CategoryBudget,
  type CategoryStatus,
} from './budget'
import { nextOccurrence, type BudgetPeriod } from './dates'
import { budgetPeriodFor, paydaysInPeriod, periodIncome, previousBudgetPeriod } from './pay'
import { billPaymentsTotal, cardPaymentsInPeriod, categoryTotals, getAccountBalance, oneTimeTotal, totalSpent } from './ledger'
import { sum } from './money'
import { estimateNextMonthInterest, simulatePayoff, type PayoffResult } from './payoff'
import {
  computeSafePayment,
  splitAcrossCards,
  weightedRate,
  type CardAllocation,
  type SafePaymentInput,
  type SafePaymentResult,
} from './safePayment'
import { suggestOverspendFix, suggestShortfallFixes, type OverspendFix, type ShortfallOption } from './suggestions'
import {
  alive,
  BUFFER_KEY,
  type Account,
  type BudgetOverride,
  type Category,
  type Centavos,
  type DebtPlan,
  type RecurringTemplate,
  type FixedBill,
  type ISODate,
  type Settings,
  type SpendingEstimate,
  type Transaction,
} from './types'

/** Everything stored on the device, as plain records. */
export interface AppSnapshot {
  settings: Settings
  accounts: readonly Account[]
  categories: readonly Category[]
  fixedBills: readonly FixedBill[]
  transactions: readonly Transaction[]
  estimates: readonly SpendingEstimate[]
  overrides: readonly BudgetOverride[]
  /** Premium: recurring transaction templates. */
  recurringTemplates?: readonly RecurringTemplate[]
  /** Premium: the debt payoff plan, if one was saved. */
  debtPlan?: DebtPlan | null
}

export interface CardSummary {
  account: Account
  /** Owed right now. */
  balance: Centavos
  /** Payments made to this card during the current budget month. */
  paidThisPeriod: Centavos
  /** Owed at the start of the month (balance + payments made since). Used for the plan. */
  planBalance: Centavos
  minimumDue: Centavos
  monthlyInterestRate: number
  nextDueDate: ISODate | null
  allocation: CardAllocation
}

export interface CategoryRow extends CategoryBudget {
  spent: Centavos
  remaining: Centavos
  status: CategoryStatus
  percent: number
  overBy: Centavos
}

export interface OverspendAlert {
  row: CategoryRow
  fix: OverspendFix
}

export interface MonthModel {
  today: ISODate
  period: BudgetPeriod
  previousPeriod: BudgetPeriod
  /** Paydays inside this budget month. */
  paydays: ISODate[]
  /** Expected take-home income this budget month (pay per payday × paydays). */
  income: Centavos
  hasHistory: boolean
  isEstimate: boolean
  categoryRows: CategoryRow[]
  fixedBillsTotal: Centavos
  oneTimeTotal: Centavos
  buffer: Centavos
  bufferIsOverride: boolean
  cards: CardSummary[]
  cardRate: number
  safeInput: SafePaymentInput
  safe: SafePaymentResult
  /** Safe amount minus what has already been paid this month. */
  leftToPay: Centavos
  paidToCardsThisPeriod: Centavos
  plan: BudgetPlan
  spentSoFar: Centavos
  /** Bill payments logged this month (expenses without a category). */
  billsPaid: Centavos
  remaining: Centavos
  overspent: OverspendAlert[]
  shortfallOptions: ShortfallOption[]
  ifYouPay: {
    unpaidBalance: Centavos
    nextMonthInterest: Centavos
    payoff: PayoffResult
  }
}

/** Overrides for one budget month as key → amount (latest edit wins). */
export function overridesForPeriod(overrides: readonly BudgetOverride[], periodStart: ISODate): Map<string, Centavos> {
  const map = new Map<string, Centavos>()
  const relevant = alive(overrides)
    .filter((o) => o.periodStart === periodStart)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  for (const o of relevant) map.set(o.key, o.amount)
  return map
}

export function computeMonthModel(data: AppSnapshot, today: ISODate): MonthModel {
  const { settings } = data
  const transactions = alive(data.transactions)
  const categories = alive(data.categories)
  const fixedBills = alive(data.fixedBills)
  const accounts = alive(data.accounts)

  const period = budgetPeriodFor(settings, today)
  const previousPeriod = previousBudgetPeriod(settings, period)
  const paydays = paydaysInPeriod(settings, period)
  const income = periodIncome(settings, period)
  const ctx = { transactions, estimates: data.estimates, previousPeriod }
  const history = hasHistory(ctx)

  const activeCategories = categories.filter((c) => !c.archived)
  const baselines = getCategoryBaselines(
    activeCategories.map((c) => c.id),
    ctx,
  )
  const overrides = overridesForPeriod(data.overrides, period.start)
  const budgets = buildCategoryBudgets(activeCategories, baselines, overrides)

  const spentByCategory = categoryTotals(transactions, period)
  const categoryRows: CategoryRow[] = budgets.map((b) => {
    const spent = spentByCategory.get(b.categoryId) ?? 0
    return {
      ...b,
      spent,
      remaining: b.budget - spent,
      status: getCategoryStatus(spent, b.budget),
      percent: percentUsed(spent, b.budget),
      overBy: Math.max(0, spent - b.budget),
    }
  })

  const buffer = overrides.get(BUFFER_KEY) ?? settings.bufferAmount
  const fixedBillsTotal = sum(fixedBills.map((b) => b.amount))
  const oneTime = oneTimeTotal(transactions, period)

  // Credit cards
  const creditCards = accounts.filter((a) => a.type === 'credit_card')
  const cardInputs = creditCards.map((account) => {
    const balance = getAccountBalance(account, transactions)
    const paid = cardPaymentsInPeriod(account.id, transactions, period)
    return {
      account,
      balance,
      paidThisPeriod: paid,
      planBalance: Math.max(0, balance + paid),
      minimumDue: account.minimumDue ?? 0,
      monthlyInterestRate: account.monthlyInterestRate ?? 0,
      nextDueDate: account.dueDay ? nextOccurrence(account.dueDay, today) : null,
    }
  })

  const safeInput: SafePaymentInput = {
    salary: income,
    fixedBillsTotal,
    essentialTotal: totalByKind(budgets, 'essential'),
    optionalTotal: totalByKind(budgets, 'optional'),
    oneTimeTotal: oneTime,
    buffer,
    cardBalance: sum(cardInputs.map((c) => c.planBalance)),
    minimumDue: sum(cardInputs.map((c) => Math.min(c.minimumDue, c.planBalance))),
    isEstimate: budgets.some((b) => b.baseline.isEstimate && !b.isOverride),
  }
  const safe = computeSafePayment(safeInput)

  const splitInput = cardInputs.map((c) => ({
    id: c.account.id,
    balance: c.planBalance,
    minimumDue: c.minimumDue,
    monthlyInterestRate: c.monthlyInterestRate,
  }))
  const allocations = splitAcrossCards(safe.amount, splitInput)
  const cards: CardSummary[] = cardInputs.map((c, i) => ({ ...c, allocation: allocations[i] }))
  const cardRate = weightedRate(splitInput)
  const paidToCardsThisPeriod = sum(cards.map((c) => c.paidThisPeriod))

  const plan = buildBudgetPlan({
    salary: income,
    fixedBills,
    categoryBudgets: budgets,
    safe,
    buffer,
    oneTimeTotal: oneTime,
    hasCard: creditCards.length > 0,
  })

  const spentSoFar = totalSpent(transactions, period)

  const usage = categoryRows.map((r) => ({
    categoryId: r.categoryId,
    name: r.name,
    kind: r.kind,
    budget: r.budget,
    spent: r.spent,
  }))
  const overspent: OverspendAlert[] = categoryRows
    .filter((r) => r.status === 'over')
    .sort((a, b) => b.overBy - a.overBy)
    .map((row) => ({ row, fix: suggestOverspendFix(row.categoryId, row.overBy, usage, buffer) }))

  const optionalAvailable = sum(
    categoryRows.filter((r) => r.kind === 'optional').map((r) => Math.max(0, r.budget - r.spent)),
  )

  return {
    today,
    period,
    previousPeriod,
    paydays,
    income,
    hasHistory: history,
    isEstimate: safe.isEstimate,
    categoryRows,
    fixedBillsTotal,
    oneTimeTotal: oneTime,
    buffer,
    bufferIsOverride: overrides.has(BUFFER_KEY),
    cards,
    cardRate,
    safeInput,
    safe,
    leftToPay: Math.max(0, safe.amount - paidToCardsThisPeriod),
    paidToCardsThisPeriod,
    plan,
    spentSoFar,
    billsPaid: billPaymentsTotal(transactions, period),
    remaining: income - spentSoFar - paidToCardsThisPeriod,
    overspent,
    shortfallOptions: suggestShortfallFixes(safe.shortfall, buffer, optionalAvailable),
    ifYouPay: {
      unpaidBalance: Math.max(0, safe.cardBalance - safe.amount),
      nextMonthInterest: estimateNextMonthInterest(safe.cardBalance, safe.amount, cardRate),
      payoff: simulatePayoff(safe.cardBalance, safe.amount, cardRate),
    },
  }
}
