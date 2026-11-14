import { describe, expect, it } from 'vitest'
import {
  addMonths,
  compareWithMinimums,
  DEBT_MONTH_CAP,
  monthsBetween,
  orderDebts,
  requiredMonthlyAmount,
  simulateDebts,
  simulateMinimumsOnly,
  sumMinimums,
  type Debt,
} from '../debtPlanner'
import { pesos } from '../money'
import { simulatePayoff } from '../payoff'

const card: Debt = { id: 'card', name: 'Card', balance: pesos(50_000), monthlyRate: 3, minimumPayment: pesos(2_500) }
const loan: Debt = { id: 'loan', name: 'Loan', balance: pesos(20_000), monthlyRate: 1, minimumPayment: pesos(1_000) }
const small: Debt = { id: 'small', name: 'Small card', balance: pesos(5_000), monthlyRate: 2, minimumPayment: pesos(500) }

describe('orderDebts', () => {
  it('highest interest first', () => {
    expect(orderDebts([loan, small, card], 'highestInterest').map((d) => d.id)).toEqual(['card', 'small', 'loan'])
  })
  it('smallest balance first', () => {
    expect(orderDebts([card, loan, small], 'smallestBalance').map((d) => d.id)).toEqual(['small', 'loan', 'card'])
  })
  it('custom order, unknown ids last', () => {
    expect(orderDebts([card, loan, small], 'custom', ['loan', 'card']).map((d) => d.id)).toEqual(['loan', 'card', 'small'])
  })
})

describe('simulateDebts', () => {
  it('matches the single-card payoff for one debt', () => {
    const one = simulateDebts([card], pesos(15_000), 'highestInterest')
    const ref = simulatePayoff(card.balance, pesos(15_000), card.monthlyRate)
    expect(one.months).toBe(ref.months)
    expect(one.totalInterest).toBe(ref.totalInterest)
    expect(one.neverPaysOff).toBe(false)
  })

  it('pays minimums first, then the rest to the first debt in order', () => {
    const r = simulateDebts([card, loan], pesos(10_000), 'highestInterest')
    expect(r.schedule[0].payments).toEqual({ card: pesos(9_000), loan: pesos(1_000) })
    const r2 = simulateDebts([card, loan], pesos(10_000), 'smallestBalance')
    expect(r2.schedule[0].payments).toEqual({ card: pesos(2_500), loan: pesos(7_500) })
  })

  it('rolls a cleared debt’s payment into the next one', () => {
    const r = simulateDebts([small, card], pesos(8_000), 'smallestBalance')
    // Month 1: small gets its 500 minimum + the 5,000 rest → cleared; card gets 2,500.
    expect(r.perDebt.small.payoffMonth).toBe(0)
    expect(r.schedule[1].payments).toEqual({ card: pesos(8_000) })
  })

  it('the debt-free month is when the last debt clears', () => {
    const r = simulateDebts([card, loan, small], pesos(12_000), 'highestInterest')
    const last = Math.max(...Object.values(r.perDebt).map((p) => p.payoffMonth ?? Infinity))
    expect(r.months).toBe(last + 1)
    expect(r.schedule.at(-1)!.totalBalance).toBe(0)
  })

  it('highest interest first costs less interest than smallest balance first', () => {
    const avalanche = simulateDebts([card, loan, small], pesos(9_000), 'highestInterest')
    const snowball = simulateDebts([card, loan, small], pesos(9_000), 'smallestBalance')
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest)
  })

  it('one-off extra payments shorten the plan', () => {
    const base = simulateDebts([card, loan], pesos(6_000), 'highestInterest')
    const withBonus = simulateDebts([card, loan], pesos(6_000), 'highestInterest', [{ monthIndex: 1, amount: pesos(20_000) }])
    expect(withBonus.months).toBeLessThan(base.months)
    expect(withBonus.totalInterest).toBeLessThan(base.totalInterest)
    expect(withBonus.schedule[1].payments.card).toBe(pesos(20_000 + 5_000))
  })

  it('never pays off when payments do not exceed interest', () => {
    const r = simulateDebts([card], pesos(1_000), 'highestInterest')
    expect(r.neverPaysOff).toBe(true)
    expect(r.months).toBe(DEBT_MONTH_CAP)
  })

  it('is capped at 360 months', () => {
    const slow: Debt = { id: 'slow', name: 'Slow', balance: pesos(1_000_000), monthlyRate: 0, minimumPayment: pesos(1_000) }
    const r = simulateDebts([slow], pesos(1_000), 'highestInterest')
    expect(r.months).toBe(DEBT_MONTH_CAP)
    expect(r.neverPaysOff).toBe(true)
    expect(r.schedule).toHaveLength(DEBT_MONTH_CAP)
  })

  it('no debts means debt-free now', () => {
    expect(simulateDebts([], pesos(1_000), 'highestInterest')).toMatchObject({ months: 0, neverPaysOff: false, totalInterest: 0 })
  })
})

describe('minimums-only comparison', () => {
  it('paying only minimums takes longer and costs more', () => {
    const plan = simulateDebts([card, loan], pesos(12_000), 'highestInterest')
    const mins = simulateMinimumsOnly([card, loan])
    const cmp = compareWithMinimums(plan, mins)
    expect(cmp.monthsSaved).toBeGreaterThan(0)
    expect(cmp.interestSaved).toBeGreaterThan(0)
  })

  it('does not roll a cleared minimum into other debts', () => {
    const mins = simulateMinimumsOnly([small, loan])
    const afterSmall = mins.schedule[mins.perDebt.small.payoffMonth! + 1]
    expect(afterSmall.payments.loan).toBe(pesos(1_000))
  })

  it('sums minimums of debts that still have a balance', () => {
    expect(sumMinimums([card, loan, { ...small, balance: 0 }])).toBe(pesos(3_500))
  })
})

describe('requiredMonthlyAmount (goal mode)', () => {
  it('finds the smallest ₱100 step that meets the date', () => {
    const amount = requiredMonthlyAmount([card, loan], 12, 'highestInterest')!
    expect(amount % pesos(100)).toBe(0)
    expect(simulateDebts([card, loan], amount, 'highestInterest').months).toBeLessThanOrEqual(12)
    expect(simulateDebts([card, loan], amount - pesos(100), 'highestInterest').months).toBeGreaterThan(12)
  })

  it('is never below the sum of minimums', () => {
    expect(requiredMonthlyAmount([card, loan], 300, 'highestInterest')).toBeGreaterThanOrEqual(pesos(3_500))
  })

  it('one month means paying everything now', () => {
    expect(requiredMonthlyAmount([small], 1, 'highestInterest')).toBe(pesos(5_000))
  })

  it('a goal in the past is impossible', () => {
    expect(requiredMonthlyAmount([small], 0, 'highestInterest')).toBeNull()
  })
})

describe('month helpers', () => {
  it('counts and adds months across years', () => {
    expect(monthsBetween('2026-11', '2027-02')).toBe(3)
    expect(addMonths('2026-11', 2)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })
})
