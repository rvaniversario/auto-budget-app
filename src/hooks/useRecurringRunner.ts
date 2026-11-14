import { useEffect, useRef } from 'react'
import { alive, dueOccurrences, type AppSnapshot } from '@/core'
import { repo } from '@/data'
import { premiumEnabled, useEntitlement } from '@/premium'

/**
 * Creates recurring transactions that have fallen due, up to today. Runs on
 * open and whenever the data changes (including after a sync). Occurrence
 * ids are deterministic, so two devices never create the same one twice.
 * Only while Premium is active: after a trial ends templates are kept but
 * stop creating transactions.
 */
export function useRecurringRunner(snapshot: AppSnapshot, today: string) {
  const { isPremium, loading } = useEntitlement()
  const running = useRef(false)

  useEffect(() => {
    if (!premiumEnabled || loading || !isPremium || running.current) return
    const templates = alive(snapshot.recurringTemplates ?? [])
    if (templates.length === 0) return
    const existing = new Set(snapshot.transactions.map((t) => t.id))
    const due = dueOccurrences(templates, existing, today, new Date().toISOString())
    if (due.length === 0) return
    running.current = true
    repo
      .addRecurringOccurrences(due)
      .catch((err) => console.warn('Recurring transactions could not be created', err))
      .finally(() => {
        running.current = false
      })
  }, [snapshot, today, isPremium, loading])
}
