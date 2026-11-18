import { describe, expect, it } from 'vitest'
import { getBudgetPeriod, getPreviousPeriod, MAX_PAYDAY_SHIFT_DAYS, addDays } from '../dates'
import { computeMonthModel } from '../model'
import { pesos } from '../money'
import {
  budgetPeriodFor,
  formatWeekdays,
  monthPaydays,
  paydaysInPeriod,
  remapPeriodStart,
  secondPayday,
} from '../pay'
import { settings, snapshot, tx } from './fixtures'

describe('moved paydays', () => {
  // Nov 30 2026 is a Monday; Jan 30 2027 is a Saturday.
  const overrides = { '2026-11': '2026-11-27', '2027-01': '2027-01-29' }

  it('starts the budget month on the moved date and ends the month before a day earlier', () => {
    const before = getBudgetPeriod('2026-11-26', 30, overrides)
    expect(before.start).toBe('2026-10-30')
    expect(before.end).toBe('2026-11-26')
    expect(before.totalDays).toBe(28)

    const after = getBudgetPeriod('2026-11-27', 30, overrides)
    expect(after.start).toBe('2026-11-27')
    expect(after.end).toBe('2026-12-29')
    expect(after.dayIndex).toBe(1)
  })

  it('handles a payday moved into the previous month', () => {
    // Payday on the 1st, Jan 2028 moved back to Dec 31.
    const o = { '2028-01': '2027-12-31' }
    const p = getBudgetPeriod('2027-12-31', 1, o)
    expect(p.start).toBe('2027-12-31')
    expect(p.end).toBe('2028-01-31')
    expect(getBudgetPeriod('2027-12-30', 1, o).end).toBe('2027-12-30')
  })

  it('handles a payday moved into the next month', () => {
    const o = { '2027-01': '2027-02-01' } // payday 31 → Jan 31 moved to Feb 1
    expect(getBudgetPeriod('2027-01-31', 31, o).start).toBe('2026-12-31')
    expect(getBudgetPeriod('2027-02-01', 31, o)).toMatchObject({ start: '2027-02-01', end: '2027-02-27' })
  })

  it('previous period honours moves', () => {
    const p = getBudgetPeriod('2026-12-10', 30, overrides)
    const prev = getPreviousPeriod(p, 30, overrides)
    expect(prev).toMatchObject({ start: '2026-10-30', end: '2026-11-26' })
  })

  it('ignores a move further than the limit', () => {
    const far = { '2026-11': addDays('2026-11-30', -(MAX_PAYDAY_SHIFT_DAYS + 1)) }
    expect(getBudgetPeriod('2026-11-25', 30, far).start).toBe('2026-10-30')
  })

  it('lists month paydays with their moves, from the current one', () => {
    const s = settings({ paydayOverrides: overrides })
    const list = monthPaydays(s, '2026-12-05', 0, 3)
    expect(list.map((m) => [m.yearMonth, m.actual, m.moved])).toEqual([
      ['2026-11', '2026-11-27', true],
      ['2026-12', '2026-12-30', false],
      ['2027-01', '2027-01-29', true],
    ])
  })

  it('remaps a budget month start to the moved date', () => {
    const before = settings()
    const after = settings({ paydayOverrides: overrides })
    expect(remapPeriodStart('2026-11-30', before, after)).toBe('2026-11-27')
    expect(remapPeriodStart('2026-10-30', before, after)).toBe('2026-10-30')
    expect(remapPeriodStart('2026-11-27', after, before)).toBe('2026-11-30')
  })
})

describe('pay frequency', () => {
  const period = { start: '2026-11-01', end: '2026-11-30' } // Sun Nov 1 – Mon Nov 30

  it('monthly: one payday', () => {
    const s = settings({ paydayDay: 1, monthlySalary: pesos(40_000) })
    expect(paydaysInPeriod(s, period)).toEqual(['2026-11-01'])
  })

  it('twice a month: both paydays, with a default second day', () => {
    const s = settings({ payFrequency: 'semimonthly', paydayDay: 30, monthlySalary: pesos(15_000) })
    expect(secondPayday(s)).toBe(15)
    const p = budgetPeriodFor(s, '2026-11-11')
    expect(paydaysInPeriod(s, p)).toEqual(['2026-10-30', '2026-11-15'])
    expect(secondPayday({ paydayDay: 15 })).toBe(30)
    expect(secondPayday({ paydayDay: 5, secondPaydayDay: 20 })).toBe(20)
  })

  it('weekly: every chosen weekday in the month (4 or 5)', () => {
    const s = settings({ payFrequency: 'weekly', paydayDay: 1, payWeekday: 5, monthlySalary: pesos(5_000) })
    expect(paydaysInPeriod(s, period)).toEqual(['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27'])
    const mondays = settings({ payFrequency: 'weekly', payWeekday: 1 })
    expect(paydaysInPeriod(mondays, period)).toHaveLength(5)
  })

  it('daily: every working day', () => {
    const s = settings({ payFrequency: 'daily', paydayDay: 1, monthlySalary: pesos(800) })
    expect(paydaysInPeriod(s, period)).toHaveLength(21) // Mon–Fri in November 2026
    const sixDays = settings({ payFrequency: 'daily', workWeekdays: [1, 2, 3, 4, 5, 6] })
    expect(paydaysInPeriod(sixDays, period)).toHaveLength(25)
  })

  it('the month model uses the income logged this budget month, not a set amount', () => {
    const s = settings({ payFrequency: 'weekly', paydayDay: 1, payWeekday: 5, monthlySalary: pesos(99_000) })
    const income = (date: string, amount: number, deletedAt: string | null = null) =>
      tx({ accountId: 'bank', type: 'income', date, amount: pesos(amount), deletedAt })
    const transactions = [
      income('2026-10-30', 7_000), // last budget month: not counted
      income('2026-11-06', 5_000),
      income('2026-11-10', 1_200),
      income('2026-11-09', 500, '2026-11-09T10:00:00Z'), // deleted
      tx({ accountId: 'bank', type: 'transfer', toAccountId: 'visa', date: '2026-11-07', amount: pesos(300) }), // not income
    ]
    const m = computeMonthModel(snapshot({ settings: s, transactions }), '2026-11-11')
    expect(m.income).toBe(pesos(6_200))
    expect(m.safeInput.salary).toBe(pesos(6_200))
    expect(m.plan.salary).toBe(pesos(6_200))
    expect(m.remaining).toBe(pesos(6_200))
    expect(m.paydays).toHaveLength(4)
  })

  it('formats weekdays', () => {
    expect(formatWeekdays([1, 2, 3, 4, 5])).toBe('Mon–Fri')
    expect(formatWeekdays([5, 1, 3])).toBe('Mon, Wed, Fri')
    expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
  })
})
