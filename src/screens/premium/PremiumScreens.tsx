import { useEffect, useState } from 'react'
import { BadgeCheck, Check, ChevronRight, Loader2, Lock } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { formatLongDate } from '@/core'
import { SubHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  featuresFirst,
  formatPrice,
  payForPremium,
  PREMIUM_FEATURES,
  premiumEnabled,
  refreshPremium,
  startTrial,
  useEntitlement,
  type PremiumFeatureId,
} from '@/premium'
import { PremiumBadge } from '@/premium/components'

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL

const primaryButton = 'h-[54px] w-full rounded-[14px] text-base'

function isFeatureId(v: string | null): v is PremiumFeatureId {
  return PREMIUM_FEATURES.some((f) => f.id === v)
}

/** "₱399" from the server's product config; never a client constant. */
function usePrice(): string | null {
  const ent = useEntitlement()
  return ent.product ? formatPrice(ent.product.amount) : null
}

function BenefitList({ first, links = false }: { first?: PremiumFeatureId | null; links?: boolean }) {
  return (
    <ul className="flex flex-col gap-1">
      {featuresFirst(first).map((f) => {
        const body = (
          <>
            <Check className="mt-0.5 size-5 flex-none text-link" strokeWidth={2.4} aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{f.name}</span>
              <span className="text-[13px] leading-snug text-muted-foreground">{f.benefit}</span>
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
    <p className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
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
  const price = usePrice()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const feature = params.get('feature')
  const first = isFeatureId(feature) ? feature : null
  const [busy, setBusy] = useState<'trial' | 'pay' | null>(null)

  /** Premium is tied to an account: guests sign in first and come back here. */
  const requireAccount = () => {
    if (ent.signedIn) return true
    navigate('/account/sign-in', {
      state: { message: 'Sign in so your Premium is saved to your account', returnTo: `${location.pathname}${location.search}` },
    })
    return false
  }

  const onTrial = async () => {
    if (!requireAccount()) return
    setBusy('trial')
    const result = await startTrial()
    setBusy(null)
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Your 14-day free trial has started')
    const f = first ? PREMIUM_FEATURES.find((x) => x.id === first) : null
    navigate(f ? f.path : '/premium', { replace: true })
  }

  const onPay = async () => {
    if (!requireAccount()) return
    setBusy('pay')
    const result = await payForPremium()
    // On success the browser is leaving for the payment page.
    if (result && !result.ok) {
      setBusy(null)
      toast.error(result.error)
    }
  }

  const payLabel = price ? `Unlock Premium for ${price}` : 'Unlock Premium'

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4 md:mx-auto lg:max-w-[880px]">
      <SubHeader title="" close />
      <section aria-labelledby="paywall-title" className="flex flex-col gap-5 rounded-hero bg-card px-5 py-6 md:px-7 md:py-8">
        <div className="flex flex-col gap-2">
          <PremiumBadge className="self-start" />
          <h1 id="paywall-title" className="text-[28px] leading-tight font-bold tracking-[-0.01em]">
            Auto Budget Premium
          </h1>
          <p className="text-[15px] leading-normal text-muted-foreground">Clear your debts faster and see where your money goes.</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_minmax(0,340px)] lg:items-start lg:gap-8">
          <BenefitList first={first} />

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 rounded-[14px] border-2 border-primary bg-background p-4">
              <span className="text-[13px] font-semibold text-muted-foreground">One-time payment</span>
              <span className="money text-[36px] leading-none font-bold">{price ?? '…'}</span>
              <span className="text-sm leading-snug">Pay once, keep it for good. No monthly fees.</span>
            </div>
            <p className="text-center text-[13px] text-muted-foreground">Pay with GCash, Maya, card or QR Ph.</p>

            {ent.trialAvailable ? (
              <div className="flex flex-col gap-2">
                <Button className={primaryButton} disabled={busy !== null} onClick={onTrial}>
                  {busy === 'trial' && <Loader2 className="animate-spin" aria-hidden="true" />}
                  Start 14-day free trial
                </Button>
                <p className="text-center text-[13px] text-muted-foreground">No payment needed</p>
                <Button variant="ghost" className="h-11 text-[15px] font-semibold text-link" disabled={busy !== null} onClick={onPay}>
                  {busy === 'pay' && <Loader2 className="animate-spin" aria-hidden="true" />}
                  {price ? `Skip trial and pay ${price}` : 'Skip trial and pay'}
                </Button>
              </div>
            ) : (
              <Button className={primaryButton} disabled={busy !== null} onClick={onPay}>
                {busy === 'pay' && <Loader2 className="animate-spin" aria-hidden="true" />}
                {payLabel}
              </Button>
            )}

            {ent.trialEndedAt && (
              <p className="text-center text-[13px] text-muted-foreground">Your free trial ended on {formatLongDate(ent.trialEndedAt.slice(0, 10))}.</p>
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
  const price = usePrice()
  const [busy, setBusy] = useState(false)
  const trial = !ent.isLifetime

  const onPay = async () => {
    setBusy(true)
    const result = await payForPremium()
    if (result && !result.ok) {
      setBusy(false)
      toast.error(result.error)
    }
  }

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4 md:mx-auto">
      <SubHeader title="Auto Budget Premium" />
      <section aria-label="Your Premium" className="flex flex-col gap-3 rounded-hero bg-primary p-5 text-primary-foreground">
        {trial ? (
          <>
            <span className="self-start rounded-xl bg-hero-chip px-2.5 py-[3px] text-[11px] font-bold text-success-text">Free trial</span>
            <p className="text-2xl leading-tight font-bold">
              {ent.daysLeft} day{ent.daysLeft === 1 ? '' : 's'} left
            </p>
            {ent.expiresAt && <p className="text-sm text-hero-muted">Ends {formatLongDate(localDate(ent.expiresAt))}</p>}
            <Button
              className="mt-1 h-12 rounded-[14px] bg-ink text-base text-ink-foreground hover:bg-ink/90"
              disabled={busy}
              onClick={onPay}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {price ? `Unlock Premium for ${price}` : 'Unlock Premium'}
            </Button>
            <p className="text-center text-[13px] text-hero-muted">Pay once, keep it for good</p>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 self-start rounded-xl bg-hero-chip px-2.5 py-[3px] text-[11px] font-bold text-success-text">
              <BadgeCheck className="size-3.5" aria-hidden="true" />
              Premium unlocked
            </span>
            <p className="text-2xl leading-tight font-bold">Yours for good</p>
            <p className="text-sm text-hero-muted">One-time payment · nothing to renew</p>
          </>
        )}
      </section>

      <section aria-label="Premium features" className="rounded-card bg-card px-4 py-2 md:px-5">
        <BenefitList links />
      </section>

      <Receipts />
      <PolicyLinks />
    </div>
  )
}

function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Receipts() {
  const ent = useEntitlement()
  return (
    <section aria-labelledby="receipts-title" className="flex flex-col gap-2 rounded-card bg-card px-4 py-[18px] md:px-5">
      <h2 id="receipts-title" className="font-sans text-base font-bold">
        Receipts
      </h2>
      {ent.receipts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payments yet.</p>
      ) : (
        <ul className="flex flex-col">
          {ent.receipts.map((r, i) => (
            <li key={r.id} className={cn('flex min-h-[56px] items-center justify-between gap-3 py-2', i > 0 && 'border-t border-border')}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold">{r.item}</span>
                <span className="text-[13px] text-muted-foreground">
                  {formatLongDate(localDate(r.date))}
                  {r.method ? ` · ${r.method}` : ''}
                </span>
              </span>
              <span className="flex flex-none flex-col items-end gap-0.5">
                <span className="money text-base font-semibold">{formatPrice(r.amount)}</span>
                <span className={cn('text-xs font-semibold', r.status === 'refunded' ? 'text-warning-text' : 'text-success-text')}>
                  {r.status === 'refunded' ? 'Refunded' : 'Paid'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const POLL_MS = 2_000
const POLL_LIMIT_MS = 60_000

/** /premium/success: wait for the payment webhook to unlock Premium. */
export function PremiumSuccessScreen() {
  const ent = useEntitlement()
  const [timedOut, setTimedOut] = useState(false)
  const done = ent.isLifetime

  useEffect(() => {
    if (done) return
    const started = Date.now()
    void refreshPremium()
    const id = window.setInterval(() => {
      if (Date.now() - started >= POLL_LIMIT_MS) {
        window.clearInterval(id)
        setTimedOut(true)
        return
      }
      void refreshPremium()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [done])

  if (!premiumEnabled) return <Navigate to="/" replace />

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4 md:mx-auto">
      <SubHeader title="" to="/" close />
      <section aria-live="polite" className="flex flex-col items-center gap-4 rounded-hero bg-card px-5 py-8 text-center">
        {done ? (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-success-tint text-success-text">
              <BadgeCheck className="size-8" aria-hidden="true" />
            </span>
            <h1 className="text-2xl font-bold">Premium unlocked</h1>
            <p className="text-[15px] leading-normal text-muted-foreground">Thank you. It's yours for good, with nothing to renew. A receipt is on its way to your email.</p>
            <div className="flex w-full flex-col gap-2 pt-2">
              {PREMIUM_FEATURES.map((f) => (
                <Link
                  key={f.id}
                  to={f.path}
                  className="flex min-h-12 items-center justify-between rounded-lg bg-background px-4 text-[15px] font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {f.name}
                  <ChevronRight className="size-5" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </>
        ) : timedOut ? (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-warning-tint text-warning-text">
              <Lock className="size-7" aria-hidden="true" />
            </span>
            <h1 className="text-2xl font-bold">Still confirming your payment</h1>
            <p className="text-[15px] leading-normal text-muted-foreground">
              This can take a few minutes. Premium will unlock automatically once the payment is confirmed; you don't need to pay again.
            </p>
            {SUPPORT_EMAIL && (
              <p className="text-[15px]">
                Questions? Email{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-link underline underline-offset-2">
                  {SUPPORT_EMAIL}
                </a>
              </p>
            )}
            <Link to="/" className="flex h-12 items-center justify-center self-stretch rounded-[14px] bg-primary text-base font-semibold text-primary-foreground">
              Back to Home
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="size-10 animate-spin text-link" aria-hidden="true" />
            <h1 className="text-2xl font-bold">Confirming your payment…</h1>
            <p className="text-[15px] text-muted-foreground">This usually takes a few seconds.</p>
          </>
        )}
      </section>
    </div>
  )
}
