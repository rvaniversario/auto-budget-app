import { clamp, formatMoney } from './money'
import { simulatePayoff, type PayoffResult } from './payoff'
import type { Centavos, CategoryKind } from './types'

export interface SafePaymentInput {
  salary: Centavos
  fixedBillsTotal: Centavos
  essentialTotal: Centavos
  optionalTotal: Centavos
  /** One-time expenses already logged this budget month. */
  oneTimeTotal: Centavos
  buffer: Centavos
  /** Total owed across credit cards (at the start of this budget month). */
  cardBalance: Centavos
  /** Total minimum due across credit cards. */
  minimumDue: Centavos
  /** True when any spending baseline came from onboarding estimates. */
  isEstimate: boolean
}

export interface SafePaymentResult extends SafePaymentInput {
  /** salary − bills − essential − optional − one-time − buffer, before clamping. */
  unclamped: Centavos
  /** The recommendation: clamp(unclamped, 0, cardBalance). */
  amount: Centavos
  /** Minimum due, but never more than the balance itself. */
  effectiveMinimum: Centavos
  belowMinimum: boolean
  /** How far the recommendation is below the minimum (0 when not below). */
  shortfall: Centavos
  /** The recommendation clears the whole card balance. */
  paysInFull: boolean
}

/**
 * How much the user can safely pay on their credit card this month.
 *
 *   safe = salary − fixed bills − essential − optional − one-time − buffer
 *   result = clamp(safe, 0, cardBalance)
 */
export function computeSafePayment(input: SafePaymentInput): SafePaymentResult {
  const unclamped =
    input.salary - input.fixedBillsTotal - input.essentialTotal - input.optionalTotal - input.oneTimeTotal - input.buffer
  const cardBalance = Math.max(0, input.cardBalance)
  const amount = clamp(unclamped, 0, cardBalance)
  const effectiveMinimum = Math.min(Math.max(0, input.minimumDue), cardBalance)
  const belowMinimum = amount < effectiveMinimum
  return {
    ...input,
    cardBalance,
    unclamped,
    amount,
    effectiveMinimum,
    belowMinimum,
    shortfall: belowMinimum ? effectiveMinimum - amount : 0,
    paysInFull: cardBalance > 0 && amount === cardBalance,
  }
}

// ---------------------------------------------------------------------------
// Several credit cards
// ---------------------------------------------------------------------------

export interface CardInput {
  id: string
  balance: Centavos
  minimumDue: Centavos
  monthlyInterestRate: number
}

export interface CardAllocation {
  id: string
  amount: Centavos
  belowMinimum: boolean
}

/**
 * Split the safe amount across cards. Version 1 rule:
 * 1. Cover each card's minimum (highest interest first if there isn't enough for all).
 * 2. Put the rest on the highest-interest card first, up to each balance.
 */
export function splitAcrossCards(total: Centavos, cards: readonly CardInput[]): CardAllocation[] {
  const ordered = [...cards].sort((a, b) => b.monthlyInterestRate - a.monthlyInterestRate || b.balance - a.balance)
  const amounts = new Map<string, Centavos>(ordered.map((c) => [c.id, 0]))
  let left = Math.max(0, total)

  for (const card of ordered) {
    const min = Math.min(Math.max(0, card.minimumDue), Math.max(0, card.balance))
    const give = Math.min(min, left)
    amounts.set(card.id, give)
    left -= give
  }
  for (const card of ordered) {
    if (left <= 0) break
    const room = Math.max(0, card.balance) - (amounts.get(card.id) ?? 0)
    const give = Math.min(room, left)
    amounts.set(card.id, (amounts.get(card.id) ?? 0) + give)
    left -= give
  }

  return cards.map((card) => {
    const amount = amounts.get(card.id) ?? 0
    const min = Math.min(Math.max(0, card.minimumDue), Math.max(0, card.balance))
    return { id: card.id, amount, belowMinimum: amount < min }
  })
}

/** Balance-weighted monthly interest rate across cards (for combined payoff estimates). */
export function weightedRate(cards: readonly CardInput[]): number {
  const total = cards.reduce((acc, c) => acc + Math.max(0, c.balance), 0)
  if (total === 0) return cards[0]?.monthlyInterestRate ?? 0
  return cards.reduce((acc, c) => acc + (Math.max(0, c.balance) / total) * c.monthlyInterestRate, 0)
}

// ---------------------------------------------------------------------------
// What-if
// ---------------------------------------------------------------------------

export interface Scenario {
  payment: Centavos
  payoff: PayoffResult
}

export interface WhatIfResult {
  /** Amount actually cut (never more than the optional total). */
  cut: Centavos
  current: Scenario
  scenario: Scenario
  extraPayment: Centavos
  /** Months sooner the card is paid off. Null when either plan never pays off. */
  monthsSaved: number | null
  /** Interest saved versus the current plan. Null when either plan never pays off. */
  interestSaved: Centavos | null
}

/** Recompute the plan with optional spending reduced by `cutOptionalBy`. */
export function whatIf(input: SafePaymentInput, cutOptionalBy: Centavos, monthlyRatePercent: number): WhatIfResult {
  const cut = clamp(cutOptionalBy, 0, Math.max(0, input.optionalTotal))
  const now = computeSafePayment(input)
  const next = computeSafePayment({ ...input, optionalTotal: input.optionalTotal - cut })

  const current: Scenario = { payment: now.amount, payoff: simulatePayoff(now.cardBalance, now.amount, monthlyRatePercent) }
  const scenario: Scenario = { payment: next.amount, payoff: simulatePayoff(next.cardBalance, next.amount, monthlyRatePercent) }
  const comparable = !current.payoff.neverPaysOff && !scenario.payoff.neverPaysOff

  return {
    cut,
    current,
    scenario,
    extraPayment: scenario.payment - current.payment,
    monthsSaved: comparable ? current.payoff.months - scenario.payoff.months : null,
    interestSaved: comparable ? current.payoff.totalInterest - scenario.payoff.totalInterest : null,
  }
}

// ---------------------------------------------------------------------------
// Editing a category budget moves money to/from the card payment
// ---------------------------------------------------------------------------

export type BudgetEditCheck =
  | { ok: true; before: SafePaymentResult; after: SafePaymentResult }
  | { ok: false; message: string; maxAllowed: Centavos }

/**
 * Check a category budget change. The difference comes out of (or goes back to)
 * the credit card payment, which must not drop below the card minimum.
 */
export function checkBudgetEdit(
  input: SafePaymentInput,
  kind: CategoryKind,
  oldAmount: Centavos,
  newAmount: Centavos,
): BudgetEditCheck {
  const delta = newAmount - oldAmount
  const before = computeSafePayment(input)
  const after = computeSafePayment({
    ...input,
    essentialTotal: input.essentialTotal + (kind === 'essential' ? delta : 0),
    optionalTotal: input.optionalTotal + (kind === 'optional' ? delta : 0),
  })

  if (delta > 0 && after.amount < after.effectiveMinimum) {
    const maxAllowed = Math.max(oldAmount, oldAmount + before.unclamped - before.effectiveMinimum)
    const message =
      maxAllowed > oldAmount
        ? `That would bring your card payment below the minimum due of ${formatMoney(before.effectiveMinimum)}. The most you can set here is ${formatMoney(maxAllowed)}.`
        : `Your card payment is already at or below the minimum due of ${formatMoney(before.effectiveMinimum)}, so this budget can't go up. Lower another budget first.`
    return { ok: false, message, maxAllowed }
  }
  return { ok: true, before, after }
}
