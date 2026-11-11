import { describe, expect, it } from 'vitest'
import { getCategoryBaseline, getCategoryBaselines, hasHistory } from '../baseline'
import { cardPaymentsInPeriod, categoryTotals, getAccountBalance, oneTimeTotal, totalSpent } from '../ledger'
import { pesos } from '../money'
import { account, card, category, estimate, tx } from './fixtures'

const period = { start: '2026-10-30', end: '2026-11-29' }
const prev = { start: '2026-09-30', end: '2026-10-29' }

describe('getAccountBalance', () => {
  const bank = account({ openingBalance: pesos(20_000) })
  const visa = card({ openingBalance: pesos(50_000) })

  it('cash/bank: opening + income − expenses ± transfers', () => {
    const txs = [
      tx({ accountId: bank.id, type: 'income', amount: pesos(60_000) }),
      tx({ accountId: bank.id, type: 'expense', amount: pesos(1_000) }),
      tx({ accountId: bank.id, type: 'transfer', toAccountId: visa.id, amount: pesos(15_000) }),
    ]
    expect(getAccountBalance(bank, txs)).toBe(pesos(64_000))
  })

  it('credit card: opening + card expenses − transfers into the card', () => {
    const txs = [
      tx({ accountId: visa.id, type: 'expense', amount: pesos(2_000) }),
      tx({ accountId: bank.id, type: 'transfer', toAccountId: visa.id, amount: pesos(15_000) }),
    ]
    expect(getAccountBalance(visa, txs)).toBe(pesos(37_000))
  })

  it('ignores soft-deleted transactions', () => {
    const txs = [tx({ accountId: visa.id, amount: pesos(2_000), deletedAt: '2026-11-02T00:00:00Z' })]
    expect(getAccountBalance(visa, txs)).toBe(pesos(50_000))
  })
})

describe('category totals', () => {
  const groceries = category({ name: 'Groceries' })
  const bank = account()
  const visa = card()

  it('a card payment transfer does not affect any category total', () => {
    const txs = [
      tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(500), date: '2026-11-01' }),
      tx({ accountId: bank.id, type: 'transfer', toAccountId: visa.id, amount: pesos(15_000), date: '2026-11-01' }),
    ]
    const totals = categoryTotals(txs, period)
    expect([...totals.values()].reduce((a, b) => a + b, 0)).toBe(pesos(500))
    expect(totals.get(groceries.id)).toBe(pesos(500))
    expect(totalSpent(txs, period)).toBe(pesos(500))
  })

  it('card purchases count as spending in their category', () => {
    const txs = [tx({ accountId: visa.id, categoryId: groceries.id, amount: pesos(800), date: '2026-11-03' })]
    expect(categoryTotals(txs, period).get(groceries.id)).toBe(pesos(800))
  })

  it('excludes one-time and out-of-period expenses but tracks one-time separately', () => {
    const txs = [
      tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(500), date: '2026-11-01' }),
      tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(9_000), date: '2026-11-02', isOneTime: true }),
      tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(700), date: '2026-10-29' }),
    ]
    expect(categoryTotals(txs, period).get(groceries.id)).toBe(pesos(500))
    expect(oneTimeTotal(txs, period)).toBe(pesos(9_000))
    expect(totalSpent(txs, period)).toBe(pesos(9_500))
  })

  it('soft-deleted transactions are ignored', () => {
    const txs = [
      tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(500), date: '2026-11-01', deletedAt: '2026-11-02T00:00:00Z' }),
      tx({ accountId: bank.id, type: 'transfer', toAccountId: visa.id, amount: pesos(1_000), date: '2026-11-01', deletedAt: '2026-11-02T00:00:00Z' }),
    ]
    expect(categoryTotals(txs, period).size).toBe(0)
    expect(totalSpent(txs, period)).toBe(0)
    expect(cardPaymentsInPeriod(visa.id, txs, period)).toBe(0)
  })

  it('cardPaymentsInPeriod sums transfers into the card', () => {
    const txs = [
      tx({ accountId: bank.id, type: 'transfer', toAccountId: visa.id, amount: pesos(1_000), date: '2026-11-01' }),
      tx({ accountId: bank.id, type: 'transfer', toAccountId: visa.id, amount: pesos(2_000), date: '2026-10-01' }),
    ]
    expect(cardPaymentsInPeriod(visa.id, txs, period)).toBe(pesos(1_000))
  })
})

describe('getCategoryBaseline', () => {
  const groceries = category({ name: 'Groceries' })
  const dining = category({ name: 'Dining out', kind: 'optional' })
  const bank = account()
  const estimates = [estimate(groceries.id, pesos(6_000)), estimate(dining.id, pesos(2_000))]

  it('new user with no transactions falls back to estimates', () => {
    const ctx = { transactions: [], estimates, previousPeriod: prev }
    expect(hasHistory(ctx)).toBe(false)
    expect(getCategoryBaseline(groceries.id, ctx)).toEqual({ amount: pesos(6_000), isEstimate: true })
  })

  it('uses previous-month totals once history exists, excluding one-time expenses', () => {
    const transactions = [
      tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(5_200), date: '2026-10-05' }),
      tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(8_000), date: '2026-10-06', isOneTime: true }),
      tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(999), date: '2026-11-01' }), // current month
    ]
    const ctx = { transactions, estimates, previousPeriod: prev }
    expect(getCategoryBaseline(groceries.id, ctx)).toEqual({ amount: pesos(5_200), isEstimate: false })
    // Category with no spending last month is a real zero, not an estimate.
    expect(getCategoryBaseline(dining.id, ctx)).toEqual({ amount: 0, isEstimate: false })
  })

  it('a card payment alone in the previous month is not "history"', () => {
    const visa = card()
    const transactions = [tx({ accountId: bank.id, type: 'transfer', toAccountId: visa.id, amount: pesos(5_000), date: '2026-10-05' })]
    const ctx = { transactions, estimates, previousPeriod: prev }
    expect(getCategoryBaseline(groceries.id, ctx).isEstimate).toBe(true)
  })

  it('soft-deleted transactions and estimates are ignored', () => {
    const transactions = [
      tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(5_200), date: '2026-10-05', deletedAt: '2026-10-06T00:00:00Z' }),
    ]
    const deletedEstimate = { ...estimate(dining.id, pesos(1)), deletedAt: '2026-10-06T00:00:00Z' }
    const ctx = { transactions, estimates: [deletedEstimate], previousPeriod: prev }
    expect(getCategoryBaseline(groceries.id, ctx)).toEqual({ amount: 0, isEstimate: true })
    expect(getCategoryBaseline(dining.id, ctx)).toEqual({ amount: 0, isEstimate: true })
  })

  it('getCategoryBaselines matches the single version', () => {
    const ctx = { transactions: [], estimates, previousPeriod: prev }
    const map = getCategoryBaselines([groceries.id, dining.id], ctx)
    expect(map.get(dining.id)).toEqual({ amount: pesos(2_000), isEstimate: true })
  })
})
