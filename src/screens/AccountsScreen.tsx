import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronRight } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  centavosToInput,
  formatMoney,
  formatShortDate,
  groupAccounts,
  isDebtAccount,
  nextOccurrence,
  ordinal,
  todayISO,
  type Account,
  type AccountType,
} from '@/core'
import { repo } from '@/data'
import { useAddTransaction } from '@/hooks/useAddTransaction'
import { useAppData } from '@/hooks/useAppData'
import { DashedButton, SectionLabel, TabHeader } from '@/components/layout'
import { ChoiceChips, MoneyInput, TextInput } from '@/components/inputs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { moneyField, optionalMoneyField, toCentavos } from '@/lib/forms'
import { cn } from '@/lib/utils'

const TYPE_LABEL: Record<AccountType, string> = { cash: 'Cash', bank: 'Deposit', ewallet: 'E-wallet', credit_card: 'Credit card', loan: 'Loan', debt: 'Debt' }

const PLACEHOLDER: Record<AccountType, string> = {
  cash: 'Wallet',
  bank: 'BDO savings',
  ewallet: 'GCash, Maya or PalawanPay',
  credit_card: 'My credit card',
  loan: 'Car loan',
  debt: 'Owed to Mom',
}

export function AccountsScreen() {
  const { snapshot, model } = useAppData()
  const [editing, setEditing] = useState<Account | null>(null)
  const [adding, setAdding] = useState(false)
  const openAdd = useAddTransaction()
  const overview = groupAccounts(snapshot.accounts, snapshot.transactions)
  const cardById = new Map(model.cards.map((c) => [c.account.id, c]))

  return (
    <>
      <TabHeader title="Accounts" />

      {overview.groups.length > 0 && (
        <section aria-label="Totals" className="grid grid-cols-3 gap-2 rounded-card bg-card p-4 md:px-5">
          <Total label="Assets" value={overview.assets} />
          <Total label="Liabilities" value={overview.liabilities} />
          <Total label="Net worth" value={overview.netWorth} highlight />
        </section>
      )}

      {overview.groups.map((g) => {
        const headingId = `group-${g.type}`
        const owed = isDebtAccount(g.type)
        return (
          <section key={g.type} aria-labelledby={headingId} className="flex flex-col gap-2.5">
            <div className="flex min-h-9 items-center justify-between gap-3 px-1">
              <SectionLabel className="mb-0 truncate">
                <span id={headingId}>{g.name}</span>
              </SectionLabel>
              <span
                className={cn('money text-[15px] font-semibold', (owed || g.total < 0) && 'text-danger-bar')}
                aria-label={`${g.name} ${owed ? 'owed' : 'total'} ${formatMoney(g.total)}`}
              >
                {owed ? `Owed ${formatMoney(g.total)}` : formatMoney(g.total)}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">
              {g.rows.map(({ account: a, balance }) => {
                if (a.type === 'credit_card') {
                  const c = cardById.get(a.id)
                  if (!c) return null
                  return (
                    <section key={a.id} aria-label={a.name} className="flex flex-col gap-3.5 rounded-card bg-card p-4 md:col-span-full md:px-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[15px] font-semibold">{a.name}</span>
                          <span className="text-[13px] text-muted-foreground">Credit card · amount owed</span>
                        </div>
                        <span className="money text-[22px] font-bold">{formatMoney(c.balance)}</span>
                      </div>
                      <dl className="m-0 grid grid-cols-2 gap-2 lg:grid-cols-4">
                        <Tile term="Statement date" value={a.statementDay ? `${ordinal(a.statementDay)} of the month` : 'Not set'} />
                        <Tile term="Due date" value={c.nextDueDate ? formatShortDate(c.nextDueDate) : 'Not set'} />
                        <Tile term="Minimum due" value={formatMoney(c.minimumDue)} />
                        <Tile term="Interest rate" value={`${c.monthlyInterestRate}% a month`} />
                      </dl>
                      <Link
                        to="/breakdown"
                        className="flex min-h-12 items-center justify-between rounded-lg bg-success-tint px-4 text-[15px] font-semibold text-success-text"
                      >
                        Safe to pay this month: {formatMoney(c.allocation.amount)}
                        <ChevronRight className="size-[18px]" aria-hidden="true" />
                      </Link>
                      <div className="grid grid-cols-2 gap-2 lg:max-w-md">
                        <Button variant="outline" className="h-11 bg-card" onClick={() => openAdd({ type: 'transfer', to: a.id })}>
                          Record a payment
                        </Button>
                        <Button variant="outline" className="h-11 bg-card" onClick={() => setEditing(a)}>
                          Edit card
                        </Button>
                      </div>
                    </section>
                  )
                }
                if (a.type === 'loan' || a.type === 'debt') {
                  const isDebt = a.type === 'debt'
                  return (
                    <section key={a.id} aria-label={a.name} className="flex flex-col gap-3.5 rounded-card bg-card p-4 md:col-span-full md:px-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[15px] font-semibold">{a.name}</span>
                          <span className="text-[13px] text-muted-foreground">{isDebt ? 'Debt' : 'Loan'} · amount owed</span>
                        </div>
                        <span className="money text-[22px] font-bold">{formatMoney(balance)}</span>
                      </div>
                      <dl className="m-0 grid grid-cols-2 gap-2 lg:grid-cols-3">
                        <Tile term="Monthly payment" value={isDebt && !a.minimumDue ? 'Not set' : formatMoney(a.minimumDue ?? 0)} />
                        <Tile term="Next due" value={a.dueDay ? formatShortDate(nextOccurrence(a.dueDay, todayISO())) : 'Not set'} />
                        <Tile term="Interest rate" value={isDebt && !a.monthlyInterestRate ? 'None' : `${a.monthlyInterestRate ?? 0}% a month`} />
                      </dl>
                      <div className="grid grid-cols-2 gap-2 lg:max-w-md">
                        <Button variant="outline" className="h-11 bg-card" onClick={() => openAdd({ type: 'transfer', to: a.id })}>
                          Record a payment
                        </Button>
                        <Button variant="outline" className="h-11 bg-card" onClick={() => setEditing(a)}>
                          {isDebt ? 'Edit debt' : 'Edit loan'}
                        </Button>
                      </div>
                    </section>
                  )
                }
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setEditing(a)}
                    aria-label={`${a.name}, ${formatMoney(balance)}. Edit`}
                    className="flex min-h-[76px] items-center justify-between rounded-card bg-card p-4 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 md:px-5"
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">{a.name}</span>
                      <span className="text-[13px] text-muted-foreground">{TYPE_LABEL[a.type]}</span>
                    </span>
                    <span className={cn('money text-lg font-semibold', balance < 0 && 'text-danger-bar')}>{formatMoney(balance)}</span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

      <DashedButton onClick={() => setAdding(true)}>Add account</DashedButton>

      <AccountDialog
        open={adding || editing !== null}
        account={editing}
        onClose={() => {
          setAdding(false)
          setEditing(null)
        }}
      />
    </>
  )
}

function Tile({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-background p-3">
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="m-0 text-[15px] font-semibold">{value}</dd>
    </div>
  )
}

function Total({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('money truncate text-lg font-semibold', highlight && (value < 0 ? 'text-danger-bar' : 'text-link'))}>
        {formatMoney(value)}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------

const optionalDay = z.string().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 31), 'Enter a day from 1 to 31')

const schema = z
  .object({
    type: z.enum(['cash', 'bank', 'ewallet', 'credit_card', 'loan', 'debt']),
    name: z.string().trim().min(1, 'Give the account a name').max(40),
    balance: moneyField({ allowZero: true, message: 'Enter a balance (0 is fine)' }),
    statementDay: optionalDay,
    dueDay: optionalDay,
    minimum: optionalMoneyField(),
    rate: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (!isDebtAccount(v.type)) return
    // A personal debt needs only the amount owed; payment, due day and interest are optional.
    if (v.type === 'debt') {
      if (v.rate && !(/^\d+(\.\d+)?$/.test(v.rate) && Number(v.rate) <= 10)) {
        ctx.addIssue({ code: 'custom', path: ['rate'], message: 'Enter a rate between 0 and 10, or leave it empty' })
      }
      return
    }
    if (v.type === 'loan' && !v.minimum) ctx.addIssue({ code: 'custom', path: ['minimum'], message: 'Enter the monthly payment' })
    if (!v.dueDay) ctx.addIssue({ code: 'custom', path: ['dueDay'], message: 'Enter the due day' })
    if (!(/^\d+(\.\d+)?$/.test(v.rate) && Number(v.rate) <= 10)) {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: 'Enter a rate between 0 and 10' })
    }
  })
type Values = z.infer<typeof schema>

function AccountDialog({
  open,
  account,
  onClose,
}: {
  open: boolean
  account: Account | null
  onClose: () => void
}) {

  const [confirmDelete, setConfirmDelete] = useState(false)
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'bank', name: '', balance: '0', statementDay: '', dueDay: '', minimum: '', rate: '3' },
  })
  const type = useWatch({ control: form.control, name: 'type' })

  useEffect(() => {
    if (!open) return
    form.reset({
      type: account?.type ?? 'bank',
      name: account?.name ?? '',
      balance: account ? centavosToInput(account.openingBalance) : '0',
      statementDay: account?.statementDay ? String(account.statementDay) : '',
      dueDay: account?.dueDay ? String(account.dueDay) : '',
      minimum: account?.minimumDue != null ? centavosToInput(account.minimumDue) : '',
      rate: account?.monthlyInterestRate != null ? String(account.monthlyInterestRate) : '3',
    })
  }, [open, account, form])

  // Cards and loans suggest 3% interest; a personal debt usually has none.
  useEffect(() => {
    if (account || form.getFieldState('rate').isDirty) return
    form.setValue('rate', type === 'debt' ? '' : '3')
  }, [type, account, form])

  const submit = async (v: Values) => {
    const isCard = v.type === 'credit_card'
    const isDebt = isDebtAccount(v.type)
    const data = {
      name: v.name,
      type: v.type,
      openingBalance: toCentavos(v.balance),
      statementDay: isCard && v.statementDay ? Number(v.statementDay) : null,
      dueDay: isDebt && v.dueDay ? Number(v.dueDay) : null,
      minimumDue: isDebt && (v.type !== 'debt' || v.minimum) ? toCentavos(v.minimum) : null,
      monthlyInterestRate: isDebt ? Number(v.rate || 0) : null,
    }
    if (account) await repo.updateAccount(account.id, data)
    else await repo.addAccount(data)
    toast.success(account ? 'Account updated' : `${v.name} added`)
    onClose()
  }

  const field = (name: keyof Values, label: string, input: (p: object) => React.ReactNode, help?: string) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field: f, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className="gap-1.5">
          <FieldLabel htmlFor={`acct-${name}`} className="text-sm font-semibold">
            {label}
          </FieldLabel>
          {input({ id: `acct-${name}`, 'aria-invalid': fieldState.invalid, ...f })}
          {help && <FieldDescription className="text-[13px]">{help}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{account ? `Edit ${account.name}` : 'Add account'}</DialogTitle>
              <DialogDescription>
                {account ? 'Changes apply to all your past transactions on this account.' : 'Cash, a deposit account, an e-wallet, a credit card, a loan or a debt.'}
              </DialogDescription>
            </DialogHeader>
            {!account && (
              <Controller
                name="type"
                control={form.control}
                render={({ field: f }) => (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold" aria-hidden="true">
                      Account group
                    </span>
                    <ChoiceChips
                      label="Account group"
                      columns={3}
                      value={f.value}
                      onChange={f.onChange}
                      options={[
                        { value: 'cash', label: 'Cash' },
                        { value: 'bank', label: 'Deposit' },
                        { value: 'ewallet', label: 'E-wallet' },
                        { value: 'credit_card', label: 'Card' },
                        { value: 'loan', label: 'Loan' },
                        { value: 'debt', label: 'Debt' },
                      ]}
                    />
                  </div>
                )}
              />
            )}
            {field('name', 'Name', (p) => <TextInput placeholder={PLACEHOLDER[type]} {...p} />)}
            {field(
              'balance',
              isDebtAccount(type) ? 'Amount owed when added (₱)' : 'Starting balance (₱)',
              (p) => <MoneyInput {...p} />,
              type === 'credit_card'
                ? 'Card purchases add to this; payments to the card reduce it.'
                : type === 'loan'
                  ? 'Payments to the loan reduce this.'
                  : type === 'debt'
                    ? 'Money you owe a person, such as family or a friend. Payments to it reduce this.'
                    : 'What was in it before you started logging.',
            )}
            {type === 'credit_card' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {field('minimum', 'Minimum due (₱)', (p) => <MoneyInput {...p} />)}
                  {field('dueDay', 'Due day', (p) => <TextInput inputMode="numeric" maxLength={2} {...p} />)}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {field('statementDay', 'Statement day', (p) => <TextInput inputMode="numeric" maxLength={2} placeholder="Optional" {...p} />)}
                  {field('rate', 'Interest a month (%)', (p) => <TextInput inputMode="decimal" {...p} />)}
                </div>
              </>
            )}
            {type === 'loan' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {field('minimum', 'Monthly payment (₱)', (p) => <MoneyInput {...p} />)}
                  {field('dueDay', 'Due day', (p) => <TextInput inputMode="numeric" maxLength={2} {...p} />)}
                </div>
                {field('rate', 'Interest a month (%)', (p) => <TextInput inputMode="decimal" {...p} />, 'Check your loan statement. 0 if it has no interest.')}
              </>
            )}
            {type === 'debt' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {field('minimum', 'Monthly payment (₱)', (p) => <MoneyInput placeholder="Optional" {...p} />)}
                  {field('dueDay', 'Due day', (p) => <TextInput inputMode="numeric" maxLength={2} placeholder="Optional" {...p} />)}
                </div>
                {field('rate', 'Interest a month (%)', (p) => <TextInput inputMode="decimal" placeholder="0" {...p} />, 'Leave empty if there is no interest.')}
              </>
            )}
            <DialogFooter className="gap-2">
              {account && (
                <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              )}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {account ? 'Save' : 'Add account'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {account?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The account disappears from your lists and plan. Its past transactions stay in your history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!account) return
                await repo.deleteAccount(account.id)
                toast.success(`${account.name} deleted`)
                setConfirmDelete(false)
                onClose()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
