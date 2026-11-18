import type { BudgetPeriod } from './dates'
import { categoryTotals, expensesInPeriod } from './ledger'
import type { Centavos, Transaction } from './types'

export interface Baseline {
  amount: Centavos
  /**
   * True when the previous budget month has no logged expenses yet, so the
   * amount is a placeholder ₱0 rather than real history.
   */
  isEstimate: boolean
}

export interface BaselineContext {
  transactions: readonly Transaction[]
  /** The budget month before the current one. */
  previousPeriod: Pick<BudgetPeriod, 'start' | 'end'>
}

/** Whether the previous budget month has any recorded expenses at all. */
export function hasHistory(ctx: BaselineContext): boolean {
  return expensesInPeriod(ctx.transactions, ctx.previousPeriod).length > 0
}

/**
 * Spending baseline for a category: its total during the previous budget month,
 * excluding one-time expenses. Only logged transactions count; with no history
 * yet the baseline is ₱0.
 */
export function getCategoryBaseline(categoryId: string, ctx: BaselineContext): Baseline {
  return getCategoryBaselines([categoryId], ctx).get(categoryId) as Baseline
}

/** Baselines for many categories at once (same rules as getCategoryBaseline). */
export function getCategoryBaselines(categoryIds: readonly string[], ctx: BaselineContext): Map<string, Baseline> {
  const isEstimate = !hasHistory(ctx)
  const totals = categoryTotals(ctx.transactions, ctx.previousPeriod)
  const result = new Map<string, Baseline>()
  for (const id of categoryIds) result.set(id, { amount: totals.get(id) ?? 0, isEstimate })
  return result
}
