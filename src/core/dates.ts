import type { ISODate, YearMonth } from './types'

/**
 * Calendar-date helpers that work on YYYY-MM-DD strings.
 * All arithmetic goes through UTC so time zones and daylight saving never shift a date.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface DateParts {
  year: number
  /** 1–12 */
  month: number
  day: number
}

export function parseISODate(date: ISODate): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Invalid date: ${date}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

export function isValidISODate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const { year, month, day } = parseISODate(date)
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

export function toISODate(year: number, month: number, day: number): ISODate {
  // Normalise overflow (e.g. month 13) through UTC.
  const d = new Date(Date.UTC(year, month - 1, day))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function toUTC(date: ISODate): number {
  const { year, month, day } = parseISODate(date)
  return Date.UTC(year, month - 1, day)
}

export function addDays(date: ISODate, days: number): ISODate {
  const { year, month, day } = parseISODate(date)
  return toISODate(year, month, day + days)
}

/** Whole days from a to b (b − a). */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000)
}

/** Today's local calendar date. */
export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** A day-of-month setting (1–31) in a given month, clamped to that month's last day. */
export function dayInMonth(year: number, month: number, dayOfMonth: number): ISODate {
  return toISODate(year, month, Math.min(Math.max(1, dayOfMonth), daysInMonth(year, month)))
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: ISODate): number {
  return new Date(toUTC(date)).getUTCDay()
}

/** "2026-11" */
export function yearMonthOf(year: number, month: number): YearMonth {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Moved paydays, keyed by the month of the regular payday (YYYY-MM). */
export type PaydayOverrides = Readonly<Record<YearMonth, ISODate>>

/**
 * How far a payday may move from its regular date. Keeps paydays in order
 * (regular paydays are at least 28 days apart) and ignores stray values.
 */
export const MAX_PAYDAY_SHIFT_DAYS = 10

/** The regular payday in a month, ignoring any moved date. */
export function regularPayday(year: number, month: number, paydayDay: number): ISODate {
  return dayInMonth(year, month, paydayDay)
}

/** The payday that starts the budget month for a calendar month, after any move. */
export function paydayFor(year: number, month: number, paydayDay: number, overrides: PaydayOverrides = {}): ISODate {
  const regular = regularPayday(year, month, paydayDay)
  const moved = overrides[yearMonthOf(year, month)]
  if (!moved || !isValidISODate(moved) || Math.abs(diffDays(regular, moved)) > MAX_PAYDAY_SHIFT_DAYS) return regular
  return moved
}

export interface BudgetPeriod {
  /** First day of the budget month (payday). */
  start: ISODate
  /** Last day (day before the next payday). */
  end: ISODate
  /** 1-based position of the given date inside the period. */
  dayIndex: number
  totalDays: number
}

/**
 * The budget month containing `date`: from payday to the day before the next payday.
 * A payday past the end of a month (e.g. 31 in February) falls on that month's last day.
 * `overrides` moves a given month's payday (weekend or holiday); it may land in the
 * month before, which is why the search starts one month ahead.
 */
export function getBudgetPeriod(date: ISODate, paydayDay: number, overrides: PaydayOverrides = {}): BudgetPeriod {
  const { year, month } = parseISODate(date)
  const payday = (ym: { year: number; month: number }) => paydayFor(ym.year, ym.month, paydayDay, overrides)

  let startYM = shiftMonth(year, month, 1)
  while (payday(startYM) > date) startYM = shiftMonth(startYM.year, startYM.month, -1)

  const start = payday(startYM)
  const nextStart = payday(shiftMonth(startYM.year, startYM.month, 1))
  const end = addDays(nextStart, -1)

  return {
    start,
    end,
    dayIndex: diffDays(start, date) + 1,
    totalDays: diffDays(start, nextStart),
  }
}

/** The budget month before the one given. */
export function getPreviousPeriod(period: BudgetPeriod, paydayDay: number, overrides: PaydayOverrides = {}): BudgetPeriod {
  const prev = getBudgetPeriod(addDays(period.start, -1), paydayDay, overrides)
  return { ...prev, dayIndex: prev.totalDays }
}

/** Every date from start to end, inclusive. */
export function eachDay(range: Pick<BudgetPeriod, 'start' | 'end'>): ISODate[] {
  const out: ISODate[] = []
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) out.push(d)
  return out
}

/** The calendar months a date range touches, in order. */
export function monthsTouched(range: Pick<BudgetPeriod, 'start' | 'end'>): { year: number; month: number }[] {
  const a = parseISODate(range.start)
  const b = parseISODate(range.end)
  const out: { year: number; month: number }[] = []
  for (let ym = { year: a.year, month: a.month }; ym.year * 12 + ym.month <= b.year * 12 + b.month; ym = shiftMonth(ym.year, ym.month, 1)) {
    out.push(ym)
  }
  return out
}

/** `delta` calendar months from a year and month. */
export function addCalendarMonths(year: number, month: number, delta: number): { year: number; month: number } {
  return shiftMonth(year, month, delta)
}

export function isInPeriod(date: ISODate, period: Pick<BudgetPeriod, 'start' | 'end'>): boolean {
  return date >= period.start && date <= period.end
}

/** Next date on or after `from` that falls on `dayOfMonth` (clamped to month end). */
export function nextOccurrence(dayOfMonth: number, from: ISODate): ISODate {
  const { year, month } = parseISODate(from)
  const candidate = dayInMonth(year, month, dayOfMonth)
  if (candidate >= from) return candidate
  const next = shiftMonth(year, month, 1)
  return dayInMonth(next.year, next.month, dayOfMonth)
}

/** "Oct 30" */
export function formatShortDate(date: ISODate): string {
  const { month, day } = parseISODate(date)
  return `${MONTHS[month - 1]} ${day}`
}

/** "Oct 30, 2026" */
export function formatLongDate(date: ISODate): string {
  const { year } = parseISODate(date)
  return `${formatShortDate(date)}, ${year}`
}

/** "Mon, Oct 30" */
export function formatDayHeading(date: ISODate): string {
  const weekday = WEEKDAYS[new Date(toUTC(date)).getUTCDay()]
  return `${weekday}, ${formatShortDate(date)}`
}

/** "Oct 30 to Nov 29" */
export function formatPeriod(period: Pick<BudgetPeriod, 'start' | 'end'>): string {
  return `${formatShortDate(period.start)} to ${formatShortDate(period.end)}`
}

/** "1st", "2nd", "23rd" */
export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** The calendar month that most of the budget month falls in: Oct 30 – Nov 29 → "November". */
export function periodMonthName(period: Pick<BudgetPeriod, 'start' | 'totalDays'>): string {
  const mid = addDays(period.start, Math.floor(period.totalDays / 2))
  return MONTH_NAMES[parseISODate(mid).month - 1]
}

/** "Oct 30 – Nov 29" */
export function formatPeriodDash(period: Pick<BudgetPeriod, 'start' | 'end'>): string {
  return `${formatShortDate(period.start)} – ${formatShortDate(period.end)}`
}
