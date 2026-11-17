import type { Category, CategoryKind } from '@/core'
import { newId, nowISO } from './ids'

const EXPENSE_DEFAULTS: { name: string; kind: CategoryKind }[] = [
  { name: 'Groceries', kind: 'essential' },
  { name: 'Food', kind: 'essential' },
  { name: 'Transport', kind: 'essential' },
  { name: 'Load and data', kind: 'essential' },
  { name: 'Dining out', kind: 'optional' },
  { name: 'Shopping', kind: 'optional' },
]

/**
 * Income categories have fixed ids, so devices that add them on upgrade
 * (see db.ts version 4) end up with the same records instead of duplicates
 * once they sync.
 */
export const INCOME_DEFAULTS: { id: string; name: string }[] = [
  { id: 'income-allowance', name: 'Allowance' },
  { id: 'income-salary', name: 'Salary' },
  { id: 'income-petty-cash', name: 'Petty cash' },
  { id: 'income-bonus', name: 'Bonus' },
  { id: 'income-other', name: 'Other income' },
]

/**
 * updatedAt for income categories added by the upgrade: older than any real
 * edit, so a rename or delete synced from another device always wins.
 */
export const INCOME_DEFAULTS_UPDATED_AT = '2026-11-17T00:00:00.000Z'

export function incomeCategory(d: (typeof INCOME_DEFAULTS)[number], sortOrder: number, stamp: string): Category {
  return { id: d.id, createdAt: stamp, updatedAt: stamp, deletedAt: null, name: d.name, kind: 'income', sortOrder, archived: false }
}

export function defaultCategories(): Category[] {
  const now = nowISO()
  const expense = EXPENSE_DEFAULTS.map((c, i) => ({
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name: c.name,
    kind: c.kind,
    sortOrder: i,
    archived: false,
  }))
  return [...expense, ...INCOME_DEFAULTS.map((d, i) => incomeCategory(d, expense.length + i, now))]
}
