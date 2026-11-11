import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysInMonth,
  diffDays,
  formatDayHeading,
  formatPeriod,
  getBudgetPeriod,
  getPreviousPeriod,
  isInPeriod,
  isValidISODate,
  nextOccurrence,
  ordinal,
  todayISO,
} from '../dates'

describe('getBudgetPeriod', () => {
  it('runs from payday to the day before the next payday (payday on the 30th)', () => {
    const p = getBudgetPeriod('2026-11-11', 30)
    expect(p.start).toBe('2026-10-30')
    expect(p.end).toBe('2026-11-29')
    expect(p.totalDays).toBe(31)
    expect(p.dayIndex).toBe(13)
    expect(formatPeriod(p)).toBe('Oct 30 to Nov 29')
  })

  it('starts a new period on payday itself', () => {
    const p = getBudgetPeriod('2026-11-30', 30)
    expect(p.start).toBe('2026-11-30')
    expect(p.dayIndex).toBe(1)
  })

  it('handles payday on the 31st in February (non-leap year)', () => {
    const feb = getBudgetPeriod('2026-02-28', 31)
    expect(feb.start).toBe('2026-02-28')
    expect(feb.end).toBe('2026-03-30')
    expect(feb.totalDays).toBe(31)

    const beforeFebPayday = getBudgetPeriod('2026-02-27', 31)
    expect(beforeFebPayday.start).toBe('2026-01-31')
    expect(beforeFebPayday.end).toBe('2026-02-27')
    expect(beforeFebPayday.totalDays).toBe(28)
  })

  it('handles payday on the 31st in a leap-year February', () => {
    const p = getBudgetPeriod('2028-02-29', 31)
    expect(p.start).toBe('2028-02-29')
    expect(p.end).toBe('2028-03-30')
    expect(getBudgetPeriod('2028-02-28', 31).end).toBe('2028-02-28')
  })

  it('crosses year boundaries', () => {
    const p = getBudgetPeriod('2027-01-03', 15)
    expect(p.start).toBe('2026-12-15')
    expect(p.end).toBe('2027-01-14')
  })

  it('works with payday on the 1st', () => {
    const p = getBudgetPeriod('2026-03-01', 1)
    expect(p.start).toBe('2026-03-01')
    expect(p.end).toBe('2026-03-31')
    expect(p.totalDays).toBe(31)
  })

  it('previous period ends the day before the current one starts', () => {
    const p = getBudgetPeriod('2026-11-11', 30)
    const prev = getPreviousPeriod(p, 30)
    expect(prev.start).toBe('2026-09-30')
    expect(prev.end).toBe('2026-10-29')
  })

  it('previous period around February with payday 31', () => {
    const march = getBudgetPeriod('2026-03-31', 31)
    expect(march.start).toBe('2026-03-31')
    const prev = getPreviousPeriod(march, 31)
    expect(prev.start).toBe('2026-02-28')
    expect(prev.end).toBe('2026-03-30')
  })
})

describe('date helpers', () => {
  it('daysInMonth', () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('addDays and diffDays', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(diffDays('2026-10-30', '2026-11-30')).toBe(31)
  })

  it('isInPeriod is inclusive', () => {
    const p = { start: '2026-10-30', end: '2026-11-29' }
    expect(isInPeriod('2026-10-30', p)).toBe(true)
    expect(isInPeriod('2026-11-29', p)).toBe(true)
    expect(isInPeriod('2026-11-30', p)).toBe(false)
  })

  it('nextOccurrence clamps to month end', () => {
    expect(nextOccurrence(25, '2026-11-11')).toBe('2026-11-25')
    expect(nextOccurrence(5, '2026-11-11')).toBe('2026-12-05')
    expect(nextOccurrence(31, '2026-02-10')).toBe('2026-02-28')
    expect(nextOccurrence(11, '2026-11-11')).toBe('2026-11-11')
  })

  it('isValidISODate', () => {
    expect(isValidISODate('2026-02-29')).toBe(false)
    expect(isValidISODate('2028-02-29')).toBe(true)
    expect(isValidISODate('2026-13-01')).toBe(false)
    expect(isValidISODate('nope')).toBe(false)
  })

  it('todayISO uses local date parts', () => {
    expect(todayISO(new Date(2026, 10, 11, 23, 59))).toBe('2026-11-11')
  })

  it('formatting', () => {
    expect(formatDayHeading('2026-11-11')).toBe('Wed, Nov 11')
    expect(ordinal(1)).toBe('1st')
    expect(ordinal(2)).toBe('2nd')
    expect(ordinal(3)).toBe('3rd')
    expect(ordinal(11)).toBe('11th')
    expect(ordinal(22)).toBe('22nd')
    expect(ordinal(30)).toBe('30th')
  })
})
