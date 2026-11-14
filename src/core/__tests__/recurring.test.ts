import { describe, expect, it } from 'vitest'
import { pesos } from '../money'
import { describeSchedule, dueOccurrences, nextOccurrenceDate, occurrenceId, scheduleDates } from '../recurring'
import type { RecurringTemplate } from '../types'

const NOW = '2026-11-12T00:00:00.000Z'

function template(over: Partial<RecurringTemplate> = {}): RecurringTemplate {
  return {
    id: 'tpl',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    type: 'expense',
    amount: pesos(12_000),
    categoryId: 'cat',
    accountId: 'bank',
    toAccountId: 'ignored',
    note: 'Rent',
    fixedBillId: null,
    schedule: { kind: 'monthly', day: 5 },
    startDate: '2026-09-05',
    endDate: null,
    paused: false,
    activeFrom: '2026-09-05',
    ...over,
  }
}

describe('scheduleDates', () => {
  it('monthly, clamped to short months', () => {
    expect(scheduleDates({ kind: 'monthly', day: 31 }, '2026-01-31', '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('twice a month', () => {
    expect(scheduleDates({ kind: 'twiceMonthly', days: [30, 15] }, '2026-02-01', '2026-02-01', '2026-03-20')).toEqual([
      '2026-02-15',
      '2026-02-28',
      '2026-03-15',
    ])
  })

  it('weekly and every N weeks count from the start date', () => {
    expect(scheduleDates({ kind: 'weekly', every: 1 }, '2026-11-02', '2026-11-02', '2026-11-20')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
    expect(scheduleDates({ kind: 'weekly', every: 2 }, '2026-11-02', '2026-11-10', '2026-12-31')).toEqual([
      '2026-11-16',
      '2026-11-30',
      '2026-12-14',
      '2026-12-28',
    ])
  })

  it('nothing before the start date', () => {
    expect(scheduleDates({ kind: 'monthly', day: 1 }, '2026-06-15', '2026-01-01', '2026-07-31')).toEqual(['2026-07-01'])
  })
})

describe('dueOccurrences', () => {
  it('creates every due occurrence up to today with deterministic ids', () => {
    const out = dueOccurrences([template()], new Set(), '2026-11-12', NOW)
    expect(out.map((t) => t.date)).toEqual(['2026-09-05', '2026-10-05', '2026-11-05'])
    expect(out[0]).toMatchObject({ id: occurrenceId('tpl', '2026-09-05'), recurringTemplateId: 'tpl', amount: pesos(12_000), toAccountId: null })
  })

  it('two devices create the same ids, so sync merges them', () => {
    const a = dueOccurrences([template()], new Set(), '2026-11-12', NOW).map((t) => t.id)
    const b = dueOccurrences([template()], new Set(), '2026-11-12', '2026-11-12T09:00:00.000Z').map((t) => t.id)
    expect(a).toEqual(b)
  })

  it('skips existing occurrences, including ones the user deleted', () => {
    const existing = new Set([occurrenceId('tpl', '2026-09-05'), occurrenceId('tpl', '2026-10-05')])
    expect(dueOccurrences([template()], existing, '2026-11-12', NOW).map((t) => t.date)).toEqual(['2026-11-05'])
  })

  it('paused, deleted and ended templates stop creating', () => {
    expect(dueOccurrences([template({ paused: true })], new Set(), '2026-11-12', NOW)).toEqual([])
    expect(dueOccurrences([template({ deletedAt: NOW })], new Set(), '2026-11-12', NOW)).toEqual([])
    expect(dueOccurrences([template({ endDate: '2026-10-01' })], new Set(), '2026-11-12', NOW).map((t) => t.date)).toEqual(['2026-09-05'])
  })

  it('edits and resumes apply from activeFrom onwards only', () => {
    expect(dueOccurrences([template({ activeFrom: '2026-10-06' })], new Set(), '2026-11-12', NOW).map((t) => t.date)).toEqual(['2026-11-05'])
  })

  it('transfers keep the destination; income has no category', () => {
    const [transfer] = dueOccurrences([template({ type: 'transfer', toAccountId: 'card', startDate: '2026-11-05', activeFrom: '2026-11-05' })], new Set(), '2026-11-12', NOW)
    expect(transfer).toMatchObject({ toAccountId: 'card', categoryId: null })
    const [income] = dueOccurrences([template({ type: 'income', startDate: '2026-11-05', activeFrom: '2026-11-05' })], new Set(), '2026-11-12', NOW)
    expect(income.categoryId).toBeNull()
  })
})

describe('nextOccurrenceDate and describeSchedule', () => {
  it('next date after today', () => {
    expect(nextOccurrenceDate(template(), '2026-11-12')).toBe('2026-12-05')
    expect(nextOccurrenceDate(template({ paused: true }), '2026-11-12')).toBeNull()
    expect(nextOccurrenceDate(template({ endDate: '2026-11-30' }), '2026-11-12')).toBeNull()
  })
  it('plain descriptions', () => {
    expect(describeSchedule({ kind: 'monthly', day: 22 })).toBe('Every month on the 22nd')
    expect(describeSchedule({ kind: 'twiceMonthly', days: [15, 30] })).toBe('Twice a month, on the 15th and 30th')
    expect(describeSchedule({ kind: 'weekly', every: 1 })).toBe('Every week')
    expect(describeSchedule({ kind: 'weekly', every: 3 })).toBe('Every 3 weeks')
  })
})
