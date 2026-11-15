import type {
  Account,
  AppSnapshot,
  BudgetOverride,
  Category,
  Centavos,
  DebtPlan,
  FixedBill,
  RecurringTemplate,
  ISODate,
  Settings,
  SpendingEstimate,
  SyncFields,
  Transaction,
} from '@/core'
import type { BackupFile } from './backup'

/** A record as the caller provides it: the repository fills in id and timestamps. */
export type NewRecord<T extends SyncFields> = Omit<T, keyof SyncFields>
export type RecordPatch<T extends SyncFields> = Partial<NewRecord<T>>

/**
 * Storage boundary. Screens and hooks only talk to this interface, never to
 * Dexie directly, so a cloud-synced implementation can replace it later.
 *
 * All list/get methods skip soft-deleted records. Delete methods soft-delete
 * (set deletedAt) instead of removing rows.
 */
export interface Repository {
  // Settings (a single record)
  getSettings(): Promise<Settings | undefined>
  saveSettings(patch: RecordPatch<Settings>): Promise<Settings>

  // Accounts
  listAccounts(): Promise<Account[]>
  getAccount(id: string): Promise<Account | undefined>
  addAccount(input: NewRecord<Account>): Promise<Account>
  updateAccount(id: string, patch: RecordPatch<Account>): Promise<void>
  deleteAccount(id: string): Promise<void>

  // Categories
  listCategories(): Promise<Category[]>
  addCategory(input: NewRecord<Category>): Promise<Category>
  updateCategory(id: string, patch: RecordPatch<Category>): Promise<void>
  deleteCategory(id: string): Promise<void>

  // Fixed bills
  listFixedBills(): Promise<FixedBill[]>
  addFixedBill(input: NewRecord<FixedBill>): Promise<FixedBill>
  updateFixedBill(id: string, patch: RecordPatch<FixedBill>): Promise<void>
  deleteFixedBill(id: string): Promise<void>

  // Transactions
  listTransactions(): Promise<Transaction[]>
  getTransaction(id: string): Promise<Transaction | undefined>
  addTransaction(input: NewRecord<Transaction>): Promise<Transaction>
  updateTransaction(id: string, patch: RecordPatch<Transaction>): Promise<void>
  deleteTransaction(id: string): Promise<void>
  restoreTransaction(id: string): Promise<void>

  // Onboarding spending estimates
  listSpendingEstimates(): Promise<SpendingEstimate[]>
  setSpendingEstimate(categoryId: string, amount: Centavos): Promise<void>

  // This month's plan edits
  listBudgetOverrides(): Promise<BudgetOverride[]>
  setBudgetOverride(periodStart: ISODate, key: string, amount: Centavos): Promise<void>
  clearBudgetOverride(periodStart: ISODate, key: string): Promise<void>
  /** Apply several overrides atomically. */
  setBudgetOverrides(periodStart: ISODate, entries: { key: string; amount: Centavos }[]): Promise<void>
  /** Re-key plan edits when a budget month's start date changes (moved payday). Atomic. */
  moveBudgetOverrides(moves: { from: ISODate; to: ISODate }[]): Promise<void>

  // Recurring transactions (Premium)
  listRecurringTemplates(): Promise<RecurringTemplate[]>
  addRecurringTemplate(input: NewRecord<RecurringTemplate>): Promise<RecurringTemplate>
  updateRecurringTemplate(id: string, patch: RecordPatch<RecurringTemplate>): Promise<void>
  /** Soft-deletes the template. Transactions it already created stay. */
  deleteRecurringTemplate(id: string): Promise<void>
  /** Insert generated occurrences whose ids don't exist yet. Returns how many were added. */
  addRecurringOccurrences(occurrences: Transaction[]): Promise<number>

  // Debt payoff plan (Premium, a single record)
  getDebtPlan(): Promise<DebtPlan | undefined>
  saveDebtPlan(patch: RecordPatch<DebtPlan>): Promise<DebtPlan>

  /** Everything needed for the month model, read consistently. Null before onboarding starts. */
  getSnapshot(): Promise<AppSnapshot | null>

  // Backup
  exportBackup(): Promise<BackupFile>
  /** Replace all local data with the backup's contents. */
  importBackup(backup: BackupFile): Promise<void>
  /** Wipe everything and restore the default categories. */
  deleteAllData(): Promise<void>
}
