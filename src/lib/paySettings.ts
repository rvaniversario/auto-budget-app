import { alive, remapPeriodStart, type AppSnapshot, type Settings } from '@/core'
import { repo } from '@/data'

/**
 * Save pay schedule changes. When a budget month's start date moves (a new payday
 * day or a moved payday), the month's plan edits move with it instead of being lost.
 * A new regular payday day clears moved paydays, since they were set against the old one.
 */
export async function savePaySettings(snapshot: AppSnapshot, changes: Partial<Settings>): Promise<void> {
  const before = snapshot.settings
  const next: Partial<Settings> =
    changes.paydayDay !== undefined && changes.paydayDay !== before.paydayDay ? { ...changes, paydayOverrides: {} } : changes
  const after = { ...before, ...next }

  const starts = new Set(alive(snapshot.overrides).map((o) => o.periodStart))
  const moves = [...starts].map((from) => ({ from, to: remapPeriodStart(from, before, after) })).filter((m) => m.from !== m.to)

  await repo.saveSettings(next)
  if (moves.length) await repo.moveBudgetOverrides(moves)
}
