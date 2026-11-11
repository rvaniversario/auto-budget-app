import type { BudgetPeriod } from './dates'
import { categoryTotals, expensesInPeriod } from './ledger'
import { alive, type Centavos, type SpendingEstimate, type Transaction } from './types'

export interface Baseline {
  amount: Centavos
  /** True when the amount came from the onboarding estimate, not real history. */
  isEstimate: boolean
}

export interface BaselineContext {
  transactions: readonly Transaction[]
  estimates: readonly SpendingEstimate[]
  /** The budget month before the current one. */
  previousPeriod: Pick<BudgetPeriod, 'start' | 'end'>
}

/** Whether the previous budget month has any recorded expenses at all. */
export function hasHistory(ctx: BaselineContext): boolean {
  return expensesInPeriod(ctx.transactions, ctx.previousPeriod).length > 0
}

function estimateFor(categoryId: string, estimates: readonly SpendingEstimate[]): Centavos {
  return alive(estimates).find((e) => e.categoryId === categoryId)?.amount ?? 0
}

/**
 * Spending baseline for a category: its total during the previous budget month,
 * excluding one-time expenses. Falls back to the onboarding estimate when the
 * previous month has no data.
 */
export function getCategoryBaseline(categoryId: string, ctx: BaselineContext): Baseline {
  if (!hasHistory(ctx)) {
    return { amount: estimateFor(categoryId, ctx.estimates), isEstimate: true }
  }
  return { amount: categoryTotals(ctx.transactions, ctx.previousPeriod).get(categoryId) ?? 0, isEstimate: false }
}

/** Baselines for many categories at once (same rules as getCategoryBaseline). */
export function getCategoryBaselines(categoryIds: readonly string[], ctx: BaselineContext): Map<string, Baseline> {
  const result = new Map<string, Baseline>()
  if (!hasHistory(ctx)) {
    for (const id of categoryIds) result.set(id, { amount: estimateFor(id, ctx.estimates), isEstimate: true })
    return result
  }
  const totals = categoryTotals(ctx.transactions, ctx.previousPeriod)
  for (const id of categoryIds) result.set(id, { amount: totals.get(id) ?? 0, isEstimate: false })
  return result
}
