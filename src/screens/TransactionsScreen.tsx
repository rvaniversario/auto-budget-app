import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import {
  alive,
  centavosToInput,
  formatDayHeading,
  formatMoney,
  formatPeriodDash,
  formatShortDate,
  isInPeriod,
  todayISO,
  type Transaction,
} from '@/core'
import { useAppData } from '@/hooks/useAppData'
import { useIsLg, useIsMd } from '@/hooks/useMedia'
import { TabHeader } from '@/components/layout'
import { ChoiceChips, TextInput } from '@/components/inputs'
import { deleteWithUndo, EditTransactionHost } from '@/components/EditTransactionHost'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { amountSign, makeDescriber, type TransactionDescription } from '@/lib/describeTransaction'
import { cn } from '@/lib/utils'

const ALL = '__all__'
const INCOME = '__income__'
const TRANSFERS = '__transfers__'
const BILLS = '__bills__'
type PeriodFilter = 'month' | 'last' | 'all'

const PERIOD_LABEL: Record<PeriodFilter, string> = {
  month: 'This budget month',
  last: 'Last budget month',
  all: 'All time',
}

function AmountText({ t, className }: { t: Transaction; className?: string }) {
  return (
    <span
      className={cn(
        'money whitespace-nowrap font-semibold',
        t.type === 'income' && 'text-income',
        t.type === 'transfer' && 'text-muted-foreground',
        className,
      )}
    >
      {amountSign(t)}
      {formatMoney(t.amount)}
    </span>
  )
}

function OneTimeTag() {
  return <span className="rounded-[10px] bg-warning-tint px-2 py-0.5 text-[11px] font-bold text-warning-text">One-time</span>
}

export function TransactionsScreen() {
  const { snapshot, model } = useAppData()
  const isMd = useIsMd()
  const isLg = useIsLg()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>(ALL)
  const [account, setAccount] = useState<string>(ALL)
  const [period, setPeriod] = useState<PeriodFilter>('month')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const describe = useMemo(() => makeDescriber(snapshot), [snapshot])
  const accounts = alive(snapshot.accounts)
  const categories = snapshot.categories.filter((c) => !c.deletedAt && !c.archived)
  // The period filter is only shown on laptops; elsewhere show everything.
  const effectivePeriod: PeriodFilter = isLg ? period : 'all'

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return snapshot.transactions.filter((t) => {
      if (t.deletedAt) return false
      if (category === INCOME && t.type !== 'income') return false
      if (category === TRANSFERS && t.type !== 'transfer') return false
      if (category === BILLS && !(t.type === 'expense' && !t.categoryId)) return false
      if (![ALL, INCOME, TRANSFERS, BILLS].includes(category) && t.categoryId !== category) return false
      if (account !== ALL && t.accountId !== account && t.toAccountId !== account) return false
      if (effectivePeriod === 'month' && !isInPeriod(t.date, model.period)) return false
      if (effectivePeriod === 'last' && !isInPeriod(t.date, model.previousPeriod)) return false
      if (!q) return true
      const d = describe(t)
      return (
        d.title.toLowerCase().includes(q) ||
        d.meta.toLowerCase().includes(q) ||
        centavosToInput(t.amount).includes(q.replace(/[₱,]/g, ''))
      )
    })
  }, [snapshot, query, category, account, effectivePeriod, model.period, model.previousPeriod, describe])

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    for (const t of filtered) map.set(t.date, [...(map.get(t.date) ?? []), t])
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const anyAtAll = snapshot.transactions.some((t) => !t.deletedAt)
  const selected = filtered.find((t) => t.id === selectedId) ?? null
  const today = todayISO()
  const dayHeading = (date: string) =>
    `${date === today ? `Today · ${formatDayHeading(date)}` : formatDayHeading(date)}${date === model.period.start ? ' · Payday' : ''}`

  const categoryOptions = [
    { value: ALL, label: isMd ? 'All categories' : 'All' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
    { value: BILLS, label: 'Bills' },
    { value: TRANSFERS, label: 'Transfers' },
    { value: INCOME, label: 'Income' },
  ]

  const count = `${filtered.length} transaction${filtered.length === 1 ? '' : 's'}`
  const eyebrow = isLg
    ? effectivePeriod === 'all'
      ? `All time · ${count}`
      : `${formatPeriodDash(effectivePeriod === 'month' ? model.period : model.previousPeriod)} · ${count}`
    : isMd
      ? count
      : undefined

  const empty = (
    <p className="rounded-card bg-card p-5 text-center text-[15px] text-muted-foreground">
      {anyAtAll ? 'Nothing matches these filters.' : 'No transactions yet. Add one to see it here.'}
    </p>
  )

  return (
    <>
      <TabHeader title="Transactions" eyebrow={eyebrow} />

      {isMd ? (
        <div role="search" className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-[2_1_240px] flex-col gap-1">
            <Label htmlFor="tx-search" className="text-xs font-semibold text-muted-foreground">
              Search <span className="font-normal">(press /)</span>
            </Label>
            <TextInput
              id="tx-search"
              data-search
              type="search"
              placeholder="Notes or amounts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 text-[15px]"
            />
          </div>
          <FilterSelect id="tx-cat" label="Category" value={category} onChange={setCategory} options={categoryOptions} />
          <FilterSelect
            id="tx-acct"
            label="Account"
            value={account}
            onChange={setAccount}
            options={[{ value: ALL, label: 'All accounts' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
          {isLg && (
            <FilterSelect
              id="tx-period"
              label="Period"
              value={period}
              onChange={(v) => setPeriod(v as PeriodFilter)}
              options={(Object.keys(PERIOD_LABEL) as PeriodFilter[]).map((k) => ({ value: k, label: PERIOD_LABEL[k] }))}
            />
          )}
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <TextInput
              type="search"
              data-search
              aria-label="Search transactions"
              placeholder="Search notes or amounts"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-12 pl-10 text-[15px]"
            />
          </div>
          <ChoiceChips label="Filter by category" shape="pill" scroll value={category} onChange={setCategory} options={categoryOptions} />
        </>
      )}

      {groups.length === 0 ? (
        empty
      ) : isLg ? (
        <div className="flex items-start gap-5">
          <TransactionTable
            rows={filtered}
            describe={describe}
            selectedId={selected?.id ?? null}
            onSelect={(t) => setSelectedId(t.id)}
          />
          <DetailsPanel
            transaction={selected}
            describe={describe}
            onClose={() => setSelectedId(null)}
            onEdit={setEditing}
            onDelete={async (t) => {
              await deleteWithUndo(t)
              setSelectedId(null)
            }}
          />
        </div>
      ) : (
        <section aria-label="Transactions by day" className="flex flex-col rounded-card bg-card px-4 pt-2 pb-3 md:px-5">
          {groups.map(([date, items], gi) => (
            <div key={date}>
              <h2 className={cn('mt-2.5 mb-0.5 font-sans text-[13px] font-bold text-muted-foreground', gi > 0 && 'border-t border-border pt-2.5')}>
                {dayHeading(date)}
              </h2>
              <ul>
                {items.map((t) => {
                  const d = describe(t)
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setEditing(t)}
                        aria-label={`${d.title}, ${formatMoney(t.amount)}. Edit`}
                        className="-mx-2 w-[calc(100%+16px)] rounded-lg px-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {isMd ? (
                          <span className="grid min-h-12 grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_7.5rem] items-center gap-3">
                            <span className="flex min-w-0 items-center gap-2 truncate text-[15px] font-semibold">
                              <span className="truncate">{d.title}</span>
                              {t.isOneTime && <OneTimeTag />}
                            </span>
                            <span className="truncate text-sm text-muted-foreground">{d.category}</span>
                            <span className="truncate text-sm text-muted-foreground">{d.account}</span>
                            <AmountText t={t} className="text-right text-[15px]" />
                          </span>
                        ) : (
                          <span className="flex min-h-[52px] items-center justify-between gap-3 py-1.5">
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span className="flex items-center gap-2 truncate text-[15px] font-semibold">
                                {d.title}
                                {t.isOneTime && <OneTimeTag />}
                              </span>
                              <span className="truncate text-[13px] text-muted-foreground">{d.meta}</span>
                            </span>
                            <AmountText t={t} className="flex-none text-base" />
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      <EditTransactionHost transaction={editing} onClose={() => setEditing(null)} />
    </>
  )
}

// ---------------------------------------------------------------------------

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="flex min-w-0 flex-[1_1_150px] flex-col gap-1">
      <Label htmlFor={id} className="text-xs font-semibold text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-11 w-full rounded-lg bg-card text-[15px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

const th = 'px-4 py-3 text-left text-xs font-semibold text-muted-foreground'
const td = 'border-t border-border px-4'

function TransactionTable({
  rows,
  describe,
  selectedId,
  onSelect,
}: {
  rows: Transaction[]
  describe: (t: Transaction) => TransactionDescription
  selectedId: string | null
  onSelect: (t: Transaction) => void
}) {
  return (
    <div className="min-w-0 flex-1 overflow-x-auto rounded-card bg-card">
      <table className="w-full min-w-[560px] border-collapse">
        <thead>
          <tr>
            <th scope="col" className={th}>Date</th>
            <th scope="col" className={th}>Note</th>
            <th scope="col" className={th}>Category</th>
            <th scope="col" className={th}>Account</th>
            <th scope="col" className={cn(th, 'text-right')}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const d = describe(t)
            const isSelected = t.id === selectedId
            return (
              <tr
                key={t.id}
                aria-selected={isSelected}
                onClick={() => onSelect(t)}
                className={cn('cursor-pointer', isSelected ? 'bg-success-tint' : 'hover:bg-muted/60')}
              >
                <td className={cn(td, 'h-[52px] whitespace-nowrap text-sm text-muted-foreground')}>{formatShortDate(t.date)}</td>
                <td className={cn(td, 'text-[15px] font-semibold whitespace-nowrap')}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(t)
                    }}
                    className="flex items-center gap-2 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {d.title}
                    {t.isOneTime && <OneTimeTag />}
                  </button>
                </td>
                <td className={cn(td, 'text-sm')}>{d.category}</td>
                <td className={cn(td, 'text-sm')}>{d.account}</td>
                <td className={cn(td, 'text-right')}>
                  <AmountText t={t} className="text-[15px]" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function DetailsPanel({
  transaction: t,
  describe,
  onClose,
  onEdit,
  onDelete,
}: {
  transaction: Transaction | null
  describe: (t: Transaction) => TransactionDescription
  onClose: () => void
  onEdit: (t: Transaction) => void
  onDelete: (t: Transaction) => void
}) {
  if (!t) return null
  const d = describe(t)
  const typeLabel = t.type === 'expense' ? 'Expense' : t.type === 'income' ? 'Income' : 'Transfer'
  const rows: [string, string][] = [
    ['Note', t.note || 'None'],
    ['Category', d.category],
    [t.type === 'expense' ? 'Paid with' : t.type === 'income' ? 'Received in' : 'Accounts', d.account],
    ['Date', formatDayHeading(t.date)],
  ]
  if (t.type === 'expense') rows.push(['One-time expense', t.isOneTime ? 'Yes' : 'No'])

  return (
    <aside
      aria-label="Transaction details"
      className="sticky top-8 flex w-[300px] flex-none flex-col gap-4 rounded-card bg-card p-5 xl:w-[340px]"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-sans text-base font-bold">Transaction details</h2>
        <Button variant="ghost" size="icon" aria-label="Close details" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-muted-foreground">{typeLabel}</span>
        <AmountText t={t} className="text-4xl leading-tight font-bold" />
      </div>
      <dl className="m-0 flex flex-col">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-h-11 items-center justify-between gap-3 border-t border-border">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="m-0 text-right text-[15px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid grid-cols-2 gap-2.5">
        <Button variant="outline" className="h-12 bg-card text-[15px] text-danger-bar" onClick={() => onDelete(t)}>
          Delete
        </Button>
        <Button className="h-12 text-[15px]" onClick={() => onEdit(t)}>
          Edit
        </Button>
      </div>
    </aside>
  )
}
