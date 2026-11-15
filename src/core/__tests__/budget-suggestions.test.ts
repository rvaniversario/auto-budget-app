import { describe, expect, it } from 'vitest'
import { buildBudgetPlan, buildCategoryBudgets, defaultBudget, getCategoryStatus, percentUsed } from '../budget'
import { pesos } from '../money'
import { computeSafePayment } from '../safePayment'
import { distributeCut, possibleDonors, suggestOverspendFix, suggestShortfallFixes, type CategoryUsage } from '../suggestions'
import { bill, category } from './fixtures'

describe('category budgets', () => {
  it('rounds the baseline up to the nearest ₱100', () => {
    expect(defaultBudget({ amount: pesos(4_201.5), isEstimate: false })).toBe(pesos(4_300))
    expect(defaultBudget({ amount: pesos(4_200), isEstimate: false })).toBe(pesos(4_200))
    expect(defaultBudget({ amount: 0, isEstimate: true })).toBe(0)
  })

  it('applies overrides, hides archived and deleted, keeps sort order', () => {
    const a = category({ name: 'B', sortOrder: 2 })
    const b = category({ name: 'A', sortOrder: 1, kind: 'optional' })
    const archived = category({ name: 'Old', archived: true })
    const deleted = category({ name: 'Gone', deletedAt: '2026-01-02T00:00:00Z' })
    const baselines = new Map([
      [a.id, { amount: pesos(1_050), isEstimate: false }],
      [b.id, { amount: pesos(900), isEstimate: false }],
    ])
    const budgets = buildCategoryBudgets([a, b, archived, deleted], baselines, new Map([[b.id, pesos(500)]]))
    expect(budgets.map((x) => x.name)).toEqual(['A', 'B'])
    expect(budgets[0]).toMatchObject({ budget: pesos(500), isOverride: true })
    expect(budgets[1]).toMatchObject({ budget: pesos(1_100), isOverride: false })
  })
})

describe('getCategoryStatus', () => {
  it('ok below 80%, near from 80% to 100%, over above 100%', () => {
    expect(getCategoryStatus(pesos(799), pesos(1_000))).toBe('ok')
    expect(getCategoryStatus(pesos(800), pesos(1_000))).toBe('near')
    expect(getCategoryStatus(pesos(1_000), pesos(1_000))).toBe('near')
    expect(getCategoryStatus(pesos(1_000) + 1, pesos(1_000))).toBe('over')
  })

  it('zero budget', () => {
    expect(getCategoryStatus(0, 0)).toBe('ok')
    expect(getCategoryStatus(1, 0)).toBe('ok') // no budget set: never over
  })

  it('percentUsed caps at 100', () => {
    expect(percentUsed(pesos(500), pesos(1_000))).toBe(50)
    expect(percentUsed(pesos(5_000), pesos(1_000))).toBe(100)
    expect(percentUsed(0, 0)).toBe(0)
  })
})

describe('buildBudgetPlan', () => {
  const groceries = category({ name: 'Groceries' })
  const dining = category({ name: 'Dining out', kind: 'optional' })
  const baselines = new Map([
    [groceries.id, { amount: pesos(5_950), isEstimate: false }],
    [dining.id, { amount: pesos(1_820), isEstimate: false }],
  ])
  const budgets = buildCategoryBudgets([groceries, dining], baselines, new Map())
  const rent = bill({ amount: pesos(12_000) })

  it('totals the salary exactly when the card absorbs the rest', () => {
    const safe = computeSafePayment({
      salary: pesos(60_000),
      fixedBillsTotal: pesos(12_000),
      essentialTotal: pesos(6_000),
      optionalTotal: pesos(1_900),
      oneTimeTotal: 0,
      buffer: pesos(3_000),
      cardBalance: pesos(50_000),
      minimumDue: pesos(2_500),
      isEstimate: false,
    })
    const plan = buildBudgetPlan({ salary: pesos(60_000), fixedBills: [rent], categoryBudgets: budgets, safe, buffer: pesos(3_000), oneTimeTotal: 0, hasCard: true })
    expect(plan.essential[0]).toMatchObject({ amount: pesos(6_000), lastMonth: pesos(5_950), editable: true })
    expect(plan.optional[0]).toMatchObject({ amount: pesos(1_900), lastMonth: pesos(1_820) })
    expect(plan.setAsideFirst.map((l) => l.kind)).toEqual(['fixed_bill', 'card_payment', 'buffer'])
    expect(plan.allocated).toBe(pesos(60_000))
    expect(plan.unassigned).toBe(0)
  })

  it('shows money left over as unassigned when the card is paid in full', () => {
    const safe = computeSafePayment({
      salary: pesos(60_000),
      fixedBillsTotal: pesos(12_000),
      essentialTotal: pesos(6_000),
      optionalTotal: pesos(1_900),
      oneTimeTotal: pesos(1_000),
      buffer: pesos(3_000),
      cardBalance: pesos(10_000),
      minimumDue: pesos(500),
      isEstimate: false,
    })
    const plan = buildBudgetPlan({ salary: pesos(60_000), fixedBills: [rent], categoryBudgets: budgets, safe, buffer: pesos(3_000), oneTimeTotal: pesos(1_000), hasCard: true })
    expect(plan.setAsideFirst.some((l) => l.kind === 'one_time')).toBe(true)
    expect(plan.unassigned).toBe(pesos(60_000 - 12_000 - 10_000 - 3_000 - 1_000 - 6_000 - 1_900))
  })

  it('negative unassigned when salary cannot cover the plan', () => {
    const safe = computeSafePayment({
      salary: pesos(10_000),
      fixedBillsTotal: pesos(12_000),
      essentialTotal: pesos(6_000),
      optionalTotal: pesos(1_900),
      oneTimeTotal: 0,
      buffer: pesos(3_000),
      cardBalance: pesos(50_000),
      minimumDue: pesos(2_500),
      isEstimate: false,
    })
    const plan = buildBudgetPlan({ salary: pesos(10_000), fixedBills: [rent], categoryBudgets: budgets, safe, buffer: pesos(3_000), oneTimeTotal: 0, hasCard: true })
    expect(plan.unassigned).toBeLessThan(0)
  })

  it('omits the card line when there is no card', () => {
    const safe = computeSafePayment({
      salary: pesos(60_000), fixedBillsTotal: 0, essentialTotal: 0, optionalTotal: 0, oneTimeTotal: 0,
      buffer: pesos(3_000), cardBalance: 0, minimumDue: 0, isEstimate: false,
    })
    const plan = buildBudgetPlan({ salary: pesos(60_000), fixedBills: [], categoryBudgets: [], safe, buffer: pesos(3_000), oneTimeTotal: 0, hasCard: false })
    expect(plan.setAsideFirst.map((l) => l.kind)).toEqual(['buffer'])
    expect(plan.unassigned).toBe(pesos(57_000))
  })
})

describe('suggestOverspendFix', () => {
  const rows: CategoryUsage[] = [
    { categoryId: 'food', name: 'Food', kind: 'essential', budget: pesos(3_000), spent: pesos(3_350) },
    { categoryId: 'shop', name: 'Shopping', kind: 'optional', budget: pesos(2_000), spent: pesos(500) },
    { categoryId: 'dine', name: 'Dining out', kind: 'optional', budget: pesos(2_000), spent: pesos(1_800) },
    { categoryId: 'grocery', name: 'Groceries', kind: 'essential', budget: pesos(8_000), spent: 0 },
  ]

  it('moves from the optional category with the most remaining', () => {
    expect(suggestOverspendFix('food', pesos(350), rows, pesos(3_000))).toEqual({
      type: 'move',
      fromCategoryId: 'shop',
      fromName: 'Shopping',
      amount: pesos(350),
    })
  })

  it('falls back to the buffer when no optional category has enough', () => {
    expect(suggestOverspendFix('food', pesos(1_600), rows, pesos(3_000))).toEqual({ type: 'buffer', amount: pesos(1_600), bufferIsEnough: true })
    expect(suggestOverspendFix('food', pesos(1_600), rows, pesos(1_000))).toMatchObject({ type: 'buffer', bufferIsEnough: false })
  })

  it('never suggests moving from the overspent category itself', () => {
    const r = suggestOverspendFix('shop', pesos(100), rows, 0)
    expect(r.type === 'move' && r.fromCategoryId).toBe('dine')
  })

  it('possibleDonors lists categories with money left, optional first', () => {
    expect(possibleDonors('food', rows).map((r) => r.categoryId)).toEqual(['shop', 'dine', 'grocery'])
  })
})

describe('suggestShortfallFixes', () => {
  it('returns buffer, optional and split options', () => {
    const r = suggestShortfallFixes(pesos(1_500), pesos(3_000), pesos(4_000))
    expect(r.map((o) => o.id)).toEqual(['buffer', 'optional', 'split'])
    expect(r[0]).toMatchObject({ bufferCut: pesos(1_500), optionalCut: 0, remaining: 0 })
    expect(r[1]).toMatchObject({ bufferCut: 0, optionalCut: pesos(1_500), remaining: 0 })
    expect(r[2]).toMatchObject({ bufferCut: pesos(750), optionalCut: pesos(750), remaining: 0 })
    expect(r[0].effect).toContain('Leaves ₱1,500')
  })

  it('splits odd centavos without losing any', () => {
    const r = suggestShortfallFixes(101, pesos(10), pesos(10))
    const split = r.find((o) => o.id === 'split')
    expect(split && split.bufferCut + split.optionalCut).toBe(101)
  })

  it('reports what is still short when an option cannot close the gap', () => {
    const r = suggestShortfallFixes(pesos(5_000), pesos(1_000), 0)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ id: 'buffer', covers: pesos(1_000), remaining: pesos(4_000) })
    expect(r[0].effect).toContain('still short')
  })

  it('no shortfall, no suggestions', () => {
    expect(suggestShortfallFixes(0, pesos(3_000), pesos(3_000))).toEqual([])
  })
})

describe('distributeCut', () => {
  it('spreads proportionally in whole centavos', () => {
    const r = distributeCut([{ key: 'a', room: 300 }, { key: 'b', room: 100 }], 101)
    expect((r.get('a') ?? 0) + (r.get('b') ?? 0)).toBe(101)
    expect(r.get('a')).toBe(76)
  })

  it('never takes more than available', () => {
    const r = distributeCut([{ key: 'a', room: 50 }, { key: 'b', room: 0 }], 500)
    expect(r.get('a')).toBe(50)
    expect(r.get('b')).toBe(0)
  })
})
