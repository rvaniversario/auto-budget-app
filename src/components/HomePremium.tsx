import { useState } from 'react'
import { Clock, X } from 'lucide-react'
import { Link } from 'react-router'
import { alive, formatLongDate, formatMoney, isInPeriod, percentUsed, sum } from '@/core'
import { useAppData } from '@/hooks/useAppData'
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
      ? `Your free trial ends on ${date}. Pay once to keep Premium for good.`
      : `Your free trial ended on ${date}. Everything free still works.`

  return (
    <section aria-label="Premium trial" className="flex items-start gap-3 rounded-card bg-warning-tint p-4 text-warning-text">
      <Clock className="mt-0.5 size-5 flex-none" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <p className="text-[15px] leading-snug text-foreground">{message}</p>
        <Link
          to="/premium"
          className="flex h-11 items-center justify-center self-start rounded-lg bg-ink px-4 text-[15px] font-semibold text-ink-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
        <span className="text-[13px] font-semibold text-muted-foreground">Debt plan this month</span>
        <Link to="/debt-planner" className="flex min-h-11 items-center text-sm font-semibold text-link">
          See plan
        </Link>
      </div>
      {rows.map((r) => {
        const done = r.planned > 0 && r.paid >= r.planned
        return (
          <div key={r.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[15px] font-semibold">{r.name}</span>
              <span className={cn('flex-none text-[13px]', done ? 'font-semibold text-success-text' : 'text-muted-foreground')}>
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
