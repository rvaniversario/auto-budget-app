import { describe, expect, it } from 'vitest'
import { billsDueThisPeriod, describeDue, dueDateInPeriod } from '../bills'
import { getBudgetPeriod } from '../dates'
import { pesos } from '../money'
import { payoffSchedule, simulatePayoff } from '../payoff'
import { account, bill, tx } from './fixtures'

describe('payoffSchedule', () => {
  it('matches the worked example (₱50,000, ₱15,000 a month, 3%)', () => {
    const rows = payoffSchedule(pesos(50_000), pesos(15_000), 3, '2026-11-25')
    // Exact centavos; the design shows these rounded to whole pesos
    // (₱1,050 / ₱632 / ₱200 interest, ₱6,882 final payment).
    expect(rows).toEqual([
      { date: '2026-11-25', payment: pesos(15_000), interest: pesos(1_050), owed: pesos(36_050) },
      { date: '2026-12-25', payment: pesos(15_000), interest: 631_50, owed: 2_168_150 },
      { date: '2027-01-25', payment: pesos(15_000), interest: 200_45, owed: 688_195 },
      { date: '2027-02-25', payment: 688_195, interest: 0, owed: 0 },
    ])
  })

  it('agrees with simulatePayoff on months and total interest', () => {
    const rows = payoffSchedule(pesos(80_000), pesos(9_000), 3.5, '2026-11-15')
    const sim = simulatePayoff(pesos(80_000), pesos(9_000), 3.5)
    expect(rows).toHaveLength(sim.months)
    expect(rows.reduce((a, r) => a + r.interest, 0)).toBe(sim.totalInterest)
  })

  it('clamps due dates in short months', () => {
    const rows = payoffSchedule(pesos(10_000), pesos(3_000), 0, '2027-01-31')
    expect(rows.map((r) => r.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30'])
  })

  it('stops at maxRows when the payment never clears the balance', () => {
    expect(payoffSchedule(pesos(50_000), pesos(1_000), 3, '2026-11-25', 12)).toHaveLength(12)
  })

  it('returns nothing for zero balance or payment', () => {
    expect(payoffSchedule(0, pesos(1_000), 3, '2026-11-25')).toEqual([])
    expect(payoffSchedule(pesos(1_000), 0, 3, '2026-11-25')).toEqual([])
  })
})

describe('dueDateInPeriod', () => {
  const period = getBudgetPeriod('2026-11-11', 30) // Oct 30 – Nov 29

  it('finds the occurrence inside the budget month', () => {
    expect(dueDateInPeriod(5, period)).toBe('2026-11-05')
    expect(dueDateInPeriod(30, period)).toBe('2026-10-30')
    expect(dueDateInPeriod(31, period)).toBe('2026-10-31')
  })

  it('returns null when the period has no matching day', () => {
    // Payday 31: Jan 31 – Feb 27. Day 28 falls on Jan 28 (before) and Feb 28 (after).
    expect(dueDateInPeriod(28, getBudgetPeriod('2026-02-10', 31))).toBeNull()
  })
})

describe('billsDueThisPeriod', () => {
  const period = getBudgetPeriod('2026-11-11', 30)
  const bank = account()
  const rent = bill({ name: 'Rent', dueDay: 30, amount: pesos(8_000) })
  const water = bill({ name: 'Water', dueDay: 12, amount: pesos(500) })
  const net = bill({ name: 'Internet', dueDay: 15, amount: pesos(1_300) })
  const power = bill({ name: 'Electricity', dueDay: 8, amount: pesos(2_200) })

  it('marks paid, due and overdue bills, soonest first', () => {
    const rows = billsDueThisPeriod(
      [rent, water, net, power],
      [
        tx({ accountId: bank.id, fixedBillId: rent.id, amount: pesos(8_000), date: '2026-10-30' }),
        // Paid last period: doesn't count.
        tx({ accountId: bank.id, fixedBillId: power.id, amount: pesos(2_200), date: '2026-10-08' }),
        // Soft-deleted payment: doesn't count.
        tx({ accountId: bank.id, fixedBillId: water.id, amount: pesos(500), date: '2026-11-01', deletedAt: '2026-11-02T00:00:00Z' }),
      ],
      period,
      '2026-11-11',
    )
    expect(rows.map((r) => [r.bill.name, r.dueDate, r.status, r.daysUntil])).toEqual([
      ['Rent', '2026-10-30', 'paid', -12],
      ['Electricity', '2026-11-08', 'overdue', -3],
      ['Water', '2026-11-12', 'due', 1],
      ['Internet', '2026-11-15', 'due', 4],
    ])
  })

  it('describeDue', () => {
    expect(describeDue(0)).toBe('Due today')
    expect(describeDue(1)).toBe('Due tomorrow')
    expect(describeDue(4)).toBe('Due in 4 days')
    expect(describeDue(-1)).toBe('1 day late')
    expect(describeDue(-3)).toBe('3 days late')
  })
})
