import { describe, expect, it } from 'vitest'
import { formatPeriodDash, getBudgetPeriod, periodMonthName } from '../dates'
import { billPaymentsTotal } from '../ledger'
import { pesos } from '../money'
import { account, category, tx } from './fixtures'

describe('periodMonthName', () => {
  it('names the month most of the period falls in', () => {
    expect(periodMonthName(getBudgetPeriod('2026-11-11', 30))).toBe('November')
    expect(periodMonthName(getBudgetPeriod('2026-11-11', 1))).toBe('November')
    expect(periodMonthName(getBudgetPeriod('2026-02-28', 31))).toBe('March')
  })
  it('formatPeriodDash', () => {
    expect(formatPeriodDash(getBudgetPeriod('2026-11-11', 30))).toBe('Oct 30 – Nov 29')
  })
})

describe('billPaymentsTotal', () => {
  it('counts uncategorised expenses only', () => {
    const bank = account()
    const g = category()
    const period = { start: '2026-10-30', end: '2026-11-29' }
    const txs = [
      tx({ accountId: bank.id, amount: pesos(8_000), fixedBillId: 'rent', date: '2026-10-30' }),
      tx({ accountId: bank.id, amount: pesos(500), date: '2026-11-02' }),
      tx({ accountId: bank.id, amount: pesos(300), categoryId: g.id, date: '2026-11-02' }),
      tx({ accountId: bank.id, amount: pesos(9_999), isOneTime: true, date: '2026-11-02' }),
      tx({ accountId: bank.id, type: 'transfer', toAccountId: 'card', amount: pesos(1_000), date: '2026-11-02' }),
    ]
    expect(billPaymentsTotal(txs, period)).toBe(pesos(8_500))
  })
})
