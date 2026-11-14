/**
 * Manual backup files (free): save, share and remember when the last one was
 * saved. The file is the JSON export from SPEC.md; restoring goes through
 * parseBackup + repo.importBackup.
 */
import { alive, todayISO } from '@/core'
import { repo } from '@/data'
import { downloadFile, safeStorage } from './browser'

const LAST_BACKUP_KEY = 'auto-budget:last-backup'
const LAST_BACKUP_COUNT_KEY = 'auto-budget:last-backup-count'

export interface LastBackup {
  /** YYYY-MM-DD. */
  date: string
  /** Transactions in that file, when known. */
  transactions: number | null
}

export function lastBackupFile(): LastBackup | null {
  const date = safeStorage.get(LAST_BACKUP_KEY)
  if (!date) return null
  const count = Number(safeStorage.get(LAST_BACKUP_COUNT_KEY) ?? '')
  return { date, transactions: Number.isFinite(count) && safeStorage.get(LAST_BACKUP_COUNT_KEY) ? count : null }
}

export function forgetLastBackupFile(): void {
  safeStorage.set(LAST_BACKUP_KEY, '')
  safeStorage.set(LAST_BACKUP_COUNT_KEY, '')
}

async function buildFile(): Promise<{ name: string; text: string; transactions: number }> {
  const backup = await repo.exportBackup()
  return {
    name: `auto-budget-backup-${todayISO()}.json`,
    text: JSON.stringify(backup, null, 2),
    transactions: alive(backup.data.transactions).length,
  }
}

function remember(transactions: number) {
  safeStorage.set(LAST_BACKUP_KEY, todayISO())
  safeStorage.set(LAST_BACKUP_COUNT_KEY, String(transactions))
}

/** Download a backup file. */
export async function saveBackupFile(): Promise<void> {
  const file = await buildFile()
  downloadFile(file.name, file.text, 'application/json')
  remember(file.transactions)
}

/** The browser can share files (most phones). */
export function canShareBackupFile(): boolean {
  try {
    const probe = new File(['{}'], 'probe.json', { type: 'application/json' })
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/** Open the share sheet with a backup file. Returns false when the user cancelled. */
export async function shareBackupFile(): Promise<boolean> {
  const file = await buildFile()
  try {
    await navigator.share({ files: [new File([file.text], file.name, { type: 'application/json' })], title: 'Auto Budget backup' })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return false
    throw err
  }
  remember(file.transactions)
  return true
}

/** Days since the last saved backup file, or null if there is none. */
export function daysSinceBackupFile(today = todayISO()): number | null {
  const last = lastBackupFile()
  if (!last) return null
  return Math.round((Date.parse(today) - Date.parse(last.date)) / 86_400_000)
}
