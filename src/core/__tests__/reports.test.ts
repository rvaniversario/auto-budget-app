import { describe, expect, it } from 'vitest'
import { pesos } from '../money'
import { categoryChanges, reportInsights, reportMonths, reportToCSV, yearSummary } from '../reports'
import { account, card, category, estimate, settings, snapshot, tx } from './fixtures'

// Payday on the 1st, so budget months are calendar months: easy to read.
const bank = account({ id: 'bank' })
const visa = card({ id: 'visa', openingBalance: pesos(30_000) })
const dining = category({ id: 'dining', name: 'Dining out', kind: 'optional' })
const food = category({ id: 'food', name: 'Food' })
const names = new Map([
  ['dining', 'Dining out'],
  ['food', 'Food'],
])

function data() {
  const spend = (date: string, categoryId: string, amount: number) => tx({ accountId: 'bank', date, categoryId, amount: pesos(amount) })
  return snapshot({
    settings: settings({ paydayDay: 1, monthlySalary: pesos(40_000) }),
    accounts: [bank, visa],
    categories: [dining, food],
    estimates: [estimate('dining', pesos(1_000)), estimate('food', pesos(5_000))],
    transactions: [
      // Dining out rises July → October; food stays flat.
      spend('2026-07-10', 'dining', 1_000),
      spend('2026-08-10', 'dining', 1_500),
      spend('2026-09-10', 'dining', 2_000),
      spend('2026-10-10', 'dining', 2_600),
      spend('2026-07-11', 'food', 5_000),
      spend('2026-08-11', 'food', 5_000),
      spend('2026-09-11', 'food', 5_000),
      spend('2026-10-11', 'food', 4_000),
      // A one-time expense counts as spending but not in categories.
      tx({ accountId: 'bank', date: '2026-10-20', amount: pesos(3_000), isOneTime: true, categoryId: 'food' }),
      // Income each month.
      ...['07', '08', '09', '10', '11'].map((m) => tx({ accountId: 'bank', type: 'income', date: `2026-${m}-01`, amount: pesos(40_000) })),
      // Card payments bring the balance down; they are never spending.
      tx({ accountId: 'bank', type: 'transfer', toAccountId: 'visa', date: '2026-08-25', amount: pesos(5_000) }),
      tx({ accountId: 'bank', type: 'transfer', toAccountId: 'visa', date: '2026-10-25', amount: pesos(5_000) }),
      spend('2026-11-05', 'dining', 300),
    ],
  })
}

describe('reportMonths', () => {
  const months = reportMonths(data(), '2026-11-12', 5)

  it('lists budget months oldest first, ending with the current one', () => {
    expect(months.map((m) => m.label)).toEqual(['July', 'August', 'September', 'October', 'November'])
    expect(months.map((m) => m.complete)).toEqual([true, true, true, true, false])
  })

  it('totals income, spending and categories', () => {
    const oct = months[3]
    expect(oct.income).toBe(pesos(40_000))
    expect(oct.spending).toBe(pesos(2_600 + 4_000 + 3_000))
    expect(oct.byCategory).toEqual({ dining: pesos(2_600), food: pesos(4_000) })
  })

  it('card payments are not spending, and the debt balance falls with them', () => {
    expect(months[0].debtBalance).toBe(pesos(30_000))
    expect(months[1].debtBalance).toBe(pesos(25_000))
    expect(months[3].debtBalance).toBe(pesos(20_000))
  })

  it('plans each month from the month before it', () => {
    const sep = months[2].rows.find((r) => r.categoryId === 'dining')!
    expect(sep.budget).toBe(pesos(1_500)) // August's dining out, rounded up to ₱100
    expect(sep.spent).toBe(pesos(2_000))
    expect(months[2].withinBudget).toBe(false)
  })
})

describe('changes and insights', () => {
  const months = reportMonths(data(), '2026-11-12', 5)

  it('biggest increases and decreases versus the previous month', () => {
    const { increases, decreases } = categoryChanges(months.slice(0, 4), names)
    expect(increases.map((c) => [c.name, c.change])).toEqual([['Dining out', pesos(600)]])
    expect(decreases.map((c) => [c.name, c.change])).toEqual([['Food', -pesos(1_000)]])
  })

  it('writes plain sentences from rules, using complete months only', () => {
    const insights = reportInsights(months, names)
    expect(insights).toContain('Dining out rose 3 months in a row.')
    expect(insights).toContain('You spent less than you earned in 4 of 4 months.')
    expect(insights).toContain('Your card and loan balance fell by ₱10,000 over 4 months.')
    expect(insights).toContain('You spent ₱1,000 less on Food than the month before.')
    expect(insights.some((s) => s.startsWith('You stayed within budget in'))).toBe(true)
  })

  it('says nothing with less than two complete months', () => {
    expect(reportInsights(reportMonths(data(), '2026-11-12', 1), names)).toEqual([])
  })
})

describe('yearSummary and CSV', () => {
  it('sums the calendar year', () => {
    const y = yearSummary(data(), 2026)
    expect(y.months).toHaveLength(12)
    expect(y.income).toBe(pesos(200_000))
    expect(y.categories[0]).toMatchObject({ name: 'Food', spent: pesos(19_000) })
  })

  it('exports the report figures', () => {
    const csv = reportToCSV(reportMonths(data(), '2026-11-12', 2), names)
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('month,from,to,income,spending,card_and_loan_balance,within_budget,Dining out,Food')
    expect(lines[1]).toBe('October,2026-10-01,2026-10-31,40000,9600,20000,no,2600,4000')
    expect(lines[2].startsWith('November (so far),')).toBe(true)
  })
})
