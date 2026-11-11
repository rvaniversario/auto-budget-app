import { z } from 'zod'
import { isValidISODate } from '@/core'

export const BACKUP_APP_ID = 'auto-budget'
export const BACKUP_SCHEMA_VERSION = 1

const centavos = z.number().int().safe()
const nonNegCentavos = centavos.nonnegative()
const dayOfMonth = z.number().int().min(1).max(31)
const isoDate = z.string().refine(isValidISODate, 'Invalid date')

const sync = {
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
}

export const settingsSchema = z.object({
  ...sync,
  monthlySalary: nonNegCentavos,
  payFrequency: z.enum(['monthly', 'semimonthly']),
  paydayDay: dayOfMonth,
  bufferAmount: nonNegCentavos,
  theme: z.enum(['light', 'dark', 'system']),
  onboardingComplete: z.boolean(),
})

export const accountSchema = z.object({
  ...sync,
  name: z.string(),
  type: z.enum(['cash', 'bank', 'credit_card']),
  openingBalance: centavos,
  statementDay: dayOfMonth.nullable(),
  dueDay: dayOfMonth.nullable(),
  minimumDue: nonNegCentavos.nullable(),
  monthlyInterestRate: z.number().min(0).max(100).nullable(),
})

export const categorySchema = z.object({
  ...sync,
  name: z.string(),
  kind: z.enum(['essential', 'optional']),
  sortOrder: z.number(),
  archived: z.boolean(),
})

export const fixedBillSchema = z.object({
  ...sync,
  name: z.string(),
  amount: nonNegCentavos,
  dueDay: dayOfMonth,
})

export const transactionSchema = z.object({
  ...sync,
  type: z.enum(['expense', 'income', 'transfer']),
  amount: nonNegCentavos,
  date: isoDate,
  categoryId: z.string().nullable(),
  accountId: z.string(),
  toAccountId: z.string().nullable(),
  note: z.string(),
  fixedBillId: z.string().nullable(),
  isOneTime: z.boolean(),
})

export const spendingEstimateSchema = z.object({
  ...sync,
  categoryId: z.string(),
  amount: nonNegCentavos,
})

export const budgetOverrideSchema = z.object({
  ...sync,
  periodStart: isoDate,
  key: z.string(),
  amount: nonNegCentavos,
})

export const backupSchema = z.object({
  app: z.literal(BACKUP_APP_ID),
  schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
  exportedAt: z.string(),
  data: z.object({
    settings: z.array(settingsSchema),
    accounts: z.array(accountSchema),
    categories: z.array(categorySchema),
    fixedBills: z.array(fixedBillSchema),
    transactions: z.array(transactionSchema),
    spendingEstimates: z.array(spendingEstimateSchema),
    budgetOverrides: z.array(budgetOverrideSchema),
  }),
})

export type BackupFile = z.infer<typeof backupSchema>

export type ParseBackupResult = { ok: true; backup: BackupFile } | { ok: false; error: string }

/** Validate an imported JSON string. Never throws. */
export function parseBackup(text: string): ParseBackupResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' }
  }
  if (typeof json === 'object' && json !== null && (json as { app?: unknown }).app !== BACKUP_APP_ID) {
    return { ok: false, error: 'This file is not an Auto Budget backup.' }
  }
  const version = (json as { schemaVersion?: unknown } | null)?.schemaVersion
  if (typeof version === 'number' && version > BACKUP_SCHEMA_VERSION) {
    return { ok: false, error: 'This backup was made by a newer version of Auto Budget. Update the app and try again.' }
  }
  const result = backupSchema.safeParse(json)
  if (!result.success) {
    const issue = result.error.issues[0]
    const where = issue?.path.join('.') ?? ''
    return { ok: false, error: `The backup file is damaged or incomplete${where ? ` (problem at ${where})` : ''}.` }
  }
  return { ok: true, backup: result.data }
}
