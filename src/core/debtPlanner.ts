import { applyRate, sum } from './money'
import type { Centavos, DebtStrategy } from './types'

/** Months simulated at most (30 years). */
export const DEBT_MONTH_CAP = 360

export interface Debt {
  id: string
  name: string
  balance: Centavos
  /** Percent per month. */
  monthlyRate: number
  /** Paid every month while the debt has a balance. */
  minimumPayment: Centavos
}

export interface PlannerExtra {
  /** 0 = the first simulated month. */
  monthIndex: number
  amount: Centavos
}

export interface DebtMonth {
  /** 0-based month index. */
  index: number
  /** Paid to each debt this month. */
  payments: Record<string, Centavos>
  /** Owed on each debt after the payment and interest. */
  balances: Record<string, Centavos>
  interest: Centavos
  totalBalance: Centavos
}

export interface DebtResult {
  /** Months until every debt is paid. Equals the cap when they never are. */
  months: number
  neverPaysOff: boolean
  totalInterest: Centavos
  /** Per debt: month index in which it is cleared (null if never), and interest paid. */
  perDebt: Record<string, { payoffMonth: number | null; interest: Centavos }>
  schedule: DebtMonth[]
}

/** The order extra money goes to debts. Ties keep the input order. */
export function orderDebts(debts: readonly Debt[], strategy: DebtStrategy, customOrder: readonly string[] = []): Debt[] {
  const list = [...debts]
  if (strategy === 'highestInterest') return list.sort((a, b) => b.monthlyRate - a.monthlyRate || a.balance - b.balance)
  if (strategy === 'smallestBalance') return list.sort((a, b) => a.balance - b.balance || b.monthlyRate - a.monthlyRate)
  const rank = new Map(customOrder.map((id, i) => [id, i]))
  return list.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
}

export function sumMinimums(debts: readonly Debt[]): Centavos {
  return sum(debts.filter((d) => d.balance > 0).map((d) => d.minimumPayment))
}

/**
 * Pay off several debts with a fixed monthly amount.
 *
 * Each month: pay every debt its minimum (or what is left of it), then put
 * the rest toward the first unpaid debt in `strategy` order, then the next.
 * When a debt is cleared its minimum rolls into the remainder automatically,
 * because the monthly amount stays the same. Interest is then added on what
 * remains, the same rule as simulatePayoff.
 *
 * Stops at DEBT_MONTH_CAP and reports `neverPaysOff` when the payments don't
 * outrun the interest.
 */
export function simulateDebts(
  debts: readonly Debt[],
  monthlyAmount: Centavos,
  strategy: DebtStrategy,
  extras: readonly PlannerExtra[] = [],
  options: { customOrder?: readonly string[]; rollover?: boolean } = {},
): DebtResult {
  const ordered = orderDebts(debts, strategy, options.customOrder)
  const rollover = options.rollover ?? true
  const balance = new Map(ordered.map((d) => [d.id, Math.max(0, d.balance)]))
  const perDebt: DebtResult['perDebt'] = Object.fromEntries(
    ordered.map((d) => [d.id, { payoffMonth: d.balance <= 0 ? 0 : null, interest: 0 }]),
  )
  const extraByMonth = new Map<number, Centavos>()
  for (const e of extras) extraByMonth.set(e.monthIndex, (extraByMonth.get(e.monthIndex) ?? 0) + Math.max(0, e.amount))

  const schedule: DebtMonth[] = []
  let totalInterest = 0
  const owed = () => sum([...balance.values()])
  if (owed() === 0) return { months: 0, neverPaysOff: false, totalInterest: 0, perDebt, schedule }

  let previousTotal = Infinity
  let stalled = 0
  for (let month = 0; month < DEBT_MONTH_CAP; month++) {
    let available = monthlyAmount + (extraByMonth.get(month) ?? 0)
    const payments: Record<string, Centavos> = {}
    const pay = (id: string, amount: Centavos) => {
      const paid = Math.min(amount, balance.get(id)!, available)
      if (paid <= 0) return
      balance.set(id, balance.get(id)! - paid)
      payments[id] = (payments[id] ?? 0) + paid
      available -= paid
    }
    // 1. Minimums.
    for (const d of ordered) if (balance.get(d.id)! > 0) pay(d.id, d.minimumPayment)
    // 2. The rest, in order (with rollover off, only extras go beyond minimums).
    if (!rollover) available = Math.min(available, extraByMonth.get(month) ?? 0)
    for (const d of ordered) if (available > 0 && balance.get(d.id)! > 0) pay(d.id, available)
    // 3. Interest on what remains.
    let interest = 0
    for (const d of ordered) {
      const b = balance.get(d.id)!
      if (b <= 0) {
        if (perDebt[d.id].payoffMonth === null) perDebt[d.id].payoffMonth = month
        continue
      }
      const i = applyRate(b, d.monthlyRate)
      balance.set(d.id, b + i)
      perDebt[d.id].interest += i
      interest += i
    }
    totalInterest += interest
    const total = owed()
    schedule.push({ index: month, payments, balances: Object.fromEntries(balance), interest, totalBalance: total })
    if (total === 0) return { months: month + 1, neverPaysOff: false, totalInterest, perDebt, schedule }

    // Payments that don't beat the interest never finish; stop early instead of running 30 years.
    stalled = total >= previousTotal ? stalled + 1 : 0
    previousTotal = total
    if (stalled >= 3 && !hasLaterExtras(extraByMonth, month)) {
      return { months: DEBT_MONTH_CAP, neverPaysOff: true, totalInterest, perDebt, schedule }
    }
  }
  return { months: DEBT_MONTH_CAP, neverPaysOff: true, totalInterest, perDebt, schedule }
}

function hasLaterExtras(extras: Map<number, Centavos>, month: number): boolean {
  for (const m of extras.keys()) if (m > month) return true
  return false
}

/** Paying only each debt's minimum, with nothing rolled over when a debt is cleared. */
export function simulateMinimumsOnly(debts: readonly Debt[]): DebtResult {
  return simulateDebts(debts, sumMinimums(debts), 'highestInterest', [], { rollover: false })
}

export interface PlanComparison {
  monthsSaved: number
  interestSaved: Centavos
  /** The minimums-only plan never finishes. */
  minimumsNeverPayOff: boolean
}

export function compareWithMinimums(plan: DebtResult, minimums: DebtResult): PlanComparison {
  return {
    monthsSaved: Math.max(0, minimums.months - plan.months),
    interestSaved: Math.max(0, minimums.totalInterest - plan.totalInterest),
    minimumsNeverPayOff: minimums.neverPaysOff,
  }
}

/**
 * Goal mode: the smallest monthly amount (rounded up to ₱100) that clears every
 * debt within `targetMonths`. Never below the sum of minimums. Null when even
 * paying everything in the first month can't meet it (targetMonths < 1).
 */
export function requiredMonthlyAmount(
  debts: readonly Debt[],
  targetMonths: number,
  strategy: DebtStrategy,
  extras: readonly PlannerExtra[] = [],
  customOrder: readonly string[] = [],
): Centavos | null {
  if (targetMonths < 1) return null
  const total = sum(debts.map((d) => Math.max(0, d.balance)))
  if (total === 0) return 0
  const STEP = 10_000 // ₱100
  const fits = (amount: Centavos) => {
    const r = simulateDebts(debts, amount, strategy, extras, { customOrder })
    return !r.neverPaysOff && r.months <= targetMonths
  }
  let lo = Math.ceil(sumMinimums(debts) / STEP)
  let hi = Math.ceil(total / STEP) + 1 // paying everything at once always fits a 1-month target
  if (fits(lo * STEP)) return lo * STEP
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (fits(mid * STEP)) hi = mid
    else lo = mid
  }
  return hi * STEP
}

/** Whole months from one YYYY-MM to another (0 when the same month). */
export function monthsBetween(fromYearMonth: string, toYearMonth: string): number {
  const [fy, fm] = fromYearMonth.split('-').map(Number)
  const [ty, tm] = toYearMonth.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

/** YYYY-MM that is `offset` months after `yearMonth`. */
export function addMonths(yearMonth: string, offset: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const index = y * 12 + (m - 1) + offset
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}
