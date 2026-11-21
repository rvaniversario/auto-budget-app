import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import {
  addMonths,
  centavosToInput,
  describeMonths,
  formatMoney,
  monthsBetween,
  orderDebts,
  parseMoney,
  requiredMonthlyAmount,
  type DebtStrategy,
  type ExtraDebtPayment,
} from '@/core'
import { repo } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { formatYearMonth, useDebtPlan } from '@/lib/debtPlan'
import { cn } from '@/lib/utils'
import { LineChart } from '@/components/charts'
import { MoneyInput, Segmented, TextInput } from '@/components/inputs'
import { SubHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { PremiumGate } from '@/premium/components'

const card = 'flex min-w-0 flex-col gap-3 rounded-card bg-card px-4 py-[18px] md:px-5'
const h2 = 'font-sans text-base font-bold'
const money0 = (v: number) => formatMoney(v)

export function DebtPlannerScreen() {
  return (
    <PremiumGate feature="debtPlanner">
      <DebtPlanner />
    </PremiumGate>
  )
}

function DebtPlanner() {
  const { snapshot, model } = useAppData()
  const p = useDebtPlan(snapshot, model)
  const save = (patch: Parameters<typeof repo.saveDebtPlan>[0]) => repo.saveDebtPlan(patch)

  if (p.debts.length === 0) {
    return (
      <>
        <SubHeader title="Debt planner" />
        <section className="flex flex-col items-center gap-3 rounded-card border border-dashed border-dash-line px-5 py-8 text-center">
          <h2 className="font-sans text-[15px] font-bold">Nothing to plan yet</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Add a credit card or a loan with a balance on the Accounts tab, and the planner will work out when you can be debt-free.
          </p>
          <Link to="/accounts" className="flex h-12 items-center rounded-[14px] bg-primary px-5 text-[13px] font-semibold text-primary-foreground">
            Go to Accounts
          </Link>
        </section>
      </>
    )
  }

  const debtFree = p.result.neverPaysOff ? null : addMonths(p.startMonth, Math.max(0, p.result.months - 1))

  return (
    <>
      <SubHeader title="Debt planner" />
      <div className="grid gap-4 md:gap-5 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          <section aria-label="Your debt-free date" className="flex flex-col gap-3 hero-card rounded-hero p-5">
            <p className="text-sm font-medium text-hero-muted">{debtFree ? 'Debt-free by' : 'At this amount'}</p>
            <p className="text-[30px] leading-tight font-bold tracking-[-0.01em]">
              {debtFree ? formatYearMonth(debtFree) : "Your debts won't be paid off"}
            </p>
            <p className="text-sm leading-[1.45] text-hero-muted">
              {debtFree
                ? `Paying ${money0(p.monthlyAmount)} a month for ${describeMonths(p.result.months)}, with about ${money0(p.result.totalInterest)} in interest.`
                : 'The payments do not keep up with the interest. Raise the monthly amount to see a payoff date.'}
            </p>
            {!p.result.neverPaysOff && (
              <div className="grid grid-cols-2 gap-2 border-t border-hero-divider pt-3.5">
                <Stat
                  label="Months saved vs minimums"
                  value={p.comparison.minimumsNeverPayOff ? 'Minimums never clear it' : String(p.comparison.monthsSaved)}
                />
                <Stat label="Interest saved" value={p.comparison.minimumsNeverPayOff ? '—' : money0(p.comparison.interestSaved)} />
              </div>
            )}
          </section>

          <MonthlyAmount p={p} onSave={save} />
          <Strategy p={p} onSave={save} />
          <Extras p={p} onSave={save} />
          <Goal p={p} onSave={save} />

          <section className={cn(card, 'gap-2')}>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="plan-home" className="flex flex-col items-start gap-0.5">
                <span className="text-[13px] font-semibold">Show this plan on Home</span>
                <span className="text-[12px] font-normal text-muted-foreground">This month's payment for each debt, instead of the single card payment</span>
              </Label>
              <Switch id="plan-home" checked={p.plan.inUse} onCheckedChange={(v) => void save({ inUse: v })} />
            </div>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          <PerDebt p={p} />
          <BalanceChart p={p} />
          <Schedule p={p} />
        </div>
      </div>
      <p className="max-w-prose text-xs leading-normal text-muted-foreground">
        Estimates from your own entries, assuming no new card spending and the interest rates you entered. Not financial advice.
      </p>
    </>
  )
}

type Plan = ReturnType<typeof useDebtPlan>
type Save = (patch: Parameters<typeof repo.saveDebtPlan>[0]) => Promise<unknown>

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-hero-muted">{label}</span>
      <span className="money text-[13px] font-semibold">{value}</span>
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warning-tint px-3 py-2 text-sm text-warning-text">
      <TriangleAlert className="mt-0.5 size-4 flex-none" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

// ---------------------------------------------------------------------------

function MonthlyAmount({ p, onSave }: { p: Plan; onSave: Save }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = parseMoney(text)
    if (v === null || v <= 0) return setError('Enter an amount')
    if (v < p.minimums) return setError(`It must cover your minimum payments of ${formatMoney(p.minimums)}`)
    await onSave({ monthlyAmount: v })
    setEditing(false)
  }

  return (
    <section aria-labelledby="amount-title" className={card}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="amount-title" className={h2}>
            Monthly amount for debts
          </h2>
          <p className="text-[12px] text-muted-foreground">
            {p.usingSafeAmount ? 'Your safe credit card payment this month' : `Your safe card payment is ${formatMoney(p.safeAmount)}`}
          </p>
        </div>
        <span className="money flex-none text-xl font-bold">{formatMoney(p.monthlyAmount)}</span>
      </div>
      {p.safeBelowMinimums && p.usingSafeAmount && (
        <Warning>
          Your safe amount of {formatMoney(p.safeAmount)} doesn't cover the minimum payments of {formatMoney(p.minimums)}. The plan uses the minimums.
        </Warning>
      )}
      {editing ? (
        <form noValidate onSubmit={submit} className="flex flex-col gap-2">
          <Label htmlFor="debt-amount" className="text-[12px] font-semibold text-muted-foreground">
            Amount each month (₱)
          </Label>
          <MoneyInput
            id="debt-amount"
            autoFocus
            value={text}
            aria-invalid={!!error}
            aria-describedby={error ? 'debt-amount-error' : undefined}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
          />
          {error && (
            <p id="debt-amount-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <p className="text-[12px] text-muted-foreground">At least {formatMoney(p.minimums)}, the total of your minimum payments.</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Save
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setText(centavosToInput(p.monthlyAmount))
              setEditing(true)
            }}
          >
            Change amount
          </Button>
          {!p.usingSafeAmount && (
            <Button variant="ghost" className="text-link" onClick={() => void onSave({ monthlyAmount: null })}>
              Use my safe amount
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

const STRATEGY_HELP: Record<DebtStrategy, string> = {
  highestInterest: 'Saves the most interest.',
  smallestBalance: 'Clears debts one by one sooner, for quick wins.',
  custom: 'Drag the debts, or use the arrows, to set the order.',
}

function Strategy({ p, onSave }: { p: Plan; onSave: Save }) {
  const order = useMemo(() => orderDebts(p.debts, 'custom', p.plan.customOrder.length ? p.plan.customOrder : orderDebts(p.debts, 'highestInterest').map((d) => d.id)), [p.debts, p.plan.customOrder])
  const [dragging, setDragging] = useState<string | null>(null)

  const setStrategy = (strategy: DebtStrategy) => {
    // Start a custom order from the order the user is looking at.
    if (strategy === 'custom' && p.plan.customOrder.length === 0) {
      void onSave({ strategy, customOrder: orderDebts(p.debts, p.plan.strategy).map((d) => d.id) })
    } else void onSave({ strategy })
  }
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return
    const ids = order.map((d) => d.id)
    const [id] = ids.splice(from, 1)
    ids.splice(to, 0, id)
    void onSave({ customOrder: ids })
  }

  return (
    <section aria-labelledby="strategy-title" className={card}>
      <h2 id="strategy-title" className={h2}>
        Which debt gets the extra money first?
      </h2>
      <Segmented
        label="Strategy"
        value={p.plan.strategy}
        onChange={setStrategy}
        options={[
          { value: 'highestInterest', label: 'Highest interest' },
          { value: 'smallestBalance', label: 'Smallest balance' },
          { value: 'custom', label: 'My order' },
        ]}
      />
      <p className="text-[12px] text-muted-foreground">
        Every debt gets its minimum; the rest goes to the first one, and when it's cleared its payment rolls to the next. {STRATEGY_HELP[p.plan.strategy]}
      </p>
      {p.plan.strategy === 'custom' && (
        <ol className="flex flex-col gap-1.5" aria-label="Your order">
          {order.map((d, i) => (
            <li
              key={d.id}
              draggable
              onDragStart={() => setDragging(d.id)}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragging) move(order.findIndex((x) => x.id === dragging), i)
                setDragging(null)
              }}
              className={cn('flex min-h-12 items-center gap-2 rounded-lg bg-background px-2', dragging === d.id && 'opacity-50')}
            >
              <GripVertical className="size-5 flex-none cursor-grab text-muted-foreground" aria-hidden="true" />
              <span className="w-5 text-sm font-bold text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{d.name}</span>
              <Button variant="ghost" size="icon" aria-label={`Move ${d.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Move ${d.name} down`} disabled={i === order.length - 1} onClick={() => move(i, i + 1)}>
                <ArrowDown aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

function Extras({ p, onSave }: { p: Plan; onSave: Save }) {
  const [month, setMonth] = useState(() => addMonths(p.startMonth, Math.max(0, 12 - Number(p.startMonth.slice(5, 7))))) // December
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const upcoming = [...p.plan.extras].sort((a, b) => a.month.localeCompare(b.month))

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = parseMoney(amount)
    if (v === null || v <= 0) return setError('Enter an amount')
    if (!/^\d{4}-\d{2}$/.test(month) || monthsBetween(p.startMonth, month) < 0) return setError('Pick this month or a later one')
    const extra: ExtraDebtPayment = { id: crypto.randomUUID(), month, amount: v }
    await onSave({ extras: [...p.plan.extras, extra] })
    setAmount('')
    setError(null)
    toast.success(`Added ${formatMoney(v)} in ${formatYearMonth(month)}`)
  }

  return (
    <section aria-labelledby="extras-title" className={card}>
      <div className="flex flex-col gap-0.5">
        <h2 id="extras-title" className={h2}>
          One-off extra payments
        </h2>
        <p className="text-[12px] text-muted-foreground">For example, your 13th-month pay in December.</p>
      </div>
      {upcoming.length > 0 && (
        <ul className="flex flex-col">
          {upcoming.map((e, i) => (
            <li key={e.id} className={cn('flex min-h-12 items-center justify-between gap-3', i > 0 && 'border-t border-border')}>
              <span className="text-[13px]">
                <span className="font-semibold">{formatYearMonth(e.month)}</span>
                {monthsBetween(p.startMonth, e.month) < 0 && <span className="text-muted-foreground"> (past)</span>}
              </span>
              <span className="flex items-center gap-1">
                <span className="money font-semibold">{formatMoney(e.amount)}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${formatMoney(e.amount)} in ${formatYearMonth(e.month)}`}
                  onClick={() => void onSave({ extras: p.plan.extras.filter((x) => x.id !== e.id) })}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form noValidate onSubmit={add} className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="extra-month" className="text-[12px] font-semibold text-muted-foreground">
            Month
          </Label>
          <TextInput id="extra-month" type="month" min={p.startMonth} value={month} onChange={(e) => setMonth(e.target.value)} className="h-[46px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="extra-amount" className="text-[12px] font-semibold text-muted-foreground">
            Amount (₱)
          </Label>
          <MoneyInput
            id="extra-amount"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setError(null)
            }}
            className="h-[46px]"
            aria-invalid={!!error}
          />
        </div>
        {error && (
          <p role="alert" className="col-span-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" variant="outline" className="col-span-2">
          <Plus aria-hidden="true" /> Add extra payment
        </Button>
      </form>
    </section>
  )
}

// ---------------------------------------------------------------------------

function Goal({ p, onSave }: { p: Plan; onSave: Save }) {
  const goal = p.plan.goalMonth
  const target = goal ? monthsBetween(p.startMonth, goal) + 1 : null
  const required = useMemo(
    () => (target !== null && target >= 1 ? requiredMonthlyAmount(p.debts, target, p.plan.strategy, p.extras, p.plan.customOrder) : null),
    [p.debts, target, p.plan.strategy, p.extras, p.plan.customOrder],
  )
  const cut = required !== null ? Math.max(0, required - p.safeAmount) : 0

  return (
    <section aria-labelledby="goal-title" className={card}>
      <div className="flex flex-col gap-0.5">
        <h2 id="goal-title" className={h2}>
          Pick a debt-free date
        </h2>
        <p className="text-[12px] text-muted-foreground">See what you'd need to pay each month to get there.</p>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="goal-month" className="text-[12px] font-semibold text-muted-foreground">
            Debt-free by
          </Label>
          <TextInput
            id="goal-month"
            type="month"
            min={p.startMonth}
            value={goal ?? ''}
            onChange={(e) => void onSave({ goalMonth: e.target.value || null })}
            className="h-[46px]"
          />
        </div>
        {goal && (
          <Button variant="ghost" className="h-[46px]" onClick={() => void onSave({ goalMonth: null })}>
            Clear
          </Button>
        )}
      </div>
      {goal && target !== null && target < 1 && <p className="text-sm text-destructive">Pick this month or a later one.</p>}
      {required !== null && (
        <div aria-live="polite" className="flex flex-col gap-2 rounded-lg bg-success-tint p-3.5">
          <span className="money text-xl font-bold text-success-text">Pay {formatMoney(required)} a month</span>
          <span className="text-sm leading-[1.45]">
            {cut > 0
              ? `That's ${formatMoney(cut)} more than your safe amount of ${formatMoney(p.safeAmount)}. You'd need to cut about ${formatMoney(cut)} a month from optional spending.`
              : `Your safe amount of ${formatMoney(p.safeAmount)} already covers it.`}
          </span>
          {required !== p.monthlyAmount && (
            <Button variant="outline" className="self-start bg-card" onClick={() => void onSave({ monthlyAmount: required })}>
              Use {formatMoney(required)} a month
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

function PerDebt({ p }: { p: Plan }) {
  const ordered = orderDebts(p.debts, p.plan.strategy, p.plan.customOrder)
  return (
    <section aria-labelledby="per-debt-title" className={card}>
      <h2 id="per-debt-title" className={h2}>
        When each debt is paid off
      </h2>
      <ul className="flex flex-col">
        {ordered.map((d, i) => {
          const r = p.result.perDebt[d.id]
          const month = r?.payoffMonth != null ? addMonths(p.startMonth, r.payoffMonth) : null
          return (
            <li key={d.id} className={cn('flex min-h-[60px] items-center justify-between gap-3 py-2', i > 0 && 'border-t border-border')}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] font-semibold">
                  {i + 1}. {d.name}
                </span>
                <span className="text-[12px] text-muted-foreground">
                  {formatMoney(d.balance)} owed · {d.monthlyRate}% a month · min {formatMoney(d.minimumPayment)}
                </span>
              </span>
              <span className="flex flex-none flex-col items-end gap-0.5">
                <span className="text-[13px] font-semibold">{month ? formatYearMonth(month) : 'Not paid off'}</span>
                <span className="money text-[12px] text-warning-text">{money0(r?.interest ?? 0)} interest</span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function BalanceChart({ p }: { p: Plan }) {
  const months = Math.min(p.result.schedule.length, 120)
  if (months < 2) return null
  const labels = Array.from({ length: months }, (_, i) => formatYearMonth(addMonths(p.startMonth, i)))
  const minimums = Array.from({ length: months }, (_, i) => p.minimumsOnly.schedule[i]?.totalBalance ?? p.minimumsOnly.schedule.at(-1)?.totalBalance ?? 0)
  const plan = p.result.schedule.slice(0, months).map((m) => m.totalBalance)
  const end = p.result.neverPaysOff ? 'is not cleared' : `reaches zero in ${labels.at(-1)}`
  return (
    <section aria-labelledby="chart-title" className={card}>
      <h2 id="chart-title" className={h2}>
        What you owe over time
      </h2>
      <LineChart
        title="Total owed on cards and loans"
        summary={`With this plan the total ${end}. Paying only the minimums is shown as a dashed line for comparison.`}
        labels={labels}
        series={[
          { name: 'This plan', values: plan },
          { name: 'Minimums only', values: minimums, color: 'var(--muted-foreground)', dashed: true },
        ]}
      />
    </section>
  )
}

function Schedule({ p }: { p: Plan }) {
  const [all, setAll] = useState(false)
  const ordered = orderDebts(p.debts, p.plan.strategy, p.plan.customOrder)
  const rows = all ? p.result.schedule : p.result.schedule.slice(0, 12)
  const th = 'border-b border-border px-2 py-2 text-xs font-semibold text-muted-foreground'
  const td = 'border-b border-border px-2 py-2'
  return (
    <section aria-labelledby="schedule-title" className={card}>
      <h2 id="schedule-title" className={h2}>
        Month by month
      </h2>
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={cn(th, 'text-left')}>
                Month
              </th>
              {ordered.map((d) => (
                <th key={d.id} scope="col" className={cn(th, 'text-right whitespace-nowrap')}>
                  {d.name}
                </th>
              ))}
              <th scope="col" className={cn(th, 'text-right whitespace-nowrap')}>
                Still owed
              </th>
            </tr>
          </thead>
          <tbody className="money">
            {rows.map((m) => (
              <tr key={m.index}>
                <th scope="row" className={cn(td, 'text-left font-sans font-medium whitespace-nowrap')}>
                  {formatYearMonth(addMonths(p.startMonth, m.index))}
                </th>
                {ordered.map((d) => (
                  <td key={d.id} className={cn(td, 'text-right')}>
                    {m.payments[d.id] ? money0(m.payments[d.id]) : '—'}
                  </td>
                ))}
                <td className={cn(td, 'text-right font-semibold')}>{money0(m.totalBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.result.schedule.length > 12 && (
        <Button variant="ghost" className="self-start text-link" onClick={() => setAll((v) => !v)}>
          {all ? 'Show the first year only' : `Show all ${p.result.schedule.length} months`}
        </Button>
      )}
    </section>
  )
}
