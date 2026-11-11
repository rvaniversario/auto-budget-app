import { describe, expect, it } from 'vitest'
import { pesos } from '../money'
import { describeMonths, estimateNextMonthInterest, PAYOFF_MONTH_CAP, simulatePayoff } from '../payoff'
import { checkBudgetEdit, computeSafePayment, splitAcrossCards, weightedRate, whatIf, type SafePaymentInput } from '../safePayment'

const base: SafePaymentInput = {
  salary: pesos(60_000),
  fixedBillsTotal: pesos(18_000),
  essentialTotal: pesos(12_000),
  optionalTotal: pesos(6_000),
  oneTimeTotal: 0,
  buffer: pesos(3_000),
  cardBalance: pesos(50_000),
  minimumDue: pesos(2_500),
  isEstimate: false,
}

describe('estimateNextMonthInterest', () => {
  it('is (balance − payment) × rate', () => {
    expect(estimateNextMonthInterest(pesos(50_000), pesos(15_000), 3)).toBe(pesos(1_050))
  })
  it('is zero when paid in full or overpaid', () => {
    expect(estimateNextMonthInterest(pesos(5_000), pesos(5_000), 3)).toBe(0)
    expect(estimateNextMonthInterest(pesos(5_000), pesos(9_000), 3)).toBe(0)
  })
})

describe('simulatePayoff', () => {
  it('pays off with interest added after each payment', () => {
    // 10,000 at 3%, paying 5,000: 5,000 left +150 → 5,150; then 150 left +4.50 → 154.50; then paid.
    const r = simulatePayoff(pesos(10_000), pesos(5_000), 3)
    expect(r).toEqual({ months: 3, totalInterest: pesos(150) + 450, neverPaysOff: false })
  })

  it('one month when the payment covers the balance', () => {
    expect(simulatePayoff(pesos(5_000), pesos(5_000), 3)).toEqual({ months: 1, totalInterest: 0, neverPaysOff: false })
  })

  it('zero balance needs zero months', () => {
    expect(simulatePayoff(0, pesos(1_000), 3)).toEqual({ months: 0, totalInterest: 0, neverPaysOff: false })
  })

  it('payment equal to the monthly interest never pays off', () => {
    // 103,000 at 3%, paying 3,000: 100,000 left → interest exactly 3,000. Balance never moves.
    const r = simulatePayoff(pesos(103_000), pesos(3_000), 3)
    expect(r.neverPaysOff).toBe(true)
  })

  it('payment lower than the interest never pays off', () => {
    const r = simulatePayoff(pesos(50_000), pesos(1_000), 3)
    expect(r.neverPaysOff).toBe(true)
    expect(r.months).toBe(PAYOFF_MONTH_CAP)
  })

  it('zero payment never pays off', () => {
    expect(simulatePayoff(pesos(50_000), 0, 3).neverPaysOff).toBe(true)
  })

  it('caps at 120 months for very slow payoffs', () => {
    // Payment barely beats the interest, so it would take ~147 months.
    const r = simulatePayoff(pesos(100_000), pesos(2_950), 3)
    expect(r.neverPaysOff).toBe(true)
    expect(r.months).toBe(PAYOFF_MONTH_CAP)
    // Slightly more and it finishes inside the cap.
    const ok = simulatePayoff(pesos(100_000), pesos(3_100), 3)
    expect(ok.neverPaysOff).toBe(false)
    expect(ok.months).toBeLessThan(PAYOFF_MONTH_CAP)
  })

  it('zero interest rate divides evenly', () => {
    expect(simulatePayoff(pesos(10_000), pesos(2_500), 0)).toEqual({ months: 4, totalInterest: 0, neverPaysOff: false })
  })

  it('describeMonths', () => {
    expect(describeMonths(0)).toBe('Paid off now')
    expect(describeMonths(1)).toBe('1 month')
    expect(describeMonths(4)).toBe('4 months')
    expect(describeMonths(12)).toBe('1 year')
    expect(describeMonths(14)).toBe('1 year 2 months')
    expect(describeMonths(25)).toBe('2 years 1 month')
  })
})

describe('computeSafePayment', () => {
  it('follows the formula', () => {
    const r = computeSafePayment(base)
    expect(r.unclamped).toBe(pesos(21_000))
    expect(r.amount).toBe(pesos(21_000))
    expect(r.belowMinimum).toBe(false)
    expect(r.shortfall).toBe(0)
    expect(r.paysInFull).toBe(false)
  })

  it('subtracts one-time expenses already logged', () => {
    expect(computeSafePayment({ ...base, oneTimeTotal: pesos(6_000) }).amount).toBe(pesos(15_000))
  })

  it('salary lower than fixed bills: 0 and below minimum', () => {
    const r = computeSafePayment({ ...base, salary: pesos(15_000) })
    expect(r.unclamped).toBeLessThan(0)
    expect(r.amount).toBe(0)
    expect(r.belowMinimum).toBe(true)
    expect(r.shortfall).toBe(pesos(2_500))
  })

  it('card balance smaller than the safe amount: pay in full', () => {
    const r = computeSafePayment({ ...base, cardBalance: pesos(8_000) })
    expect(r.amount).toBe(pesos(8_000))
    expect(r.paysInFull).toBe(true)
    expect(r.belowMinimum).toBe(false)
  })

  it('minimum never exceeds the balance', () => {
    const r = computeSafePayment({ ...base, cardBalance: pesos(1_000), minimumDue: pesos(2_500) })
    expect(r.effectiveMinimum).toBe(pesos(1_000))
    expect(r.belowMinimum).toBe(false)
  })

  it('no card: nothing to pay, never below minimum', () => {
    const r = computeSafePayment({ ...base, cardBalance: 0, minimumDue: 0 })
    expect(r.amount).toBe(0)
    expect(r.belowMinimum).toBe(false)
    expect(r.paysInFull).toBe(false)
  })

  it('reports partial shortfall', () => {
    const r = computeSafePayment({ ...base, salary: pesos(40_000) })
    expect(r.amount).toBe(pesos(1_000))
    expect(r.shortfall).toBe(pesos(1_500))
  })

  it('passes the estimate flag through', () => {
    expect(computeSafePayment({ ...base, isEstimate: true }).isEstimate).toBe(true)
  })
})

describe('splitAcrossCards', () => {
  const a = { id: 'a', balance: pesos(30_000), minimumDue: pesos(1_500), monthlyInterestRate: 2 }
  const b = { id: 'b', balance: pesos(20_000), minimumDue: pesos(1_000), monthlyInterestRate: 3.5 }

  it('covers minimums, then highest interest first', () => {
    const r = splitAcrossCards(pesos(10_000), [a, b])
    expect(r).toEqual([
      { id: 'a', amount: pesos(1_500), belowMinimum: false },
      { id: 'b', amount: pesos(8_500), belowMinimum: false },
    ])
  })

  it('caps each card at its balance and spills over', () => {
    const r = splitAcrossCards(pesos(25_000), [a, b])
    expect(r.find((x) => x.id === 'b')?.amount).toBe(pesos(20_000))
    expect(r.find((x) => x.id === 'a')?.amount).toBe(pesos(5_000))
  })

  it('not enough for all minimums: highest rate minimum first', () => {
    const r = splitAcrossCards(pesos(1_200), [a, b])
    expect(r.find((x) => x.id === 'b')).toEqual({ id: 'b', amount: pesos(1_000), belowMinimum: false })
    expect(r.find((x) => x.id === 'a')).toEqual({ id: 'a', amount: pesos(200), belowMinimum: true })
  })

  it('weightedRate', () => {
    expect(weightedRate([a, b])).toBeCloseTo(2.6)
    expect(weightedRate([])).toBe(0)
  })
})

describe('whatIf', () => {
  it('cutting optional spending raises the payment and shortens payoff', () => {
    const r = whatIf(base, pesos(2_000), 3)
    expect(r.cut).toBe(pesos(2_000))
    expect(r.current.payment).toBe(pesos(21_000))
    expect(r.scenario.payment).toBe(pesos(23_000))
    expect(r.extraPayment).toBe(pesos(2_000))
    expect(r.monthsSaved).toBeGreaterThanOrEqual(0)
    expect(r.interestSaved).toBeGreaterThan(0)
  })

  it('never cuts more than the optional total', () => {
    expect(whatIf({ ...base, optionalTotal: pesos(500) }, pesos(3_000), 3).cut).toBe(pesos(500))
  })

  it('zero cut changes nothing', () => {
    const r = whatIf(base, 0, 3)
    expect(r.extraPayment).toBe(0)
    expect(r.monthsSaved).toBe(0)
    expect(r.interestSaved).toBe(0)
  })

  it('returns null savings when the current plan never pays off', () => {
    const r = whatIf({ ...base, salary: pesos(40_000) }, pesos(500), 3)
    expect(r.current.payoff.neverPaysOff).toBe(true)
    expect(r.monthsSaved).toBeNull()
  })
})

describe('checkBudgetEdit', () => {
  it('moves the difference to/from the card payment', () => {
    const r = checkBudgetEdit(base, 'optional', pesos(3_000), pesos(4_000))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.after.amount).toBe(pesos(20_000))
  })

  it('blocks edits that push the card below its minimum', () => {
    const r = checkBudgetEdit(base, 'essential', pesos(5_000), pesos(30_000))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      // 21,000 safe − 2,500 minimum = 18,500 room → max 23,500
      expect(r.maxAllowed).toBe(pesos(23_500))
      expect(r.message).toContain('₱2,500')
    }
  })

  it('allows lowering a budget even when already below minimum', () => {
    const tight = { ...base, salary: pesos(40_000) }
    expect(checkBudgetEdit(tight, 'optional', pesos(3_000), pesos(1_000)).ok).toBe(true)
    expect(checkBudgetEdit(tight, 'optional', pesos(3_000), pesos(3_100)).ok).toBe(false)
  })
})
