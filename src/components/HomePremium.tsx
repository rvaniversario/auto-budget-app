import { useState } from 'react'
import { Clock, HardDriveDownload, RefreshCw, X } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { alive, formatLongDate, formatMoney, isInPeriod, percentUsed, sum, todayISO } from '@/core'
import { useAppData } from '@/hooks/useAppData'
import { daysSinceBackupFile, saveBackupFile } from '@/lib/backupFile'
import { safeStorage } from '@/lib/browser'
import { useDebtPlan } from '@/lib/debtPlan'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { premiumEnabled, useEntitlement } from '@/premium'
import { PremiumEntry } from '@/premium/components'

const dismissKey = (kind: string, expiresAt: string) => `auto-budget:premium-notice:${kind}:${expiresAt}`

function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** One dismissible notice: a trial ending within 3 days, or a trial that has ended. */
export function TrialNotice() {
  const ent = useEntitlement()
  const [, rerender] = useState(0)
  if (!premiumEnabled || ent.loading) return null

  const ending = ent.isPremium && !ent.isLifetime && ent.daysLeft !== null && ent.daysLeft <= 3 && ent.expiresAt
  const ended = !ent.isPremium && ent.trialEndedAt
  const kind = ending ? 'ending' : ended ? 'ended' : null
  const expiresAt = ending ? ent.expiresAt! : ended ? ent.trialEndedAt! : null
  if (!kind || !expiresAt || safeStorage.get(dismissKey(kind, expiresAt))) return null

  const dismiss = () => {
    safeStorage.set(dismissKey(kind, expiresAt), '1')
    rerender((n) => n + 1)
  }
  const date = formatLongDate(localDay(expiresAt))
  const message =
    kind === 'ending'
      ? `Your free trial ends on ${date}.${ent.legacySync ? '' : ' Sync stops then, so pick one device as your main one or save a backup file.'} Unlock Premium to keep it for good.`
      : `Your free trial ended on ${date}. Everything free still works.`

  return (
    <section aria-label="Premium trial" className="flex items-start gap-3 rounded-card bg-warning-tint p-4 text-warning-text">
      <Clock className="mt-0.5 size-5 flex-none" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <p className="text-[13px] leading-snug text-foreground">{message}</p>
        <Link
          to="/premium"
          className="flex h-11 items-center justify-center self-start rounded-lg bg-ink px-4 text-[13px] font-semibold text-ink-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Unlock Premium
        </Link>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="-mt-2 -mr-2 flex size-11 flex-none items-center justify-center rounded-lg hover:bg-black/5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
    </section>
  )
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Dismiss"
      className="-mt-2 -mr-2 flex size-11 flex-none items-center justify-center rounded-lg hover:bg-black/5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <X className="size-5" aria-hidden="true" />
    </button>
  )
}

const LEGACY_NOTICE_KEY = 'auto-budget:legacy-sync-notice'

/** One-time notice for accounts that synced before sync became Premium. */
export function LegacySyncNotice() {
  const ent = useEntitlement()
  const [, rerender] = useState(0)
  if (!premiumEnabled || ent.loading || !ent.legacySync || ent.isPremium || safeStorage.get(LEGACY_NOTICE_KEY)) return null
  const dismiss = () => {
    safeStorage.set(LEGACY_NOTICE_KEY, '1')
    rerender((n) => n + 1)
  }
  return (
    <section aria-label="Sync stays free" className="flex items-start gap-3 rounded-card bg-success-tint p-4 text-success-text">
      <RefreshCw className="mt-0.5 size-5 flex-none" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug text-foreground">
        Sync is now part of Premium. Because you were already using it, it stays free for you.
      </p>
      <DismissButton onClick={dismiss} />
    </section>
  )
}

const REMINDER_KEY = 'auto-budget:backup-reminder-dismissed'
const REMINDER_DAYS = 30
const REMINDER_MIN_TRANSACTIONS = 20

/**
 * "Back up your data": for users who don't sync, have more than 20
 * transactions and haven't saved a backup file in 30 days. Dismissing hides
 * it for another 30 days.
 */
export function BackupReminder() {
  const { snapshot } = useAppData()
  const ent = useEntitlement()
  const [, rerender] = useState(0)
  if (ent.loading || ent.canSync) return null
  if (alive(snapshot.transactions).length <= REMINDER_MIN_TRANSACTIONS) return null
  const since = daysSinceBackupFile()
  if (since !== null && since < REMINDER_DAYS) return null
  const dismissed = safeStorage.get(REMINDER_KEY)
  if (dismissed && (Date.parse(todayISO()) - Date.parse(dismissed)) / 86_400_000 < REMINDER_DAYS) return null

  const dismiss = () => {
    safeStorage.set(REMINDER_KEY, todayISO())
    rerender((n) => n + 1)
  }
  const save = async () => {
    await saveBackupFile()
    rerender((n) => n + 1)
    toast.success('Backup file saved', { description: 'Keep it somewhere safe, like Google Drive or email.' })
  }

  return (
    <section aria-labelledby="backup-reminder-title" className="flex items-start gap-3 rounded-card bg-card p-4">
      <HardDriveDownload className="mt-0.5 size-5 flex-none text-link" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <h2 id="backup-reminder-title" className="font-sans text-[13px] font-bold">
            Back up your data
          </h2>
          <p className="text-sm leading-snug text-muted-foreground">
            {since === null ? "You haven't saved a backup file yet." : `Your last backup file is ${since} days old.`} Your data lives only on this device.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={save}
            className="flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Save a backup file
          </button>
          {premiumEnabled && (
            <Link to="/premium?feature=sync" className="min-h-11 py-2.5 text-[13px] font-semibold text-link underline-offset-2 hover:underline">
              Sync across devices with Premium
            </Link>
          )}
        </div>
      </div>
      <DismissButton onClick={dismiss} />
    </section>
  )
}

/** The Reports entry on Home. */
export function ReportsCard() {
  return <PremiumEntry feature="reports" title="Reports" description="Compare months and spot categories that keep rising" />
}

/**
 * With the debt planner in use (and Premium active), Home shows this month's
 * planned payment for each card and loan instead of the single card payment.
 * Returns null otherwise, so the caller shows the usual row.
 */
export function usePlannedDebtRows() {
  const { snapshot, model } = useAppData()
  const ent = useEntitlement()
  const p = useDebtPlan(snapshot, model)
  const active = premiumEnabled && ent.isPremium && !!snapshot.debtPlan?.inUse && p.debts.length > 0
  if (!active) return null
  const thisMonth = p.result.schedule[0]?.payments ?? {}
  const transactions = alive(snapshot.transactions)
  return p.debts.map((d) => {
    const paid = sum(
      transactions.filter((t) => t.type === 'transfer' && t.toAccountId === d.id && isInPeriod(t.date, model.period)).map((t) => t.amount),
    )
    return { id: d.id, name: d.name, planned: thisMonth[d.id] ?? 0, paid }
  })
}

export function PlannedDebtBars({ rows }: { rows: NonNullable<ReturnType<typeof usePlannedDebtRows>> }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold text-muted-foreground">Debt plan this month</span>
        <Link to="/debt-planner" className="flex min-h-11 items-center text-sm font-semibold text-link">
          See plan
        </Link>
      </div>
      {rows.map((r) => {
        const done = r.planned > 0 && r.paid >= r.planned
        return (
          <div key={r.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13px] font-semibold">{r.name}</span>
              <span className={cn('flex-none text-[12px]', done ? 'font-semibold text-success-text' : 'text-muted-foreground')}>
                {formatMoney(r.paid)} of {formatMoney(r.planned)}
              </span>
            </div>
            <Progress value={percentUsed(r.paid, r.planned)} aria-label={`${r.name}: paid ${formatMoney(r.paid)} of ${formatMoney(r.planned)} planned`} />
          </div>
        )
      })}
    </div>
  )
}
