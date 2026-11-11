import type { Baseline } from './baseline'
import { roundUpTo, sum } from './money'
import type { SafePaymentResult } from './safePayment'
import type { Category, CategoryKind, Centavos, FixedBill } from './types'

/** Category budgets are rounded up to the nearest ₱100. */
export const BUDGET_ROUNDING: Centavos = 100_00

export interface CategoryBudget {
  categoryId: string
  name: string
  kind: CategoryKind
  baseline: Baseline
  /** This month's budget: the user's override, or the baseline rounded up to ₱100. */
  budget: Centavos
  isOverride: boolean
}

/** Default budget for a category from its baseline. */
export function defaultBudget(baseline: Baseline): Centavos {
  return roundUpTo(Math.max(0, baseline.amount), BUDGET_ROUNDING)
}

export function buildCategoryBudgets(
  categories: readonly Category[],
  baselines: ReadonlyMap<string, Baseline>,
  overrides: ReadonlyMap<string, Centavos>,
): CategoryBudget[] {
  return [...categories]
    .filter((c) => !c.deletedAt && !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => {
      const baseline = baselines.get(c.id) ?? { amount: 0, isEstimate: true }
      const override = overrides.get(c.id)
      return {
        categoryId: c.id,
        name: c.name,
        kind: c.kind,
        baseline,
        budget: override ?? defaultBudget(baseline),
        isOverride: override !== undefined,
      }
    })
}

export function totalByKind(budgets: readonly CategoryBudget[], kind: CategoryKind): Centavos {
  return sum(budgets.filter((b) => b.kind === kind).map((b) => b.budget))
}

// ---------------------------------------------------------------------------
// Status per category
// ---------------------------------------------------------------------------

export type CategoryStatus = 'ok' | 'near' | 'over'

/** ok below 80% used, near from 80% to 100%, over above 100%. */
export function getCategoryStatus(spent: Centavos, budget: Centavos): CategoryStatus {
  if (budget <= 0) return spent > 0 ? 'over' : 'ok'
  // Compare with integers: spent/budget < 0.8  ⇔  spent*10 < budget*8
  if (spent * 10 < budget * 8) return 'ok'
  if (spent <= budget) return 'near'
  return 'over'
}

/** Percent used, capped at 100 for progress bars. */
export function percentUsed(spent: Centavos, budget: Centavos): number {
  if (budget <= 0) return spent > 0 ? 100 : 0
  return Math.min(100, Math.round((spent / budget) * 100))
}

// ---------------------------------------------------------------------------
// The whole month's plan
// ---------------------------------------------------------------------------

export type PlanLineKind = 'fixed_bill' | 'card_payment' | 'buffer' | 'one_time' | 'essential' | 'optional'

export interface PlanLine {
  key: string
  label: string
  kind: PlanLineKind
  amount: Centavos
  /** Last month's actual (or the estimate), shown beside category rows. */
  lastMonth: Centavos | null
  lastMonthIsEstimate: boolean
  editable: boolean
  isOverride: boolean
}

export interface BudgetPlan {
  salary: Centavos
  setAsideFirst: PlanLine[]
  essential: PlanLine[]
  optional: PlanLine[]
  allocated: Centavos
  /** salary − allocated. Positive: money not yet given a job. Negative: plan exceeds salary. */
  unassigned: Centavos
}

export interface BudgetPlanInput {
  salary: Centavos
  fixedBills: readonly FixedBill[]
  categoryBudgets: readonly CategoryBudget[]
  safe: SafePaymentResult
  buffer: Centavos
  oneTimeTotal: Centavos
  hasCard: boolean
}

/** Lay out every peso of salary. Any leftover (or overrun) is reported as unassigned. */
export function buildBudgetPlan(input: BudgetPlanInput): BudgetPlan {
  const line = (partial: Partial<PlanLine> & Pick<PlanLine, 'key' | 'label' | 'kind' | 'amount'>): PlanLine => ({
    lastMonth: null,
    lastMonthIsEstimate: false,
    editable: false,
    isOverride: false,
    ...partial,
  })

  const setAsideFirst: PlanLine[] = [
    ...input.fixedBills
      .filter((b) => !b.deletedAt)
      .map((b) => line({ key: `bill:${b.id}`, label: b.name, kind: 'fixed_bill', amount: b.amount })),
  ]
  if (input.hasCard) {
    setAsideFirst.push(line({ key: 'card', label: 'Credit card payment', kind: 'card_payment', amount: input.safe.amount }))
  }
  setAsideFirst.push(line({ key: 'buffer', label: 'Buffer', kind: 'buffer', amount: input.buffer }))
  if (input.oneTimeTotal > 0) {
    setAsideFirst.push(line({ key: 'one_time', label: 'One-time expenses', kind: 'one_time', amount: input.oneTimeTotal }))
  }

  const toLine = (b: CategoryBudget): PlanLine =>
    line({
      key: b.categoryId,
      label: b.name,
      kind: b.kind,
      amount: b.budget,
      lastMonth: b.baseline.amount,
      lastMonthIsEstimate: b.baseline.isEstimate,
      editable: true,
      isOverride: b.isOverride,
    })

  const essential = input.categoryBudgets.filter((b) => b.kind === 'essential').map(toLine)
  const optional = input.categoryBudgets.filter((b) => b.kind === 'optional').map(toLine)
  const allocated = sum([...setAsideFirst, ...essential, ...optional].map((l) => l.amount))

  return { salary: input.salary, setAsideFirst, essential, optional, allocated, unassigned: input.salary - allocated }
}
