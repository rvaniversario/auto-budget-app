import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  BUFFER_KEY,
  defaultBudget,
  formatMoney,
  formatShortDate,
  periodMonthName,
  type PlanLine,
} from '@/core'
import { repo } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { AmountEditDialog } from '@/components/AmountEditDialog'
import { AmountButton } from '@/components/inputs'
import { SectionLabel, TabHeader } from '@/components/layout'
import { cn } from '@/lib/utils'

type Editing = { kind: 'category'; line: PlanLine } | { kind: 'buffer' } | null

function Row({
  title,
  sub,
  wideSub,
  subTone,
  lastMonth,
  children,
}: {
  title: string
  sub?: string
  /** Replaces `sub` on laptops, where last month has its own column. */
  wideSub?: string
  subTone?: 'warning'
  /** Shown as an aligned column on laptops. */
  lastMonth?: string
  children: React.ReactNode
}) {
  const tone = subTone === 'warning' ? 'text-warning-text' : 'text-muted-foreground'
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-semibold">{title}</span>
        {sub && <span className={cn('text-[13px]', tone, lastMonth !== undefined && 'lg:hidden')}>{sub}</span>}
        {lastMonth !== undefined && wideSub && <span className={cn('hidden text-[13px] lg:block', tone)}>{wideSub}</span>}
      </div>
      {lastMonth !== undefined && (
        <span className="money hidden w-24 flex-none text-right text-[15px] text-muted-foreground lg:block">{lastMonth}</span>
      )}
      {children}
    </div>
  )
}

/** Laptop column headings above category rows. */
function ColumnHeads({ last }: { last: string }) {
  return (
    <div aria-hidden="true" className="hidden justify-end gap-3 text-xs font-semibold text-muted-foreground lg:flex">
      <span className="w-24 text-right">{last}</span>
      <span className="w-24 text-center">This month</span>
    </div>
  )
}

export function BudgetScreen() {
  const { model, snapshot } = useAppData()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Editing>(null)
  const { plan } = model
  const month = periodMonthName(model.period)
  const prevMonth = periodMonthName(model.previousPeriod)
  const bills = snapshot.fixedBills.filter((b) => !b.deletedAt)
  const cardLine = plan.setAsideFirst.find((l) => l.kind === 'card_payment')
  const oneTimeLine = plan.setAsideFirst.find((l) => l.kind === 'one_time')
  const dueDate = model.cards
    .map((c) => c.nextDueDate)
    .filter((d): d is string => !!d)
    .sort()[0]

  const categoryLine = (line: PlanLine) => {
    const last = line.lastMonth ?? 0
    const trimmed = line.isOverride && line.amount < last
    const sub = line.lastMonthIsEstimate
      ? `Your estimate ${formatMoney(last)}`
      : `Last month ${formatMoney(last)}${trimmed ? ` · trimmed ${formatMoney(last - line.amount)}` : ''}`
    return (
      <Row
        key={line.key}
        title={line.label}
        sub={sub}
        wideSub={trimmed ? `Trimmed ${formatMoney(last - line.amount)}` : undefined}
        lastMonth={formatMoney(last)}
        subTone={trimmed ? 'warning' : undefined}
      >
        <AmountButton aria-label={`Edit ${line.label} budget, ${formatMoney(line.amount)}`} onClick={() => setEditing({ kind: 'category', line })}>
          {formatMoney(line.amount)}
        </AmountButton>
      </Row>
    )
  }

  const sum = (lines: PlanLine[]) => lines.reduce((a, l) => a + l.amount, 0)
  const u = plan.unassigned
  const lastHead = model.hasHistory ? 'Last month' : 'Your estimate'

  return (
    <>
      <TabHeader
        title={`${month} plan`}
        description={`${model.hasHistory ? `Built from your ${prevMonth} spending.` : 'Built from your setup estimates.'} Tap an amount to change it and the rest rebalances.`}
      />

      <div className="grid gap-4 md:gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-4 md:gap-5">
      <section
        aria-label="Allocation summary"
        className={cn('flex items-center justify-between gap-3 rounded-card p-4', u < 0 ? 'bg-danger-tint' : 'bg-success-tint')}
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px]">Salary {formatMoney(plan.salary)}</span>
          <span className={cn('money text-lg font-bold', u < 0 ? 'text-danger-text' : 'text-success-text')}>
            {u === 0 ? 'Fully allocated' : u > 0 ? `${formatMoney(u)} left to assign` : `Over by ${formatMoney(-u)}`}
          </span>
        </div>
        <span className={cn('rounded-[14px] bg-card px-3 py-1.5 text-[13px] font-bold', u < 0 ? 'text-danger-text' : 'text-success-text')}>
          {formatMoney(Math.max(0, u))} unassigned
        </span>
      </section>
      {u > 0 && model.safe.paysInFull && (
        <p className="-mt-2 text-[13px] text-muted-foreground">Your card is paid in full, so the rest is free to save or use.</p>
      )}

      <section aria-label="Set aside first" className="flex flex-col gap-1 rounded-card bg-card p-4 md:px-5">
        <SectionLabel>Set aside first</SectionLabel>
        <Row title="Fixed bills" sub={bills.length ? `${bills.length} bill${bills.length === 1 ? '' : 's'} with due dates` : 'None added'}>
          <AmountButton aria-label="Edit fixed bills" onClick={() => navigate('/settings/bills')}>
            {formatMoney(model.fixedBillsTotal)}
          </AmountButton>
        </Row>
        {cardLine && (
          <Row title="Credit card payment" sub={`Recommended${dueDate ? ` · due ${formatShortDate(dueDate)}` : ''}`}>
            <Link
              to="/breakdown"
              aria-label={`Credit card payment, ${formatMoney(cardLine.amount)}, see breakdown`}
              className={cn(
                'flex h-11 min-w-24 items-center justify-center rounded-lg px-3.5 font-heading text-base font-semibold',
                model.safe.belowMinimum ? 'bg-danger-tint text-danger-text' : 'bg-primary text-primary-foreground',
              )}
            >
              {formatMoney(cardLine.amount)}
            </Link>
          </Row>
        )}
        <Row title="Buffer" sub={model.bufferIsOverride ? `For surprises · changed this month` : 'For surprises'}>
          <AmountButton aria-label="Edit buffer" onClick={() => setEditing({ kind: 'buffer' })}>
            {formatMoney(model.buffer)}
          </AmountButton>
        </Row>
        {oneTimeLine && (
          <Row title="One-time expenses" sub="Already logged this month">
            <span className="money min-w-24 px-3.5 text-right text-base font-semibold">{formatMoney(oneTimeLine.amount)}</span>
          </Row>
        )}
      </section>

      </div>

      <div className="flex min-w-0 flex-col gap-4 md:gap-5">
      {plan.essential.length > 0 && (
        <section aria-label="Essential categories" className="flex flex-col gap-1 rounded-card bg-card p-4 md:px-5">
          <div className="flex items-end justify-between gap-3">
            <SectionLabel>Essential · {formatMoney(sum(plan.essential))}</SectionLabel>
            <ColumnHeads last={lastHead} />
          </div>
          {plan.essential.map(categoryLine)}
        </section>
      )}

      {plan.optional.length > 0 && (
        <section aria-label="Optional categories" className="flex flex-col gap-1 rounded-card bg-card p-4 md:px-5">
          <div className="flex items-end justify-between gap-3">
            <SectionLabel>Optional · {formatMoney(sum(plan.optional))}</SectionLabel>
            <ColumnHeads last={lastHead} />
          </div>
          {plan.optional.map(categoryLine)}
        </section>
      )}

      </div>
      </div>

      {editing?.kind === 'category' && (
        <AmountEditDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={`${editing.line.label} budget`}
          description="The difference comes out of, or goes back to, your credit card payment."
          current={editing.line.amount}
          suggested={defaultBudget({ amount: editing.line.lastMonth ?? 0, isEstimate: editing.line.lastMonthIsEstimate })}
          kind={editing.line.kind === 'optional' ? 'optional' : 'essential'}
          onSave={async (amount) => {
            await repo.setBudgetOverride(model.period.start, editing.line.key, amount)
            toast.success(`${editing.line.label} set to ${formatMoney(amount)}`)
          }}
          onReset={
            editing.line.isOverride
              ? async () => {
                  await repo.clearBudgetOverride(model.period.start, editing.line.key)
                  toast.success(`${editing.line.label} back to the suggested amount`)
                }
              : undefined
          }
        />
      )}

      {editing?.kind === 'buffer' && (
        <AmountEditDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title="Buffer this month"
          description="Money kept aside for surprises. To change it for every month, use Settings."
          current={model.buffer}
          suggested={snapshot.settings.bufferAmount}
          kind="essential"
          onSave={async (amount) => {
            await repo.setBudgetOverride(model.period.start, BUFFER_KEY, amount)
            toast.success(`Buffer set to ${formatMoney(amount)} this month`)
          }}
          onReset={
            model.bufferIsOverride
              ? async () => {
                  await repo.clearBudgetOverride(model.period.start, BUFFER_KEY)
                  toast.success('Buffer back to your usual amount')
                }
              : undefined
          }
        />
      )}
    </>
  )
}
