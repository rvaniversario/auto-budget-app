import { useState } from 'react'
import { ChevronRight, Plus, ReceiptText, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import {
  billsDueThisPeriod,
  describeDue,
  dueDateInPeriod,
  formatMoney,
  formatPeriodDash,
  formatShortDate,
  getCategoryStatus,
  percentUsed,
  periodMonthName,
  type CategoryRow,
  type CategoryStatus,
  type Transaction,
} from '@/core'
import { useAddTransaction } from '@/hooks/useAddTransaction'
import { EditTransactionHost } from '@/components/EditTransactionHost'
import { PlannedDebtBars, ReportsCard, TrialNotice, usePlannedDebtRows } from '@/components/HomePremium'
import { amountSign, makeDescriber } from '@/lib/describeTransaction'
import { useAppData } from '@/hooks/useAppData'
import { Money } from '@/components/Money'
import { MoveBudgetDialog, useCoverOverspend } from '@/components/MoveBudgetDialog'
import { TabHeader, Tag } from '@/components/layout'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

export function HomeScreen() {
  const { model, snapshot } = useAppData()
  const openAdd = useAddTransaction()
  const [editing, setEditing] = useState<Transaction | null>(null)
  const hasAnyTransaction = snapshot.transactions.length > 0
  const month = periodMonthName(model.period)

  return (
    <>
      <TabHeader
        eyebrow={`${formatPeriodDash(model.period)} · Day ${model.period.dayIndex} of ${model.period.totalDays}`}
        title={hasAnyTransaction ? `Your ${month} budget` : 'Your first budget is ready'}
      />
      <TrialNotice />
      <OverspendAlerts />
      <div className="grid gap-4 md:grid-cols-2 md:items-start md:gap-5 lg:gap-6">
        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          <Hero />
          <MonthSummary />
          <BillsDueCard />
          <ReportsCard />
        </div>
        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          {hasAnyTransaction ? <CategoryBudgets /> : <EmptyTransactions />}
          {hasAnyTransaction && <RecentTransactions onSelect={setEditing} />}
        </div>
      </div>
      <EditTransactionHost transaction={editing} onClose={() => setEditing(null)} />
      {/* Phones only: room so the + button never covers the last row, and the button itself. */}
      <div aria-hidden="true" className="h-14 md:hidden" />
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(92px+env(safe-area-inset-bottom))] z-30 mx-auto flex w-full max-w-[720px] justify-end px-5 md:hidden">
        <button
          type="button"
          onClick={() => openAdd()}
          aria-label="Add transaction"
          className="pointer-events-auto flex size-[60px] items-center justify-center rounded-full bg-ink text-ink-foreground shadow-[0_6px_16px_rgba(20,32,27,0.28)] outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
        >
          <Plus className="size-[26px]" strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------

function OverspendAlerts() {
  const { model } = useAppData()
  const cover = useCoverOverspend()
  const [choosing, setChoosing] = useState<CategoryRow | null>(null)
  if (model.overspent.length === 0) return null

  return (
    <>
      {model.overspent.map(({ row, fix }) => (
        <section
          key={row.categoryId}
          aria-label="Overspending alert"
          className="flex flex-col gap-3 rounded-card bg-danger-tint p-4 text-danger-text"
        >
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="size-6 flex-none" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h2 className="font-sans text-base font-bold">
                {row.name} is over budget by {formatMoney(row.overBy)}
              </h2>
              <p className="text-sm leading-[1.45] text-foreground">
                {model.cards.length > 0
                  ? `Your ${formatMoney(model.safe.amount)} card payment is still safe if you cover this from another category.`
                  : 'Cover this from another category to keep your plan on track.'}
              </p>
            </div>
          </div>
          {fix.type === 'move' ? (
            <button
              type="button"
              onClick={() =>
                cover(row, {
                  type: 'category',
                  row: model.categoryRows.find((r) => r.categoryId === fix.fromCategoryId)!,
                  amount: fix.amount,
                })
              }
              className="h-12 rounded-lg bg-ink text-[15px] font-semibold text-ink-foreground"
            >
              Move {formatMoney(fix.amount)} from {fix.fromName}
            </button>
          ) : (
            fix.bufferIsEnough && (
              <button
                type="button"
                onClick={() => cover(row, { type: 'buffer', amount: fix.amount })}
                className="h-12 rounded-lg bg-ink text-[15px] font-semibold text-ink-foreground"
              >
                Use {formatMoney(fix.amount)} of your buffer
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => setChoosing(row)}
            className="h-11 rounded-lg border border-danger-text bg-transparent text-[15px] font-semibold text-danger-text"
          >
            Choose another category
          </button>
        </section>
      ))}
      <MoveBudgetDialog over={choosing} open={choosing !== null} onOpenChange={(o) => !o && setChoosing(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------

function Hero() {
  const { model } = useAppData()
  const { safe, cards } = model

  if (cards.length === 0) {
    return (
      <section aria-label="Your plan" className="flex flex-col gap-3.5 rounded-hero bg-primary p-5 text-primary-foreground">
        <p className="text-sm font-medium text-hero-muted">Not yet given a job this month</p>
        <p className="money text-5xl leading-none font-bold tracking-[-0.02em]">{formatMoney(Math.max(0, model.plan.unassigned))}</p>
        <p className="text-sm leading-[1.45] text-hero-muted">
          You have no credit card added. Add one to see how much you can safely pay on it each month.
        </p>
        <Link
          to="/accounts"
          className="flex min-h-11 items-center justify-between rounded-lg bg-hero-chip px-4 text-[15px] font-semibold text-hero-link"
        >
          Add a credit card
          <ChevronRight className="size-[18px]" aria-hidden="true" />
        </Link>
      </section>
    )
  }

  const dueDate = cards
    .map((c) => c.nextDueDate)
    .filter((d): d is string => !!d)
    .sort()[0]

  return (
    <section aria-label="Credit card recommendation" className="flex flex-col gap-3.5 rounded-hero bg-primary p-5 text-primary-foreground">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-hero-muted">Safe to pay on your credit card this month</p>
        {safe.isEstimate && (
          <span className="flex-none rounded-xl bg-hero-chip px-2.5 py-[3px] text-[11px] font-bold text-success-text">Estimate</span>
        )}
      </div>
      <p className="money text-5xl leading-none font-bold tracking-[-0.02em] md:text-[44px] lg:text-[56px]">{formatMoney(safe.amount)}</p>
      {safe.isEstimate && (
        <p className="text-sm leading-[1.45] text-hero-muted">
          Based on the amounts you gave during setup. This gets more accurate as you log real spending.
        </p>
      )}
      {safe.belowMinimum && (
        <p className="flex items-start gap-2 rounded-lg bg-danger-tint px-3 py-2 text-sm font-semibold text-danger-text">
          <TriangleAlert className="mt-0.5 size-4 flex-none" aria-hidden="true" />
          This is {formatMoney(safe.shortfall)} below your minimum due. See ways to close the gap.
        </p>
      )}
      {safe.paysInFull && !safe.belowMinimum && (
        <p className="text-sm leading-[1.45] text-hero-muted">That clears your whole bill, so you pay no interest.</p>
      )}
      <div className="grid grid-cols-3 gap-2 border-t border-hero-divider pt-3.5">
        <HeroStat label="Bill total" value={formatMoney(safe.cardBalance)} />
        <HeroStat label="Due" value={dueDate ? formatShortDate(dueDate) : 'Not set'} />
        <HeroStat label="Minimum due" value={formatMoney(safe.minimumDue)} />
      </div>
      {model.paidToCardsThisPeriod > 0 && (
        <p className="text-sm text-hero-muted">
          Paid so far {formatMoney(model.paidToCardsThisPeriod)}
          {model.leftToPay > 0 ? ` · ${formatMoney(model.leftToPay)} left to pay` : ' · all done for this month'}
        </p>
      )}
      <Link
        to="/breakdown"
        className="flex min-h-11 items-center justify-between rounded-lg bg-hero-chip px-4 text-[15px] font-semibold text-hero-link"
      >
        Why this amount?
        <ChevronRight className="size-[18px]" aria-hidden="true" />
      </Link>
    </section>
  )
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-hero-muted">{label}</span>
      <span className="money truncate text-[15px] font-semibold">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------

function MonthSummary() {
  const { model, snapshot } = useAppData()
  return (
    <section aria-label="Month summary" className="grid grid-cols-3 gap-2 rounded-card bg-card p-4">
      <SummaryStat label="Salary" value={snapshot.settings.monthlySalary} />
      <SummaryStat label="Spent so far" value={model.spentSoFar} />
      <SummaryStat label="Remaining" value={model.remaining} highlight />
    </section>
  )
}

function SummaryStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Money
        value={value}
        decimals="never"
        className={cn('truncate text-lg font-semibold', highlight && (value < 0 ? 'text-danger-bar' : 'text-link'))}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function CategoryBudgets() {
  const { model } = useAppData()
  const planned = usePlannedDebtRows()
  const rows = [...model.categoryRows].sort((a, b) => Number(b.status === 'over') - Number(a.status === 'over'))

  return (
    <section aria-label="Category budgets" className="flex flex-col gap-4 rounded-card bg-card px-4 py-[18px]">
      <div className="flex items-center justify-between">
        <h2 className="font-sans text-base font-bold">Category budgets</h2>
        <Link to="/budget" className="flex min-h-11 items-center text-sm font-semibold text-link">
          See plan
        </Link>
      </div>
      {rows.map((r) => (
        <BudgetBar key={r.categoryId} label={r.name} spent={r.spent} budget={r.budget} status={r.status} percent={r.percent} />
      ))}
      {model.fixedBillsTotal > 0 && (
        <BudgetBar
          label="Bills"
          spent={model.billsPaid}
          budget={model.fixedBillsTotal}
          status={getCategoryStatus(model.billsPaid, model.fixedBillsTotal) === 'over' ? 'over' : 'ok'}
          percent={percentUsed(model.billsPaid, model.fixedBillsTotal)}
          quiet
        />
      )}
      {planned && <PlannedDebtBars rows={planned} />}
      {!planned && model.cards.length > 0 && (
        <BudgetBar
          label="Credit card payment"
          spent={model.paidToCardsThisPeriod}
          budget={model.safe.amount}
          status="ok"
          percent={percentUsed(model.paidToCardsThisPeriod, model.safe.amount)}
          quiet
        />
      )}
    </section>
  )
}

function BudgetBar({
  label,
  spent,
  budget,
  status,
  percent,
  quiet,
}: {
  label: string
  spent: number
  budget: number
  status: CategoryStatus
  percent: number
  /** Bills and card rows never show "near" warnings. */
  quiet?: boolean
}) {
  const over = status === 'over'
  const near = status === 'near' && !quiet
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
          <span className="truncate">{label}</span>
          {over && <Tag tone="danger">Over by {formatMoney(spent - budget)}</Tag>}
          {near && <Tag tone="warning">Near limit</Tag>}
        </span>
        <span className={cn('flex-none text-[13px]', over ? 'font-semibold text-danger-bar' : 'text-muted-foreground')}>
          {formatMoney(spent)} of {formatMoney(budget)}
        </span>
      </div>
      <Progress
        value={over ? 100 : percent}
        aria-label={`${label}: ${formatMoney(spent)} of ${formatMoney(budget)}`}
        indicatorClassName={cn(over && 'bg-danger-bar', near && 'bg-warning-bar')}
      />
    </div>
  )
}

function EmptyTransactions() {
  const openAdd = useAddTransaction()
  return (
    <section
      aria-label="No transactions yet"
      className="flex flex-col items-center gap-3 rounded-card border border-dashed border-dash-line px-5 pt-7 pb-5 text-center"
    >
      <ReceiptText className="size-10 text-link" strokeWidth={1.6} aria-hidden="true" />
      <h2 className="font-sans text-[17px] font-bold">No transactions yet</h2>
      <p className="text-sm leading-normal text-muted-foreground">
        Log what you spend as you go. Each entry takes a few taps, and your category budgets will fill in here.
      </p>
      <button
        type="button"
        onClick={() => openAdd()}
        className="flex h-[52px] items-center justify-center self-stretch rounded-[14px] bg-ink text-base font-semibold text-ink-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Add your first transaction
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Laptop and up: bills due and recent transactions

function NeutralTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 rounded-[10px] bg-background px-2 py-0.5 text-xs font-semibold text-muted-foreground">
      {children}
    </span>
  )
}

function BillsDueCard() {
  const { model, snapshot } = useAppData()
  const bills = billsDueThisPeriod(snapshot.fixedBills, snapshot.transactions, model.period, model.today)
  const planned = usePlannedDebtRows()

  type Row = { key: string; name: string; dueDate: string; amount: number; tag: React.ReactNode }
  const rows: Row[] = bills.map((b) => ({
    key: b.bill.id,
    name: b.bill.name,
    dueDate: b.dueDate,
    amount: b.amount,
    tag:
      b.status === 'paid' ? (
        <Tag tone="success">Paid</Tag>
      ) : b.status === 'overdue' ? (
        <Tag tone="danger">{describeDue(b.daysUntil)}</Tag>
      ) : (
        <NeutralTag>{describeDue(b.daysUntil)}</NeutralTag>
      ),
  }))
  if (planned) {
    // The debt plan decides each card's and loan's payment this month.
    const accounts = new Map(snapshot.accounts.map((a) => [a.id, a]))
    for (const p of planned) {
      const dueDay = accounts.get(p.id)?.dueDay
      const dueDate = dueDay ? dueDateInPeriod(dueDay, model.period) : null
      if (!dueDate || p.planned === 0) continue
      const done = p.paid >= p.planned
      rows.push({ key: p.id, name: p.name, dueDate, amount: p.planned, tag: done ? <Tag tone="success">Paid</Tag> : <NeutralTag>Planned</NeutralTag> })
    }
  } else {
    for (const card of model.cards) {
      const dueDate = card.account.dueDay ? dueDateInPeriod(card.account.dueDay, model.period) : null
      if (!dueDate) continue
      const done = card.allocation.amount > 0 && card.paidThisPeriod >= card.allocation.amount
      rows.push({
        key: card.account.id,
        name: card.account.name,
        dueDate,
        amount: card.allocation.amount,
        tag: done ? <Tag tone="success">Paid</Tag> : <NeutralTag>Planned</NeutralTag>,
      })
    }
  }
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  if (rows.length === 0) return null
  return (
    <section aria-label="Bills due this month" className="hidden flex-col gap-2 rounded-card bg-card px-5 py-[18px] lg:flex">
      <div className="flex min-h-11 items-center justify-between">
        <h2 className="font-sans text-base font-bold">Bills due this month</h2>
        <Link to="/settings?section=bills" className="flex min-h-11 items-center text-sm font-semibold text-link hover:underline">
          Edit bills
        </Link>
      </div>
      <ul className="flex flex-col">
        {rows.map((r, i) => (
          <li key={r.key} className={cn('flex min-h-[52px] items-center justify-between gap-3', i > 0 && 'border-t border-border')}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-[15px] font-semibold">{r.name}</span>
              <span className="text-[13px] text-muted-foreground">Due {formatShortDate(r.dueDate)}</span>
            </span>
            <span className="flex flex-none items-center gap-2.5">
              {r.tag}
              <Money value={r.amount} className="text-base font-semibold" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RecentTransactions({ onSelect }: { onSelect: (t: Transaction) => void }) {
  const { snapshot } = useAppData()
  const describe = makeDescriber(snapshot)
  const recent = snapshot.transactions.filter((t) => !t.deletedAt).slice(0, 8)
  return (
    <section aria-label="Recent transactions" className="hidden flex-col gap-2 rounded-card bg-card px-5 py-[18px] lg:flex">
      <div className="flex min-h-11 items-center justify-between">
        <h2 className="font-sans text-base font-bold">Recent transactions</h2>
        <Link to="/transactions" className="flex min-h-11 items-center text-sm font-semibold text-link hover:underline">
          View all
        </Link>
      </div>
      <ul className="-mx-2 flex flex-col">
        {recent.map((t, i) => {
          const d = describe(t)
          return (
            <li key={t.id} className={cn(i > 0 && 'border-t border-border')}>
              <button
                type="button"
                onClick={() => onSelect(t)}
                aria-label={`${d.title}, ${formatMoney(t.amount)}. Edit`}
                className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-lg px-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-semibold">{d.title}</span>
                  <span className="truncate text-[13px] text-muted-foreground">
                    {formatShortDate(t.date)} · {d.meta}
                  </span>
                </span>
                <span
                  className={cn(
                    'money flex-none text-base font-semibold',
                    t.type === 'income' && 'text-income',
                    t.type === 'transfer' && 'text-muted-foreground',
                  )}
                >
                  {amountSign(t)}
                  {formatMoney(t.amount)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
