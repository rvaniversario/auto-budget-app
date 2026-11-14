import { useMemo } from 'react'
import {
  alive,
  compareWithMinimums,
  getAccountBalance,
  isDebtAccount,
  monthsBetween,
  simulateDebts,
  simulateMinimumsOnly,
  sumMinimums,
  type AppSnapshot,
  type Centavos,
  type Debt,
  type DebtPlan,
  type MonthModel,
  type PlannerExtra,
} from '@/core'
import { DEFAULT_DEBT_PLAN } from '@/data'

/** Every credit card and loan with something owed, as the planner sees it. */
export function debtsFromSnapshot(snapshot: AppSnapshot): Debt[] {
  const transactions = alive(snapshot.transactions)
  return alive(snapshot.accounts)
    .filter((a) => isDebtAccount(a.type))
    .map((a) => ({
      id: a.id,
      name: a.name,
      balance: Math.max(0, getAccountBalance(a, transactions)),
      monthlyRate: a.monthlyInterestRate ?? 0,
      minimumPayment: Math.max(0, a.minimumDue ?? 0),
    }))
    .filter((d) => d.balance > 0)
}

/** YYYY-MM of a YYYY-MM-DD date. */
export const yearMonth = (date: string) => date.slice(0, 7)

/** "Dec 2026" */
export function formatYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })
}

/**
 * The saved plan applied to today's debts. The first simulated month is the
 * current calendar month.
 */
export function useDebtPlan(snapshot: AppSnapshot, model: MonthModel) {
  return useMemo(() => {
    const plan: DebtPlan | (typeof DEFAULT_DEBT_PLAN & { id?: undefined }) = snapshot.debtPlan ?? DEFAULT_DEBT_PLAN
    const debts = debtsFromSnapshot(snapshot)
    const startMonth = yearMonth(model.today)
    const minimums = sumMinimums(debts)
    const safeAmount = model.safe.amount
    const chosen: Centavos = plan.monthlyAmount ?? safeAmount
    // Never below the minimums: the planner always pays each debt's minimum.
    const monthlyAmount = Math.max(chosen, minimums)
    const extras: PlannerExtra[] = plan.extras
      .map((e) => ({ monthIndex: monthsBetween(startMonth, e.month), amount: e.amount }))
      .filter((e) => e.monthIndex >= 0 && e.amount > 0)
    const result = simulateDebts(debts, monthlyAmount, plan.strategy, extras, { customOrder: plan.customOrder })
    const minimumsOnly = simulateMinimumsOnly(debts)
    return {
      plan,
      debts,
      startMonth,
      minimums,
      safeAmount,
      monthlyAmount,
      usingSafeAmount: plan.monthlyAmount === null,
      safeBelowMinimums: safeAmount < minimums,
      chosenBelowMinimums: chosen < minimums,
      extras,
      result,
      minimumsOnly,
      comparison: compareWithMinimums(result, minimumsOnly),
    }
  }, [snapshot, model])
}
