import type { Category, CategoryKind } from '@/core'
import { newId, nowISO } from './ids'

const DEFAULTS: { name: string; kind: CategoryKind }[] = [
  { name: 'Groceries', kind: 'essential' },
  { name: 'Food', kind: 'essential' },
  { name: 'Transport', kind: 'essential' },
  { name: 'Load and data', kind: 'essential' },
  { name: 'Dining out', kind: 'optional' },
  { name: 'Shopping', kind: 'optional' },
]

export function defaultCategories(): Category[] {
  const now = nowISO()
  return DEFAULTS.map((c, i) => ({
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    name: c.name,
    kind: c.kind,
    sortOrder: i,
    archived: false,
  }))
}
