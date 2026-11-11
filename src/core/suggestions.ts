import { formatMoney, sum } from './money'
import type { Centavos, CategoryKind } from './types'

export interface CategoryUsage {
  categoryId: string
  name: string
  kind: CategoryKind
  budget: Centavos
  spent: Centavos
}

export function remainingOf(c: CategoryUsage): Centavos {
  return c.budget - c.spent
}

// ---------------------------------------------------------------------------
// Overspending
// ---------------------------------------------------------------------------

export type OverspendFix =
  | { type: 'move'; fromCategoryId: string; fromName: string; amount: Centavos }
  | { type: 'buffer'; amount: Centavos; bufferIsEnough: boolean }

/**
 * A category went over budget. Suggest covering the overage from the optional
 * category with the most budget left; if none has enough, suggest the buffer.
 */
export function suggestOverspendFix(
  overCategoryId: string,
  overage: Centavos,
  categories: readonly CategoryUsage[],
  buffer: Centavos,
): OverspendFix {
  const donors = categories
    .filter((c) => c.kind === 'optional' && c.categoryId !== overCategoryId && remainingOf(c) >= overage)
    .sort((a, b) => remainingOf(b) - remainingOf(a))
  const best = donors[0]
  if (best) return { type: 'move', fromCategoryId: best.categoryId, fromName: best.name, amount: overage }
  return { type: 'buffer', amount: overage, bufferIsEnough: buffer >= overage }
}

/** Categories that could give money to cover an overage (any with budget left). */
export function possibleDonors(overCategoryId: string, categories: readonly CategoryUsage[]): CategoryUsage[] {
  return categories
    .filter((c) => c.categoryId !== overCategoryId && remainingOf(c) > 0)
    .sort((a, b) => (a.kind === b.kind ? remainingOf(b) - remainingOf(a) : a.kind === 'optional' ? -1 : 1))
}

// ---------------------------------------------------------------------------
// Card payment below the minimum due
// ---------------------------------------------------------------------------

export interface ShortfallOption {
  id: 'buffer' | 'optional' | 'split'
  title: string
  bufferCut: Centavos
  optionalCut: Centavos
  /** How much of the shortfall this option closes. */
  covers: Centavos
  /** Shortfall still left afterwards. */
  remaining: Centavos
  effect: string
}

/**
 * Up to three ways to close a shortfall: use part of the buffer, cut optional
 * spending, or split evenly between both.
 */
export function suggestShortfallFixes(shortfall: Centavos, buffer: Centavos, optionalAvailable: Centavos): ShortfallOption[] {
  if (shortfall <= 0) return []
  const options: ShortfallOption[] = []
  const describe = (covers: Centavos, extra: string): string => {
    const remaining = shortfall - covers
    return remaining <= 0
      ? `Reaches the minimum due. ${extra}`
      : `Covers ${formatMoney(covers)} of the ${formatMoney(shortfall)} gap. ${formatMoney(remaining)} still short.`
  }

  if (buffer > 0) {
    const cut = Math.min(shortfall, buffer)
    options.push({
      id: 'buffer',
      title: `Use ${formatMoney(cut)} of your buffer`,
      bufferCut: cut,
      optionalCut: 0,
      covers: cut,
      remaining: shortfall - cut,
      effect: describe(cut, `Leaves ${formatMoney(buffer - cut)} as your safety buffer.`),
    })
  }

  if (optionalAvailable > 0) {
    const cut = Math.min(shortfall, optionalAvailable)
    options.push({
      id: 'optional',
      title: `Spend ${formatMoney(cut)} less on optional things`,
      bufferCut: 0,
      optionalCut: cut,
      covers: cut,
      remaining: shortfall - cut,
      effect: describe(cut, 'Your buffer stays untouched.'),
    })
  }

  if (buffer > 0 && optionalAvailable > 0) {
    const half = Math.ceil(shortfall / 2)
    const bufferCut = Math.min(half, buffer)
    const optionalCut = Math.min(shortfall - half, optionalAvailable)
    const covers = bufferCut + optionalCut
    options.push({
      id: 'split',
      title: `Split it: ${formatMoney(bufferCut)} from buffer, ${formatMoney(optionalCut)} from optional`,
      bufferCut,
      optionalCut,
      covers,
      remaining: shortfall - covers,
      effect: describe(covers, `Leaves ${formatMoney(buffer - bufferCut)} as your buffer.`),
    })
  }

  return options
}

/**
 * Spread a cut across several budgets in proportion to each one's room,
 * using whole centavos (largest-remainder), never taking more than an item has.
 */
export function distributeCut(items: readonly { key: string; room: Centavos }[], cut: Centavos): Map<string, Centavos> {
  const result = new Map<string, Centavos>(items.map((i) => [i.key, 0]))
  const usable = items.filter((i) => i.room > 0)
  const totalRoom = sum(usable.map((i) => i.room))
  const target = Math.min(Math.max(0, cut), totalRoom)
  if (target === 0) return result

  const shares = usable.map((i) => {
    const exact = (target * i.room) / totalRoom
    return { key: i.key, room: i.room, base: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  let leftover = target - sum(shares.map((s) => s.base))
  shares.sort((a, b) => b.frac - a.frac)
  for (const s of shares) {
    if (leftover <= 0) break
    if (s.base < s.room) {
      s.base += 1
      leftover -= 1
    }
  }
  for (const s of shares) result.set(s.key, s.base)
  return result
}
