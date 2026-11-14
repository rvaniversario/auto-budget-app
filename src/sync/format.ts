import type { SyncState } from './controller'

/** "Today, 9:14 PM", "Yesterday, 8:00 AM" or "10 Nov, 9:14 PM". */
export function formatWhen(iso: string | null, now = new Date()): string {
  if (!iso) return 'Not yet'
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  return `${d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })}, ${time}`
}

/** Short sync status for tags and the Settings row. */
export function backupStatus(sync: SyncState): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (sync.choice) return { label: 'Waiting for your choice', tone: 'warning' }
  if (sync.phase === 'syncing') return { label: 'Syncing…', tone: 'success' }
  if (sync.phase === 'offline') return { label: sync.pending ? 'Offline: changes waiting' : 'Offline', tone: 'warning' }
  if (sync.allowed === false) return { label: 'Paused', tone: 'warning' }
  if (sync.phase === 'error' || !sync.linked) return { label: 'Not synced', tone: 'danger' }
  if (sync.pending) return { label: 'Changes waiting', tone: 'warning' }
  return { label: 'Up to date', tone: 'success' }
}
