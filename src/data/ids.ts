/** RFC 4122 v4 UUID. Uses crypto.randomUUID when available. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function nowISO(): string {
  return new Date().toISOString()
}

/**
 * A new updatedAt for a record that had `previous`: now, but always at least
 * 1 ms later than before. Sync is last-write-wins by updatedAt, so an edit
 * must never look older than the version it replaces, even if this device's
 * clock is behind the one that wrote it.
 */
export function nextUpdatedAt(previous: string | null | undefined): string {
  const prev = previous ? Date.parse(previous) : NaN
  const now = Date.now()
  return new Date(Number.isNaN(prev) ? now : Math.max(now, prev + 1)).toISOString()
}
