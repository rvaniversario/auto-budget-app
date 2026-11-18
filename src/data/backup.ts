import { z } from 'zod'
import { isValidISODate } from '@/core'

export const BACKUP_APP_ID = 'auto-budget'
/**
 * 2 adds loans, recurring templates and the debt plan. 3 adds weekly and daily pay,
 * twice-a-month paydays, moved paydays and e-wallet accounts. 4 adds debt accounts
 * and transfer fees.
 * Older files still import.
 */
export const BACKUP_SCHEMA_VERSION = 4

const centavos = z.number().int().safe()
const nonNegCentavos = centavos.nonnegative()
const dayOfMonth = z.number().int().min(1).max(31)
const isoDate = z.string().refine(isValidISODate, 'Invalid date')
const weekday = z.number().int().min(0).max(6)

const sync = {
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
}

export const settingsSchema = z.object({
  ...sync,
  monthlySalary: nonNegCentavos,
  payFrequency: z.enum(['monthly', 'semimonthly', 'weekly', 'daily']),
  paydayDay: dayOfMonth,
  secondPaydayDay: dayOfMonth.optional(),
  payWeekday: weekday.optional(),
  workWeekdays: z.array(weekday).optional(),
  paydayOverrides: z.record(z.string().regex(/^\d{4}-\d{2}$/), isoDate).optional(),
  bufferAmount: nonNegCentavos,
  theme: z.enum(['light', 'dark', 'system']),
  onboardingComplete: z.boolean(),
  safePaymentEnabled: z.boolean().optional(),
  carryOverEnabled: z.boolean().optional(),
})

export const accountSchema = z.object({
  ...sync,
  name: z.string(),
  type: z.enum(['cash', 'bank', 'ewallet', 'credit_card', 'loan', 'debt']),
  openingBalance: centavos,
  statementDay: dayOfMonth.nullable(),
  dueDay: dayOfMonth.nullable(),
  minimumDue: nonNegCentavos.nullable(),
  monthlyInterestRate: z.number().min(0).max(100).nullable(),
})

export const categorySchema = z.object({
  ...sync,
  name: z.string(),
  kind: z.enum(['essential', 'optional', 'income']),
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
  fee: nonNegCentavos.optional(),
  note: z.string(),
  fixedBillId: z.string().nullable(),
  isOneTime: z.boolean(),
  recurringTemplateId: z.string().nullable().optional(),
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

export const recurringTemplateSchema = z.object({
  ...sync,
  type: z.enum(['expense', 'income', 'transfer']),
  amount: nonNegCentavos,
  categoryId: z.string().nullable(),
  accountId: z.string(),
  toAccountId: z.string().nullable(),
  fee: nonNegCentavos.optional(),
  note: z.string(),
  fixedBillId: z.string().nullable(),
  schedule: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('monthly'), day: dayOfMonth }),
    z.object({ kind: z.literal('twiceMonthly'), days: z.tuple([dayOfMonth, dayOfMonth]) }),
    z.object({ kind: z.literal('weekly'), every: z.number().int().min(1).max(52) }),
  ]),
  startDate: isoDate,
  endDate: isoDate.nullable(),
  paused: z.boolean(),
  activeFrom: isoDate,
})

const yearMonth = z.string().regex(/^\d{4}-\d{2}$/)

export const debtPlanSchema = z.object({
  ...sync,
  strategy: z.enum(['highestInterest', 'smallestBalance', 'custom']),
  customOrder: z.array(z.string()),
  monthlyAmount: nonNegCentavos.nullable(),
  extras: z.array(z.object({ id: z.string(), month: yearMonth, amount: nonNegCentavos })),
  goalMonth: yearMonth.nullable(),
  inUse: z.boolean(),
})

export const backupSchema = z.object({
  app: z.literal(BACKUP_APP_ID),
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(BACKUP_SCHEMA_VERSION)]),
  exportedAt: z.string(),
  data: z.object({
    settings: z.array(settingsSchema),
    accounts: z.array(accountSchema),
    categories: z.array(categorySchema),
    fixedBills: z.array(fixedBillSchema),
    transactions: z.array(transactionSchema),
    spendingEstimates: z.array(spendingEstimateSchema),
    budgetOverrides: z.array(budgetOverrideSchema),
    recurringTemplates: z.array(recurringTemplateSchema).default([]),
    debtPlans: z.array(debtPlanSchema).default([]),
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
