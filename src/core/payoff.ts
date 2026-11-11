import { dayInMonth, parseISODate } from './dates'
import { applyRate } from './money'
import type { Centavos, ISODate } from './types'

export const PAYOFF_MONTH_CAP = 120

/** Interest charged next month on whatever is left unpaid: (balance − payment) × rate. */
export function estimateNextMonthInterest(balance: Centavos, payment: Centavos, monthlyRatePercent: number): Centavos {
  const unpaid = Math.max(0, balance - payment)
  return applyRate(unpaid, monthlyRatePercent)
}

export interface PayoffResult {
  /** Months until the balance reaches zero. Equals the cap when it never does. */
  months: number
  totalInterest: Centavos
  neverPaysOff: boolean
}

/**
 * Pay the same amount every month, with no new card spending.
 * Each month: subtract the payment, then add interest on what remains.
 */
export function simulatePayoff(balance: Centavos, monthlyPayment: Centavos, monthlyRatePercent: number): PayoffResult {
  if (balance <= 0) return { months: 0, totalInterest: 0, neverPaysOff: false }
  if (monthlyPayment <= 0) return { months: PAYOFF_MONTH_CAP, totalInterest: 0, neverPaysOff: true }

  // If the first month's interest is at least the payment, the balance never falls.
  const firstInterest = applyRate(balance - monthlyPayment, monthlyRatePercent)
  if (monthlyPayment < balance && monthlyPayment <= firstInterest) {
    return { months: PAYOFF_MONTH_CAP, totalInterest: 0, neverPaysOff: true }
  }

  let remaining = balance
  let totalInterest = 0
  for (let month = 1; month <= PAYOFF_MONTH_CAP; month++) {
    remaining -= monthlyPayment
    if (remaining <= 0) return { months: month, totalInterest, neverPaysOff: false }
    const interest = applyRate(remaining, monthlyRatePercent)
    totalInterest += interest
    remaining += interest
  }
  return { months: PAYOFF_MONTH_CAP, totalInterest, neverPaysOff: true }
}

export interface PayoffRow {
  /** Due date of this payment. */
  date: ISODate
  /** Amount paid (the last payment may be smaller). */
  payment: Centavos
  /** Interest added after this payment. */
  interest: Centavos
  /** Balance still owed after the payment and interest. */
  owed: Centavos
}

/**
 * Month-by-month payoff schedule using the same rule as simulatePayoff:
 * pay, then add interest on what remains. Due dates repeat on the same day of
 * the month as `firstDueDate` (clamped to shorter months).
 */
export function payoffSchedule(
  balance: Centavos,
  monthlyPayment: Centavos,
  monthlyRatePercent: number,
  firstDueDate: ISODate,
  maxRows = PAYOFF_MONTH_CAP,
): PayoffRow[] {
  const rows: PayoffRow[] = []
  if (balance <= 0 || monthlyPayment <= 0) return rows
  const { year, month, day } = parseISODate(firstDueDate)
  let owed = balance
  for (let i = 0; i < maxRows && owed > 0; i++) {
    const payment = Math.min(monthlyPayment, owed)
    owed -= payment
    const interest = owed > 0 ? applyRate(owed, monthlyRatePercent) : 0
    owed += interest
    rows.push({ date: dayInMonth(year, month + i, day), payment, interest, owed })
  }
  return rows
}

/** Plain-language payoff time: "about 4 months", "1 year 2 months". */
export function describeMonths(months: number): string {
  if (months <= 0) return 'Paid off now'
  if (months === 1) return '1 month'
  if (months < 12) return `${months} months`
  const years = Math.floor(months / 12)
  const rest = months % 12
  const y = years === 1 ? '1 year' : `${years} years`
  if (rest === 0) return y
  return `${y} ${rest === 1 ? '1 month' : `${rest} months`}`
}
