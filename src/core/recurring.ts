import { addDays, dayInMonth, diffDays, parseISODate } from './dates'
import type { ISODate, RecurringSchedule, RecurringTemplate, Transaction } from './types'

/**
 * The id of a template's occurrence on a date. Deterministic, so two devices
 * that both create the same occurrence produce one record when they sync.
 */
export function occurrenceId(templateId: string, date: ISODate): string {
  return `${templateId}_${date}`
}

/** Dates the schedule falls on between `from` and `to` (inclusive), never before `start`. */
export function scheduleDates(schedule: RecurringSchedule, start: ISODate, from: ISODate, to: ISODate): ISODate[] {
  const lo = from > start ? from : start
  if (lo > to) return []
  const out: ISODate[] = []

  if (schedule.kind === 'weekly') {
    const step = 7 * Math.max(1, Math.floor(schedule.every))
    // First occurrence on or after `lo`, counting in whole steps from `start`.
    const skip = Math.ceil(Math.max(0, diffDays(start, lo)) / step)
    for (let d = addDays(start, skip * step); d <= to; d = addDays(d, step)) out.push(d)
    return out
  }

  const days = schedule.kind === 'monthly' ? [schedule.day] : [...schedule.days].sort((a, b) => a - b)
  const { year, month } = parseISODate(lo)
  for (let i = 0; ; i++) {
    const monthDates = [...new Set(days.map((d) => dayInMonth(year, month + i, d)))]
    if (monthDates[0] > to) break
    for (const d of monthDates) if (d >= lo && d <= to) out.push(d)
  }
  return out
}

/** Short description: "Every month on the 5th", "Every 2 weeks". */
export function describeSchedule(schedule: RecurringSchedule): string {
  const ord = (n: number) => {
    const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
    return `${n}${s}`
  }
  if (schedule.kind === 'monthly') return `Every month on the ${ord(schedule.day)}`
  if (schedule.kind === 'twiceMonthly') return `Twice a month, on the ${ord(schedule.days[0])} and ${ord(schedule.days[1])}`
  return schedule.every === 1 ? 'Every week' : `Every ${schedule.every} weeks`
}

/**
 * Transactions that are due from active templates up to `today` and don't
 * exist yet. `existingIds` must include soft-deleted transactions, so an
 * occurrence the user deleted is never created again.
 */
export function dueOccurrences(
  templates: readonly RecurringTemplate[],
  existingIds: ReadonlySet<string>,
  today: ISODate,
  now: string,
): Transaction[] {
  const out: Transaction[] = []
  for (const t of templates) {
    if (t.deletedAt || t.paused) continue
    const to = t.endDate && t.endDate < today ? t.endDate : today
    for (const date of scheduleDates(t.schedule, t.startDate, t.activeFrom, to)) {
      const id = occurrenceId(t.id, date)
      if (existingIds.has(id)) continue
      out.push({
        id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        type: t.type,
        amount: t.amount,
        date,
        categoryId: t.type === 'expense' ? t.categoryId : null,
        accountId: t.accountId,
        toAccountId: t.type === 'transfer' ? t.toAccountId : null,
        note: t.note,
        fixedBillId: t.fixedBillId,
        isOneTime: false,
        recurringTemplateId: t.id,
      })
    }
  }
  return out
}

/** The next date a template will create a transaction, or null if none. */
export function nextOccurrenceDate(t: RecurringTemplate, today: ISODate): ISODate | null {
  if (t.paused || t.deletedAt) return null
  const from = addDays(today, 1) > t.activeFrom ? addDays(today, 1) : t.activeFrom
  const to = t.endDate ?? addDays(from, 400)
  return scheduleDates(t.schedule, t.startDate, from, to)[0] ?? null
}
