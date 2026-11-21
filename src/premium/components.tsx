import type { ReactNode } from 'react'
import { Check, Lock } from 'lucide-react'
import { Link } from 'react-router'
import { SubHeader } from '@/components/layout'
import { cn } from '@/lib/utils'
import { premiumEnabled } from './config'
import { premiumFeature, type PremiumFeatureId } from './features'
import { useEntitlement } from './index'

/** Small dark "Premium" pill. */
export function PremiumBadge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex flex-none items-center rounded-[10px] bg-ink px-2.5 py-0.5 text-[10px] font-bold text-ink-foreground', className)}>
      Premium
    </span>
  )
}

/**
 * Renders its children for Premium users and the feature's locked view for
 * everyone else. Every Premium screen and control goes through this.
 */
export function PremiumGate({ feature, children, locked }: { feature: PremiumFeatureId; children: ReactNode; locked?: ReactNode }) {
  const ent = useEntitlement()
  if (!premiumEnabled) return null
  if (ent.loading) return <div aria-busy="true" className="min-h-40" />
  if (ent.isPremium) return <>{children}</>
  return <>{locked ?? <LockedFeature feature={feature} />}</>
}

/** A static picture of the feature. Never the user's real results. */
function Preview({ feature }: { feature: PremiumFeatureId }) {
  const bar = 'rounded-t-md bg-step-off'
  return (
    <div role="img" aria-label="Sample preview, not your data" className="flex flex-col gap-2 rounded-[14px] bg-background p-4">
      {feature === 'reports' && (
        <div className="flex h-[140px] items-end gap-2.5" aria-hidden="true">
          {[45, 62, 50, 78, 66, 90].map((h, i) => (
            <div key={i} className={cn('flex-1', bar)} style={{ height: `${h}%` }} />
          ))}
        </div>
      )}
      {feature === 'debtPlanner' && (
        <svg viewBox="0 0 300 140" className="h-[140px] w-full" aria-hidden="true">
          <path d="M8 20 L60 38 L110 60 L160 84 L210 106 L260 124 L292 130" fill="none" stroke="var(--step-off)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 20 L60 50 L110 80 L160 110 L200 130" fill="none" stroke="var(--muted-foreground)" strokeOpacity="0.45" strokeWidth="4" strokeDasharray="8 8" strokeLinecap="round" />
        </svg>
      )}
      {feature === 'recurring' && (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[70, 55, 82].map((w, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg bg-card p-3">
              <span className="size-8 flex-none rounded-full bg-step-off" />
              <span className="h-3 rounded bg-step-off" style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      )}
      <span className="text-center text-xs text-muted-foreground">Sample preview, not your data</span>
    </div>
  )
}

/** What a free user sees instead of a Premium feature. */
export function LockedFeature({ feature, header = true }: { feature: PremiumFeatureId; header?: boolean }) {
  const f = premiumFeature(feature)
  const ent = useEntitlement()
  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4 md:mx-auto">
      {header && <SubHeader title={f.shortName} />}
      <section aria-labelledby={`locked-${f.id}`} className="flex flex-col gap-4 rounded-hero bg-card px-5 py-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-11 items-center justify-center rounded-lg bg-background">
            <Lock className="size-[22px]" aria-hidden="true" />
          </span>
          <PremiumBadge />
        </div>
        <h2 id={`locked-${f.id}`} className="text-2xl leading-tight font-bold">
          {f.name}
        </h2>
        <p className="text-[13px] leading-normal text-muted-foreground">{f.description}</p>
        <Preview feature={feature} />
        <ul className="flex flex-col gap-2.5 text-[13px]">
          {f.highlights.map((h) => (
            <li key={h} className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-5 flex-none text-link" strokeWidth={2.4} aria-hidden="true" />
              {h}
            </li>
          ))}
        </ul>
        <Link
          to={`/premium?feature=${f.id}`}
          className="mt-2 flex h-[54px] items-center justify-center rounded-[14px] bg-primary text-base font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          See Premium
        </Link>
        {ent.trialAvailable && <p className="text-center text-[12px] text-muted-foreground">Try it free for 14 days. No payment needed.</p>}
      </section>
    </div>
  )
}

/** A row or card that opens a Premium feature (or its locked view). Hidden when Premium is off. */
export function PremiumEntry({
  feature,
  title,
  description,
  className,
}: {
  feature: PremiumFeatureId
  title?: string
  description?: string
  className?: string
}) {
  const ent = useEntitlement()
  if (!premiumEnabled) return null
  const f = premiumFeature(feature)
  const Icon = f.icon
  return (
    <Link
      to={f.path}
      className={cn(
        'flex min-h-16 items-center gap-3 rounded-card bg-card p-4 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      <span className="flex size-10 flex-none items-center justify-center rounded-lg bg-success-tint text-success-text">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          {title ?? f.name}
          {!ent.isPremium && <PremiumBadge />}
        </span>
        <span className="text-[12px] text-muted-foreground">{description ?? f.benefit}</span>
      </span>
    </Link>
  )
}
