import {
  addCalendarMonths,
  dayInMonth,
  diffDays,
  eachDay,
  getBudgetPeriod,
  getPreviousPeriod,
  isInPeriod,
  monthsTouched,
  parseISODate,
  paydayFor,
  regularPayday,
  weekdayOf,
  yearMonthOf,
  type BudgetPeriod,
} from './dates'
import type { ISODate, PayFrequency, Settings, YearMonth } from './types'

/**
 * Pay schedules. Whatever the frequency, the budget month runs from the day set
 * in `paydayDay` (moved per month by `paydayOverrides`) to the day before the next.
 * The frequency decides how many paydays, and so how much income, fall inside it.
 */

type PaySettings = Pick<
  Settings,
  'payFrequency' | 'paydayDay' | 'secondPaydayDay' | 'payWeekday' | 'workWeekdays' | 'paydayOverrides'
>

export const DEFAULT_PAY_WEEKDAY = 5 // Friday
export const DEFAULT_WORK_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5] // Monday to Friday

/** Twice a month: the payday other than the one starting the month (15th and 30th by default). */
export function secondPayday(settings: Pick<Settings, 'paydayDay' | 'secondPaydayDay'>): number {
  if (settings.secondPaydayDay) return settings.secondPaydayDay
  return settings.paydayDay >= 16 ? settings.paydayDay - 15 : settings.paydayDay + 15
}

export function payWeekday(settings: Pick<Settings, 'payWeekday'>): number {
  return settings.payWeekday ?? DEFAULT_PAY_WEEKDAY
}

export function workWeekdays(settings: Pick<Settings, 'workWeekdays'>): readonly number[] {
  return settings.workWeekdays?.length ? settings.workWeekdays : DEFAULT_WORK_WEEKDAYS
}

/** Whether the day that starts the budget month is itself a payday. */
export function monthStartIsPayday(frequency: PayFrequency): boolean {
  return frequency === 'monthly' || frequency === 'semimonthly'
}

export function budgetPeriodFor(settings: PaySettings, date: ISODate): BudgetPeriod {
  return getBudgetPeriod(date, settings.paydayDay, settings.paydayOverrides)
}

export function previousBudgetPeriod(settings: PaySettings, period: BudgetPeriod): BudgetPeriod {
  return getPreviousPeriod(period, settings.paydayDay, settings.paydayOverrides)
}

/** Every payday inside a budget month, in order. */
export function paydaysInPeriod(settings: PaySettings, period: Pick<BudgetPeriod, 'start' | 'end'>): ISODate[] {
  switch (settings.payFrequency) {
    case 'monthly':
      return [period.start]
    case 'semimonthly': {
      const day = secondPayday(settings)
      const others = monthsTouched(period)
        .map((ym) => dayInMonth(ym.year, ym.month, day))
        .filter((d) => d !== period.start && isInPeriod(d, period))
      return [period.start, ...new Set(others)].sort()
    }
    case 'weekly': {
      const wd = payWeekday(settings)
      return eachDay(period).filter((d) => weekdayOf(d) === wd)
    }
    case 'daily': {
      const days = new Set(workWeekdays(settings))
      return eachDay(period).filter((d) => days.has(weekdayOf(d)))
    }
  }
}

export interface MonthPayday {
  /** Month of the regular payday. */
  yearMonth: YearMonth
  regular: ISODate
  actual: ISODate
  moved: boolean
}

/** The budget-starting payday of `count` calendar months, beginning `fromOffset` months from `today`'s period. */
export function monthPaydays(settings: PaySettings, today: ISODate, fromOffset: number, count: number): MonthPayday[] {
  const anchor = monthOfPeriodStart(budgetPeriodFor(settings, today).start, settings)!
  return Array.from({ length: count }, (_, i) => {
    const ym = addCalendarMonths(anchor.year, anchor.month, fromOffset + i)
    const regular = regularPayday(ym.year, ym.month, settings.paydayDay)
    const actual = paydayFor(ym.year, ym.month, settings.paydayDay, settings.paydayOverrides)
    return { yearMonth: yearMonthOf(ym.year, ym.month), regular, actual, moved: actual !== regular }
  })
}

/**
 * Where a budget month that started on `periodStart` under `before` starts under
 * `after`, so per-month plan edits follow the month when paydays change.
 * Returns `periodStart` unchanged when it is not a month start under `before`.
 */
export function remapPeriodStart(periodStart: ISODate, before: PaySettings, after: PaySettings): ISODate {
  const ym = monthOfPeriodStart(periodStart, before)
  return ym ? paydayFor(ym.year, ym.month, after.paydayDay, after.paydayOverrides) : periodStart
}

/**
 * The calendar month whose payday starts a budget month on `start`. A moved
 * payday can sit in the month before or after its own, so check all three.
 */
function monthOfPeriodStart(start: ISODate, settings: PaySettings): { year: number; month: number } | null {
  const { year, month } = parseISODate(start)
  for (const delta of [0, 1, -1]) {
    const ym = addCalendarMonths(year, month, delta)
    if (paydayFor(ym.year, ym.month, settings.paydayDay, settings.paydayOverrides) === start) return ym
  }
  return null
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday]
}

export function weekdayShort(weekday: number): string {
  return WEEKDAY_SHORT[weekday]
}

/** "Mon–Fri", "Mon–Sat", "Mon, Wed, Fri" */
export function formatWeekdays(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)
  if (sorted.length === 7) return 'Every day'
  const contiguous = sorted.length >= 3 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1)
  if (contiguous) return `${WEEKDAY_SHORT[sorted[0]]}–${WEEKDAY_SHORT[sorted.at(-1)!]}`
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(', ')
}

export const PAY_FREQUENCY_LABEL: Record<PayFrequency, string> = {
  monthly: 'Monthly',
  semimonthly: 'Twice a month',
  weekly: 'Weekly',
  daily: 'Daily',
}

/** Labels for the month's income (the income transactions logged this budget month). */
export const INCOME_LABEL = { short: 'Income', long: 'Income this month' } as const

/** Days a payday moved: negative is earlier. */
export function paydayShift(day: Pick<MonthPayday, 'regular' | 'actual'>): number {
  return diffDays(day.regular, day.actual)
}
