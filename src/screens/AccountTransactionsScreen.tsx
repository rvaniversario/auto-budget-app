import { useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { Navigate, useParams } from 'react-router'
import {
  formatDayHeading,
  formatMoney,
  getAccountBalance,
  isDebtAccount,
  isInPeriod,
  todayISO,
  transferFee,
  type Account,
  type Transaction,
} from '@/core'
import { useAddTransaction } from '@/hooks/useAddTransaction'
import { useAppData } from '@/hooks/useAppData'
import { ChoiceChips } from '@/components/inputs'
import { EditTransactionHost } from '@/components/EditTransactionHost'
import { SubHeader } from '@/components/layout'
import { AccountDialog } from '@/screens/AccountsScreen'
import { makeDescriber } from '@/lib/describeTransaction'
import { cn } from '@/lib/utils'

type Period = 'month' | 'all'

const GROUP_LABEL: Record<Account['type'], string> = {
  cash: 'Cash',
  bank: 'Deposit',
  ewallet: 'E-wallet',
  credit_card: 'Credit card',
  loan: 'Loan',
  debt: 'Debt',
}

/** Money moving into (+) or out of (−) this account, fees included. */
export function flowFor(t: Transaction, accountId: string): number {
  if (t.type === 'transfer') {
    if (t.toAccountId === accountId) return t.amount
    if (t.accountId === accountId) return -(t.amount + transferFee(t))
    return 0
  }
  if (t.accountId !== accountId) return 0
  return t.type === 'income' ? t.amount : -t.amount
}

/** One account's transactions: paid from it, paid into it, and transfers either way. */
export function AccountTransactionsScreen() {
  const { id = '' } = useParams()
  const { snapshot, model } = useAppData()
  const openAdd = useAddTransaction()
  const [period, setPeriod] = useState<Period>('month')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [editingAccount, setEditingAccount] = useState(false)
  const describe = useMemo(() => makeDescriber(snapshot), [snapshot])

  const account = snapshot.accounts.find((a) => a.id === id && !a.deletedAt)

  const mine = useMemo(
    () =>
      snapshot.transactions
        .filter((t) => !t.deletedAt && (t.accountId === id || t.toAccountId === id))
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [snapshot.transactions, id],
  )

  if (!account) return <Navigate to="/accounts" replace />

  const owed = isDebtAccount(account.type)
  const balance = getAccountBalance(account, snapshot.transactions)
  const thisMonth = mine.filter((t) => isInPeriod(t.date, model.period))
  const flowIn = thisMonth.reduce((s, t) => s + Math.max(0, flowFor(t, id)), 0)
  const flowOut = thisMonth.reduce((s, t) => s + Math.max(0, -flowFor(t, id)), 0)
  const shown = period === 'month' ? thisMonth : mine

  const groups = new Map<string, Transaction[]>()
  for (const t of shown) groups.set(t.date, [...(groups.get(t.date) ?? []), t])
  const today = todayISO()
  const paydays = new Set(model.paydays)

  return (
    <>
      <SubHeader
        title={account.name}
        to="/accounts"
        action={
          <button
            type="button"
            onClick={() => setEditingAccount(true)}
            aria-label={`Edit ${account.name}`}
            className="flex size-11 items-center justify-center rounded-lg border border-border bg-card text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Pencil className="size-[18px]" aria-hidden="true" />
          </button>
        }
      />

      <section aria-label="Balance" className="flex flex-col gap-3.5 rounded-card bg-card p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <span className="label-mono text-muted-foreground">
            {GROUP_LABEL[account.type]} · {owed ? 'amount owed' : 'balance'}
          </span>
          <span className={cn('money text-[28px] leading-none font-bold', !owed && balance < 0 && 'text-danger-bar')}>
            {formatMoney(balance)}
          </span>
        </div>
        <dl className="m-0 grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <dt className="label-mono text-muted-foreground">In this month</dt>
            <dd className="money m-0 text-[13px] font-semibold text-income">+ {formatMoney(flowIn)}</dd>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
            <dt className="label-mono text-muted-foreground">Out this month</dt>
            <dd className="money m-0 text-[13px] font-semibold">− {formatMoney(flowOut)}</dd>
          </div>
        </dl>
      </section>

      <ChoiceChips
        label="Period"
        shape="pill"
        scroll
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'month', label: 'This budget month' },
          { value: 'all', label: 'All time' },
        ]}
      />

      {shown.length === 0 ? (
        <p className="rounded-card bg-card p-5 text-center text-sm text-muted-foreground">
          {mine.length === 0 ? 'No transactions in this account yet.' : 'No transactions in this account this budget month.'}
        </p>
      ) : (
        <section aria-label={`Transactions in ${account.name}`} className="flex flex-col rounded-card bg-card px-4 pt-2 pb-3 md:px-5">
          {[...groups.entries()].map(([date, items], gi) => (
            <div key={date}>
              <h2 className={cn('mt-2.5 mb-0.5 font-sans text-xs font-bold text-muted-foreground', gi > 0 && 'border-t border-border pt-2.5')}>
                {date === today ? `Today · ${formatDayHeading(date)}` : formatDayHeading(date)}
                {paydays.has(date) ? ' · Payday' : ''}
              </h2>
              <ul>
                {items.map((t) => {
                  const d = describe(t)
                  const flow = flowFor(t, id)
                  const sub = t.type === 'transfer' ? `Transfer · ${d.account}${t.fee && t.accountId === id ? ` · fee ${formatMoney(t.fee)}` : ''}` : d.category
                  return (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setEditing(t)}
                        aria-label={`${d.title}, ${flow >= 0 ? 'in' : 'out'} ${formatMoney(Math.abs(flow))}. Edit`}
                        className="-mx-2 flex min-h-[52px] w-[calc(100%+16px)] items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-sm font-semibold">{d.title}</span>
                          <span className="truncate text-xs text-muted-foreground">{sub}</span>
                        </span>
                        <span className={cn('money flex-none text-[13px] font-semibold whitespace-nowrap', flow > 0 && 'text-income')}>
                          {flow >= 0 ? '+ ' : '− '}
                          {formatMoney(Math.abs(flow))}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      <p className="text-xs leading-[1.45] text-muted-foreground">Only transactions paid from or into this account. Tap one to edit it.</p>

      {/* Room so the + button never covers the last row, and the button itself. */}
      <div aria-hidden="true" className="h-16" />
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(24px+env(safe-area-inset-bottom))] z-30 mx-auto flex w-full max-w-[720px] justify-end px-5 md:bottom-8 lg:max-w-none lg:px-10">
        <button
          type="button"
          onClick={() => openAdd({ from: account.id })}
          aria-label={`Add transaction to ${account.name}`}
          className="fab-orb pointer-events-auto flex size-[60px] items-center justify-center rounded-full outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95"
        >
          <Plus className="size-[26px]" strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>

      <EditTransactionHost transaction={editing} onClose={() => setEditing(null)} />
      <AccountDialog open={editingAccount} account={editingAccount ? account : null} onClose={() => setEditingAccount(false)} />
    </>
  )
}
