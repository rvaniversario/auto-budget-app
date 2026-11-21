import { useState } from 'react'
import { BadgeCheck, Check, ChevronRight, Loader2, Smartphone } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { formatLongDate } from '@/core'
import { SubHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  featuresFirst,
  PREMIUM_FEATURES,
  premiumEnabled,
  refreshPremium,
  startTrial,
  useEntitlement,
  type PremiumFeatureId,
} from '@/premium'
import { PremiumBadge } from '@/premium/components'

/**
 * The web app never sells Premium: it is bought once in the Android app through
 * Google Play, and this app reads the same entitlement. No price, checkout or
 * payment link appears here.
 */
const PLAY_STORE_URL = import.meta.env.VITE_PLAY_STORE_URL?.trim() || null

const primaryButton = 'h-[54px] w-full rounded-[14px] text-base'

function isFeatureId(v: string | null): v is PremiumFeatureId {
  return PREMIUM_FEATURES.some((f) => f.id === v)
}

function BenefitList({ first, links = false }: { first?: PremiumFeatureId | null; links?: boolean }) {
  return (
    <ul className="flex flex-col gap-1">
      {featuresFirst(first).map((f) => {
        const body = (
          <>
            <Check className="mt-0.5 size-5 flex-none text-link" strokeWidth={2.4} aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-semibold">{f.name}</span>
              <span className="text-[12px] leading-snug text-muted-foreground">{f.benefit}</span>
            </span>
            {links && <ChevronRight className="mt-0.5 size-5 flex-none text-muted-foreground" aria-hidden="true" />}
          </>
        )
        return (
          <li key={f.id}>
            {links ? (
              <Link
                to={f.path}
                className="flex items-start gap-3 rounded-lg py-2.5 outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {body}
              </Link>
            ) : (
              <div className="flex items-start gap-3 py-2.5">{body}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function PolicyLinks() {
  const link = 'underline underline-offset-2 hover:text-foreground'
  return (
    <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
      <Link to="/terms" className={link}>
        Terms
      </Link>
      <Link to="/refunds" className={link}>
        Refund policy
      </Link>
      <Link to="/privacy" className={link}>
        Privacy Policy
      </Link>
    </p>
  )
}

/** "Already bought it? Refresh": re-checks the entitlement after buying on Android. */
function RefreshLink() {
  const ent = useEntitlement()
  const [busy, setBusy] = useState(false)
  if (!ent.signedIn) return null
  const onRefresh = async () => {
    setBusy(true)
    await refreshPremium()
    setBusy(false)
  }
  return (
    <p className="text-center text-[12px] text-muted-foreground">
      Already bought it?{' '}
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        className="inline-flex min-h-11 items-center gap-1 font-semibold text-link underline underline-offset-2 disabled:opacity-60"
      >
        {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
        Refresh
      </button>
    </p>
  )
}

/** Explains where Premium is bought, with the Google Play link when configured. */
function AndroidAppCard({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-[14px] border-2 border-primary bg-background p-4', className)}>
      <span className="flex items-center gap-2 text-[13px] font-semibold">
        <Smartphone className="size-5 text-link" aria-hidden="true" />
        Unlocked in the Android app
      </span>
      <p className="text-sm leading-snug">
        Premium is unlocked in the Auto Budget Android app. Buy it once there and it works here too when you sign in with the same account.
      </p>
      {PLAY_STORE_URL && (
        <a
          href={PLAY_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-12 items-center justify-center rounded-[14px] bg-ink text-base font-semibold text-ink-foreground outline-none hover:bg-ink/90 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Get the Android app
        </a>
      )}
    </div>
  )
}

/** /premium: the paywall for free users, the status screen for Premium users. */
export function PremiumScreen() {
  const ent = useEntitlement()
  if (!premiumEnabled) return <Navigate to="/" replace />
  if (ent.loading) {
    return (
      <div className="flex w-full max-w-[560px] flex-col gap-4 md:mx-auto lg:max-w-[880px]">
        <SubHeader title="" />
        <div aria-busy="true" className="min-h-60" />
      </div>
    )
  }
  return ent.isPremium ? <PremiumStatus /> : <Paywall />
}

function Paywall() {
  const ent = useEntitlement()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const feature = params.get('feature')
  const first = isFeatureId(feature) ? feature : null
  const [busy, setBusy] = useState(false)

  const onTrial = async () => {
    // Premium is tied to an account: guests sign in first and come back here.
    if (!ent.signedIn) {
      navigate('/account/sign-in', {
        state: { message: 'Sign in so your Premium and your synced data are saved to your account', returnTo: `${location.pathname}${location.search}` },
      })
      return
    }
    setBusy(true)
    const result = await startTrial()
    setBusy(false)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Your 14-day free trial has started')
    const f = first ? PREMIUM_FEATURES.find((x) => x.id === first) : null
    navigate(f ? f.path : '/premium', { replace: true })
  }

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4 md:mx-auto lg:max-w-[880px]">
      <SubHeader title="" close />
      <section aria-labelledby="paywall-title" className="flex flex-col gap-5 rounded-hero bg-card px-5 py-6 md:px-7 md:py-8">
        <div className="flex flex-col gap-2">
          <PremiumBadge className="self-start" />
          <h1 id="paywall-title" className="text-[24px] leading-tight font-bold tracking-[-0.01em]">
            Auto Budget Premium
          </h1>
          <p className="text-[13px] leading-normal text-muted-foreground">Clear your debts faster and see where your money goes.</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,340px)] lg:items-start lg:gap-8">
          <BenefitList first={first} />

          <div className="flex flex-col gap-4">
            {ent.trialAvailable && (
              <div className="flex flex-col gap-2">
                <Button className={primaryButton} disabled={busy} onClick={onTrial}>
                  {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
                  Start 14-day free trial
                </Button>
                <p className="text-center text-[12px] text-muted-foreground">No payment needed</p>
              </div>
            )}

            <AndroidAppCard />
            <RefreshLink />

            {ent.trialEndedAt && (
              <p className="text-center text-[12px] text-muted-foreground">Your free trial ended on {formatLongDate(ent.trialEndedAt.slice(0, 10))}.</p>
            )}
          </div>
        </div>

        <p className="text-center text-sm font-semibold">Everything you use today stays free.</p>
        <PolicyLinks />
      </section>
    </div>
  )
}

function PremiumStatus() {
  const ent = useEntitlement()
  const trial = !ent.isLifetime

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4 md:mx-auto">
      <SubHeader title="Auto Budget Premium" />
      <section aria-label="Your Premium" className="flex flex-col gap-3 hero-card rounded-hero p-5">
        {trial ? (
          <>
            <span className="self-start rounded-xl bg-hero-chip px-2.5 py-[3px] text-[10px] font-bold text-hero-link">
              {ent.source === 'trial' ? 'Free trial' : 'Premium'}
            </span>
            <p className="text-2xl leading-tight font-bold">
              {ent.daysLeft ?? daysUntil(ent.expiresAt)} day{(ent.daysLeft ?? daysUntil(ent.expiresAt)) === 1 ? '' : 's'} left
            </p>
            {ent.expiresAt && <p className="text-sm text-hero-muted">Ends {formatLongDate(localDate(ent.expiresAt))}</p>}
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 self-start rounded-xl bg-hero-chip px-2.5 py-[3px] text-[10px] font-bold text-hero-link">
              <BadgeCheck className="size-3.5" aria-hidden="true" />
              Premium unlocked
            </span>
            <p className="text-2xl leading-tight font-bold">Yours for good</p>
            <p className="text-sm text-hero-muted">One-time purchase · nothing to renew</p>
          </>
        )}
      </section>

      {trial && ent.source === 'trial' && (
        <>
          <AndroidAppCard className="border-border bg-card" />
          <RefreshLink />
        </>
      )}

      <section aria-label="Premium features" className="rounded-card bg-card px-4 py-2 md:px-5">
        <BenefitList links />
      </section>

      <PurchaseRecords />
      <PolicyLinks />
    </div>
  )
}

function daysUntil(iso: string | null): number {
  if (!iso) return 0
  return Math.max(1, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000))
}

function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "Bought through Google Play on [date]" with the order ID. Refunds go through Google Play. */
function PurchaseRecords() {
  const ent = useEntitlement()
  if (ent.purchases.length === 0) return null
  return (
    <section aria-labelledby="purchase-title" className="flex flex-col gap-2 rounded-card bg-card px-4 py-[18px] md:px-5">
      <h2 id="purchase-title" className="font-sans text-base font-bold">
        Purchase
      </h2>
      <ul className="flex flex-col">
        {ent.purchases.map((p, i) => (
          <li key={p.id} className={cn('flex min-h-[56px] items-center justify-between gap-3 py-2', i > 0 && 'border-t border-border')}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-semibold">
                {p.provider === 'google_play' ? 'Bought through Google Play' : 'Bought'} on {formatLongDate(localDate(p.date))}
              </span>
              {p.orderId && <span className="truncate text-[12px] text-muted-foreground">Order {p.orderId}</span>}
            </span>
            {p.status === 'refunded' && <span className="flex-none text-xs font-semibold text-warning-text">Refunded</span>}
          </li>
        ))}
      </ul>
      <p className="text-[12px] leading-snug text-muted-foreground">Refunds are requested through Google Play.</p>
    </section>
  )
}
