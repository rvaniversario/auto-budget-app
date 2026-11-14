import { escapeCell } from './csv'
import { getBudgetPeriod, getPreviousPeriod, isInPeriod, periodMonthName, type BudgetPeriod } from './dates'
import { categoryTotals, getAccountBalance, totalSpent } from './ledger'
import { centavosToInput, formatMoney, sum } from './money'
import { computeMonthModel, type AppSnapshot } from './model'
import { alive, isDebtAccount, type Centavos, type ISODate } from './types'

export interface ReportCategoryRow {
  categoryId: string
  name: string
  kind: 'essential' | 'optional'
  budget: Centavos
  spent: Centavos
}

export interface ReportMonth {
  period: BudgetPeriod
  /** "November" (the calendar month most of the budget month falls in). */
  label: string
  /** False for the month in progress. */
  complete: boolean
  income: Centavos
  /** Every expense: categories, bills and one-time. */
  spending: Centavos
  /** Spending per category (one-time expenses excluded, as in the plan). */
  byCategory: Record<string, Centavos>
  /** The plan for that month, category by category. */
  rows: ReportCategoryRow[]
  /** No category went over its budget. */
  withinBudget: boolean
  /** Card and loan balances owed at the end of the month (or today). */
  debtBalance: Centavos
}

/** The last `count` budget months, oldest first, ending with the current one. */
export function reportMonths(snapshot: AppSnapshot, today: ISODate, count: number): ReportMonth[] {
  const { paydayDay } = snapshot.settings
  const periods: BudgetPeriod[] = [getBudgetPeriod(today, paydayDay)]
  while (periods.length < count) periods.unshift(getPreviousPeriod(periods[0], paydayDay))

  const transactions = alive(snapshot.transactions)
  const debts = alive(snapshot.accounts).filter((a) => isDebtAccount(a.type))

  return periods.map((period, i) => {
    const complete = i < periods.length - 1
    const asOf = complete ? period.end : today
    const model = computeMonthModel(snapshot, complete ? period.end : today)
    const rows = model.categoryRows.map((r) => ({ categoryId: r.categoryId, name: r.name, kind: r.kind, budget: r.budget, spent: r.spent }))
    const upToDate = transactions.filter((t) => t.date <= asOf)
    return {
      period,
      label: periodMonthName(period),
      complete,
      income: sum(transactions.filter((t) => t.type === 'income' && isInPeriod(t.date, period)).map((t) => t.amount)),
      spending: totalSpent(transactions, period),
      byCategory: Object.fromEntries(categoryTotals(transactions, period)),
      rows,
      withinBudget: rows.every((r) => r.spent <= r.budget),
      debtBalance: sum(debts.map((a) => Math.max(0, getAccountBalance(a, upToDate)))),
    }
  })
}

export interface CategoryChange {
  categoryId: string
  name: string
  previous: Centavos
  current: Centavos
  change: Centavos
}

/** Change per category between the last two months given, biggest moves first. */
export function categoryChanges(months: readonly ReportMonth[], names: ReadonlyMap<string, string>): {
  increases: CategoryChange[]
  decreases: CategoryChange[]
} {
  if (months.length < 2) return { increases: [], decreases: [] }
  const [prev, cur] = months.slice(-2)
  const ids = new Set([...Object.keys(prev.byCategory), ...Object.keys(cur.byCategory)])
  const all = [...ids].map((id) => {
    const previous = prev.byCategory[id] ?? 0
    const current = cur.byCategory[id] ?? 0
    return { categoryId: id, name: names.get(id) ?? 'Category', previous, current, change: current - previous }
  })
  return {
    increases: all.filter((c) => c.change > 0).sort((a, b) => b.change - a.change),
    decreases: all.filter((c) => c.change < 0).sort((a, b) => a.change - b.change),
  }
}

/**
 * Plain-sentence observations, from fixed rules (no AI). Only complete months
 * count, so a half-finished month never looks like a drop in spending.
 */
export function reportInsights(months: readonly ReportMonth[], names: ReadonlyMap<string, string>): string[] {
  const done = months.filter((m) => m.complete)
  const out: string[] = []
  if (done.length < 2) return out

  // 1. A category rising several months in a row.
  const streaks: { name: string; months: number }[] = []
  for (const [id, name] of names) {
    let streak = 0
    for (let i = done.length - 1; i > 0; i--) {
      if ((done[i].byCategory[id] ?? 0) > (done[i - 1].byCategory[id] ?? 0)) streak++
      else break
    }
    if (streak >= 3) streaks.push({ name, months: streak })
  }
  for (const s of streaks.sort((a, b) => b.months - a.months).slice(0, 2)) out.push(`${s.name} rose ${s.months} months in a row.`)

  // 2. Staying within budget.
  const within = done.filter((m) => m.withinBudget).length
  if (done.length >= 3) out.push(`You stayed within budget in ${within} of the last ${done.length} months.`)

  // 3. Spending against income.
  const withIncome = done.filter((m) => m.income > 0)
  if (withIncome.length >= 2) {
    const under = withIncome.filter((m) => m.spending < m.income).length
    out.push(`You spent less than you earned in ${under} of ${withIncome.length} months.`)
  }

  // 4. Debt trend across the window.
  const firstDebt = done[0].debtBalance
  const lastDebt = done[done.length - 1].debtBalance
  if (firstDebt > 0 && lastDebt < firstDebt) {
    out.push(`Your card and loan balance fell by ${formatMoney(firstDebt - lastDebt)} over ${done.length} months.`)
  } else if (lastDebt > firstDebt && firstDebt > 0) {
    out.push(`Your card and loan balance grew by ${formatMoney(lastDebt - firstDebt)} over ${done.length} months.`)
  }

  // 5. The biggest drop last month.
  const { decreases } = categoryChanges(done, names)
  if (decreases[0]) out.push(`You spent ${formatMoney(-decreases[0].change)} less on ${decreases[0].name} than the month before.`)

  return out
}

export interface YearMonthSummary {
  /** 1–12 */
  month: number
  income: Centavos
  spending: Centavos
}

export interface YearSummary {
  year: number
  months: YearMonthSummary[]
  income: Centavos
  spending: Centavos
  /** Categories by total spent, largest first. */
  categories: { categoryId: string; name: string; spent: Centavos }[]
}

/** Calendar-year totals (January to December). */
export function yearSummary(snapshot: AppSnapshot, year: number): YearSummary {
  const transactions = alive(snapshot.transactions)
  const names = new Map(snapshot.categories.map((c) => [c.id, c.name]))
  const months: YearMonthSummary[] = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0')
    const range = { start: `${year}-${mm}-01`, end: `${year}-${mm}-31` }
    return {
      month: i + 1,
      income: sum(transactions.filter((t) => t.type === 'income' && isInPeriod(t.date, range)).map((t) => t.amount)),
      spending: totalSpent(transactions, range),
    }
  })
  const yearRange = { start: `${year}-01-01`, end: `${year}-12-31` }
  const byCat = categoryTotals(transactions, yearRange)
  return {
    year,
    months,
    income: sum(months.map((m) => m.income)),
    spending: sum(months.map((m) => m.spending)),
    categories: [...byCat.entries()]
      .map(([categoryId, spent]) => ({ categoryId, name: names.get(categoryId) ?? 'Category', spent }))
      .sort((a, b) => b.spent - a.spent),
  }
}

/** The report's figures as CSV: one row per month, then one column per category. */
export function reportToCSV(months: readonly ReportMonth[], names: ReadonlyMap<string, string>): string {
  const ids = [...names.keys()]
  const header = ['month', 'from', 'to', 'income', 'spending', 'card_and_loan_balance', 'within_budget', ...ids.map((id) => names.get(id)!)]
  const rows = months.map((m) => [
    m.complete ? m.label : `${m.label} (so far)`,
    m.period.start,
    m.period.end,
    centavosToInput(m.income),
    centavosToInput(m.spending),
    centavosToInput(m.debtBalance),
    m.withinBudget ? 'yes' : 'no',
    ...ids.map((id) => centavosToInput(m.byCategory[id] ?? 0)),
  ])
  return [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n'
}
