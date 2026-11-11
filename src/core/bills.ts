import { dayInMonth, diffDays, isInPeriod, parseISODate, type BudgetPeriod } from './dates'
import { alive, type Centavos, type FixedBill, type ISODate, type Transaction } from './types'

/**
 * The date inside the budget month that falls on `dueDay` (clamped to shorter
 * months), or null when the period has no such day.
 */
export function dueDateInPeriod(dueDay: number, period: Pick<BudgetPeriod, 'start' | 'end'>): ISODate | null {
  const { year, month } = parseISODate(period.start)
  for (const offset of [0, 1]) {
    const candidate = dayInMonth(year, month + offset, dueDay)
    if (isInPeriod(candidate, period)) return candidate
  }
  return null
}

export type BillDueStatus = 'paid' | 'due' | 'overdue'

export interface BillDue {
  bill: FixedBill
  dueDate: ISODate
  status: BillDueStatus
  /** Days from today until the due date (negative when overdue). */
  daysUntil: number
  amount: Centavos
}

/**
 * Fixed bills falling due in this budget month, soonest first. A bill counts as
 * paid when a live expense linked to it (fixedBillId) is dated in the period.
 */
export function billsDueThisPeriod(
  fixedBills: readonly FixedBill[],
  transactions: readonly Transaction[],
  period: Pick<BudgetPeriod, 'start' | 'end'>,
  today: ISODate,
): BillDue[] {
  const paidIds = new Set(
    alive(transactions)
      .filter((t) => t.type === 'expense' && t.fixedBillId && isInPeriod(t.date, period))
      .map((t) => t.fixedBillId as string),
  )
  const rows: BillDue[] = []
  for (const bill of alive(fixedBills)) {
    const dueDate = dueDateInPeriod(bill.dueDay, period)
    if (!dueDate) continue
    const daysUntil = diffDays(today, dueDate)
    const status: BillDueStatus = paidIds.has(bill.id) ? 'paid' : daysUntil < 0 ? 'overdue' : 'due'
    rows.push({ bill, dueDate, status, daysUntil, amount: bill.amount })
  }
  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.bill.name.localeCompare(b.bill.name))
}

/** "Due today", "Due tomorrow", "Due in 4 days", "3 days late". */
export function describeDue(daysUntil: number): string {
  if (daysUntil === 0) return 'Due today'
  if (daysUntil === 1) return 'Due tomorrow'
  if (daysUntil > 1) return `Due in ${daysUntil} days`
  if (daysUntil === -1) return '1 day late'
  return `${-daysUntil} days late`
}
