import { useMemo, useState, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Link, Navigate } from 'react-router'
import { toast } from 'sonner'
import {
  BUFFER_KEY,
  describeMonths,
  distributeCut,
  expensesInPeriod,
  formatMoney,
  formatShortDate,
  pesos,
  whatIf,
  type ShortfallOption,
  INCOME_LABEL,
} from '@/core'
import { repo } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { SubHeader, Tag } from '@/components/layout'
import { PayoffSchedule } from '@/components/PayoffSchedule'
import { PremiumEntry } from '@/premium/components'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

function Line({ label, sub, amount, minus = true, tag }: { label: ReactNode; sub?: string; amount: number; minus?: boolean; tag?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="flex min-w-0 flex-col gap-0.5 text-[13px]">
        <span className="flex items-center gap-2">
          {label}
          {tag}
        </span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span className="money flex-none text-base font-semibold">
        {minus && amount !== 0 ? '− ' : ''}
        {formatMoney(amount)}
      </span>
    </div>
  )
}

function listNames(names: string[]): string {
  const lower = names.map((n, i) => (i === 0 ? n : n.toLowerCase()))
  if (lower.length <= 1) return lower.join('')
  return `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`
}

/** Only reachable while Safe to pay is switched on (Settings); otherwise back to Home. */
export function BreakdownScreen() {
  const { model } = useAppData()
  if (!model.safeEnabled) return <Navigate to="/" replace />
  return <Breakdown />
}

function Breakdown() {
  const { model, snapshot } = useAppData()
  const { safe, cards } = model
  const [cutPesos, setCutPesos] = useState(0)

  const dueDate = cards
    .map((c) => c.nextDueDate)
    .filter((d): d is string => !!d)
    .sort()[0]
  const rate = model.cardRate
  const rateText = `${Number(rate.toFixed(2))}%`

  const essentialNames = model.categoryRows.filter((r) => r.kind === 'essential').map((r) => r.name)
  const optionalNames = model.categoryRows.filter((r) => r.kind === 'optional').map((r) => r.name)
  const bills = snapshot.fixedBills.filter((b) => !b.deletedAt)
  const oneTimes = expensesInPeriod(snapshot.transactions, model.period).filter((t) => t.isOneTime)
  const categoryName = new Map(snapshot.categories.map((c) => [c.id, c.name]))

  const scenario = useMemo(() => whatIf(model.safeInput, pesos(cutPesos), rate), [model.safeInput, cutPesos, rate])

  if (cards.length === 0) {
    return (
      <>
        <SubHeader title="Credit card payment" />
        <p className="text-[13px] text-muted-foreground">
          You haven't added a credit card. <Link to="/accounts" className="font-semibold text-link underline">Add one on the Accounts tab</Link> to get a safe payment amount.
        </p>
      </>
    )
  }

  const applyOption = async (o: ShortfallOption) => {
    const entries: { key: string; amount: number }[] = []
    if (o.bufferCut > 0) entries.push({ key: BUFFER_KEY, amount: model.buffer - o.bufferCut })
    if (o.optionalCut > 0) {
      const optional = model.categoryRows.filter((r) => r.kind === 'optional')
      const cuts = distributeCut(
        optional.map((r) => ({ key: r.categoryId, room: Math.max(0, r.budget - r.spent) })),
        o.optionalCut,
      )
      for (const r of optional) {
        const cut = cuts.get(r.categoryId) ?? 0
        if (cut > 0) entries.push({ key: r.categoryId, amount: r.budget - cut })
      }
    }
    await repo.setBudgetOverrides(model.period.start, entries)
    toast.success('Plan updated', { description: o.remaining > 0 ? `Still ${formatMoney(o.remaining)} short of the minimum.` : 'You can now pay the minimum due.' })
  }

  const payoff = model.ifYouPay.payoff

  return (
    <>
      <SubHeader title="Credit card payment" />

      <div className="grid gap-4 md:gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-4 md:gap-5">
      {safe.belowMinimum ? (
        <section aria-label="Payment warning" className="flex flex-col gap-2.5 rounded-hero bg-danger-tint p-5 text-danger-text">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-[22px]" aria-hidden="true" />
            <p className="text-sm font-bold">Below your minimum due</p>
          </div>
          <p className="text-sm font-medium text-foreground">Your budget can cover only</p>
          <p className="money text-5xl leading-none font-bold tracking-[-0.02em] md:text-[46px]">{formatMoney(safe.amount)}</p>
          <p className="text-sm leading-[1.45] text-foreground">
            Minimum due is <strong>{formatMoney(safe.effectiveMinimum)}</strong>
            {dueDate ? ` by ${formatShortDate(dueDate)}` : ''}. You are short by <strong>{formatMoney(safe.shortfall)}</strong>. Paying less than the minimum usually adds a late fee on top of interest.
          </p>
        </section>
      ) : (
        <section aria-label="Recommended payment" className="flex flex-col gap-2 hero-card rounded-hero p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-hero-muted">Safe to pay on your credit card this month</p>
            {safe.isEstimate && (
              <span className="flex-none rounded-xl bg-hero-chip px-2.5 py-[3px] text-[10px] font-bold text-hero-link">Estimate</span>
            )}
          </div>
          <p className="money text-5xl leading-none font-bold tracking-[-0.02em] md:text-[46px]">{formatMoney(safe.amount)}</p>
          <p className="text-sm leading-[1.45] text-hero-muted">
            of your {formatMoney(safe.cardBalance)} bill{dueDate ? ` · due ${formatShortDate(dueDate)}` : ''} · minimum due {formatMoney(safe.minimumDue)}
          </p>
        </section>
      )}

      <section aria-label="How we got this amount" className="flex flex-col gap-3 rounded-card bg-card px-4 py-[18px] md:px-5">
        <h2 className="font-sans text-base font-bold">How we got this amount</h2>
        <Line
          label={INCOME_LABEL.long}
          sub="Income you have logged since payday"
          amount={model.income}
          minus={false}
        />
        {model.carryOver !== 0 && (
          <Line
            label="Carried over"
            sub={model.carryOver > 0 ? 'Left from earlier months' : 'Overspent in earlier months'}
            amount={model.carryOver}
            minus={false}
          />
        )}
        <Line label="Fixed bills" sub={bills.length ? listNames(bills.map((b) => b.name)) : 'None added'} amount={safe.fixedBillsTotal} />
        {oneTimes.map((t) => (
          <Line
            key={t.id}
            label={t.note || (t.categoryId ? categoryName.get(t.categoryId) : 'Expense')}
            tag={<Tag tone="warning">One-time</Tag>}
            amount={t.amount}
          />
        ))}
        <Line
          label="Essential spending"
          sub={
            safe.isEstimate
              ? 'No spending logged last month yet'
              : `Based on last month's ${listNames(essentialNames).toLowerCase()}`
          }
          amount={safe.essentialTotal}
        />
        <Line label="Optional spending" sub={listNames(optionalNames)} amount={safe.optionalTotal} />
        <Line label="Buffer" sub="For surprises" amount={safe.buffer} />
        {safe.unclamped > safe.cardBalance && (
          <>
            <Line label="Available for your card" amount={safe.unclamped} minus={false} />
            <p className="text-[12px] leading-[1.45] text-muted-foreground">
              Your bill is only {formatMoney(safe.cardBalance)}, so you can pay it in full. The other{' '}
              {formatMoney(safe.unclamped - safe.cardBalance)} stays unassigned.
            </p>
          </>
        )}
        {safe.unclamped < 0 && (
          <p className="text-[12px] leading-[1.45] text-danger-text">
            Your plan needs {formatMoney(-safe.unclamped)} more than your income, so nothing is left for the card.
          </p>
        )}
        <div className="flex items-baseline justify-between border-t-2 border-foreground pt-3">
          <span className="text-[13px] font-bold">{safe.belowMinimum ? 'Left for the card' : 'Safe card payment'}</span>
          <span className={cn('money text-xl font-bold', safe.belowMinimum ? 'text-danger-bar' : 'text-link')}>{formatMoney(safe.amount)}</span>
        </div>
      </section>

      {safe.belowMinimum && model.shortfallOptions.length > 0 && (
        <section aria-label="Ways to reach the minimum" className="flex flex-col gap-1 rounded-card bg-card px-4 py-[18px] md:px-5">
          <h2 className="mb-1.5 font-sans text-base font-bold">Ways to reach {formatMoney(safe.effectiveMinimum)}</h2>
          {model.shortfallOptions.map((o, i) => (
            <div key={o.id} className={cn('flex min-h-16 items-center justify-between gap-3 py-2', i > 0 && 'border-t border-border')}>
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-semibold">{o.title}</span>
                <span className="text-[12px] text-muted-foreground">{o.effect}</span>
              </div>
              <button
                type="button"
                onClick={() => applyOption(o)}
                aria-label={`Apply: ${o.title}`}
                className="h-11 flex-none rounded-lg border border-primary bg-card px-4 text-sm font-semibold text-link hover:bg-success-tint"
              >
                Apply
              </button>
            </div>
          ))}
        </section>
      )}

      {cards.length > 1 && (
        <section aria-label="Split across cards" className="flex flex-col gap-3 rounded-card bg-card px-4 py-[18px] md:px-5">
          <h2 className="font-sans text-base font-bold">How to split it</h2>
          <p className="text-[12px] text-muted-foreground">Minimums first, then the card with the highest interest.</p>
          {cards.map((c) => (
            <div key={c.account.id} className="flex items-baseline justify-between gap-3">
              <span className="flex flex-col gap-0.5 text-[13px]">
                {c.account.name}
                <span className="text-xs text-muted-foreground">
                  {formatMoney(c.planBalance)} owed · {c.monthlyInterestRate}% a month
                </span>
              </span>
              <span className={cn('money text-base font-semibold', c.allocation.belowMinimum && 'text-danger-bar')}>
                {formatMoney(c.allocation.amount)}
              </span>
            </div>
          ))}
        </section>
      )}

      <p className="hidden max-w-prose text-xs leading-normal text-muted-foreground lg:block">
        These are estimates from your own entries{rate ? `, using a ${rateText} monthly rate` : ''}, not financial advice. Paying your bill in full avoids interest.
        {safe.belowMinimum && ' If you cannot reach the minimum, contact your bank before the due date.'}
      </p>
      </div>

      <div className="flex min-w-0 flex-col gap-4 md:gap-5">
      {safe.paysInFull && (
        <section aria-label="What paying this amount means" className="flex flex-col gap-2 rounded-card bg-card px-4 py-[18px] md:px-5">
          <h2 className="font-sans text-base font-bold">If you pay {formatMoney(safe.amount)}</h2>
          <p className="text-sm leading-normal">That clears your whole bill, so you pay no interest next month.</p>
        </section>
      )}
      {!safe.paysInFull && safe.cardBalance > 0 && (
        <section aria-label="What paying this amount means" className="flex flex-col gap-3 rounded-card bg-card px-4 py-[18px] md:px-5">
          <h2 className="font-sans text-base font-bold">If you pay {formatMoney(safe.amount)}</h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 rounded-lg bg-background p-3">
              <span className="text-xs text-muted-foreground">Left unpaid</span>
              <span className="money text-lg font-semibold">{formatMoney(model.ifYouPay.unpaidBalance)}</span>
            </div>
            <div className="flex flex-col gap-1 rounded-lg bg-warning-tint p-3 text-warning-text">
              <span className="text-xs">Interest next month</span>
              <span className="money text-lg font-semibold">about {formatMoney(model.ifYouPay.nextMonthInterest)}</span>
            </div>
          </div>
          <p className="text-sm leading-normal">
            {payoff.neverPaysOff ? (
              <>
                At {formatMoney(safe.amount)} a month, interest takes up most of your payment, so the balance{' '}
                <strong>won't go down</strong>. Paying more, even a little, makes a difference.
              </>
            ) : (
              <>
                At {formatMoney(safe.amount)} a month you clear the card in about <strong>{describeMonths(payoff.months)}</strong>, paying
                around <strong>{formatMoney(payoff.totalInterest)}</strong> in interest, as long as you add no new card
                spending.
              </>
            )}
          </p>
          {dueDate && (
            <PayoffSchedule
              className="hidden md:block"
              balance={safe.cardBalance}
              payment={safe.amount}
              rate={rate}
              firstDueDate={dueDate}
            />
          )}
        </section>
      )}

      {safe.cardBalance > 0 && (
        <PremiumEntry feature="debtPlanner" title="Plan all your debts" description="Every card and loan in one plan, with your debt-free date" />
      )}

      {!safe.paysInFull && safe.cardBalance > 0 && (
        <section aria-label="What if" className="flex flex-col gap-3 rounded-card bg-card px-4 py-[18px] md:px-5">
          <h2 className="font-sans text-base font-bold">What if you spend less?</h2>
          <div className="flex items-baseline justify-between">
            <label id="cut-label" className="text-sm">
              Cut optional spending by
            </label>
            <span className="money text-base font-semibold">{formatMoney(pesos(cutPesos))}</span>
          </div>
          <Slider
            aria-labelledby="cut-label"
            min={0}
            max={3000}
            step={500}
            value={[cutPesos]}
            onValueChange={(v) => setCutPesos(v[0] ?? 0)}
            className="h-11"
          />
          <div aria-live="polite" className="flex flex-col gap-1 rounded-lg bg-success-tint p-3.5">
            <span className="money text-xl font-bold text-success-text">Pay {formatMoney(scenario.scenario.payment)}</span>
            <span className="text-sm leading-[1.45]">
              {scenario.scenario.payoff.neverPaysOff
                ? 'The balance still would not go down at this amount.'
                : `Cleared in about ${describeMonths(scenario.scenario.payoff.months)} · around ${formatMoney(scenario.scenario.payoff.totalInterest)} interest`}
              {' · '}
              {whatIfCompare(scenario)}
            </span>
            {scenario.cut < pesos(cutPesos) && (
              <span className="text-[12px] text-muted-foreground">Your optional budgets only total {formatMoney(scenario.cut)}.</span>
            )}
          </div>
        </section>
      )}

      </div>
      </div>

      <p className="max-w-prose text-xs leading-normal text-muted-foreground lg:hidden">
        These are estimates from your own entries{rate ? `, using a ${rateText} monthly rate` : ''}, not financial advice. Paying your bill in full avoids interest.
        {safe.belowMinimum && ' If you cannot reach the minimum, contact your bank before the due date.'}
      </p>
    </>
  )
}

function whatIfCompare(r: ReturnType<typeof whatIf>): string {
  if (r.cut === 0) return 'same as your current plan'
  if (r.monthsSaved === null) {
    return r.scenario.payoff.neverPaysOff ? `${formatMoney(r.extraPayment)} more a month` : 'now on track to clear it'
  }
  if (r.monthsSaved > 0) return `${r.monthsSaved} month${r.monthsSaved === 1 ? '' : 's'} sooner`
  if (r.interestSaved && r.interestSaved > 0) return `${formatMoney(r.interestSaved)} less interest`
  return `${formatMoney(r.extraPayment)} more a month`
}
