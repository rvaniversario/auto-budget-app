import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronRight } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  alive,
  centavosToInput,
  formatMoney,
  formatShortDate,
  getAccountBalance,
  ordinal,
  type Account,
  type AccountType,
} from '@/core'
import { repo } from '@/data'
import { useAddTransaction } from '@/hooks/useAddTransaction'
import { useAppData } from '@/hooks/useAppData'
import { DashedButton, TabHeader } from '@/components/layout'
import { MoneyInput, Segmented, TextInput } from '@/components/inputs'
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

const TYPE_LABEL: Record<AccountType, string> = { cash: 'Wallet', bank: 'Bank account', credit_card: 'Credit card' }

export function AccountsScreen() {
  const { snapshot, model } = useAppData()
  const [editing, setEditing] = useState<Account | null>(null)
  const [adding, setAdding] = useState(false)
  const openAdd = useAddTransaction()
  const accounts = alive(snapshot.accounts)
  const money = accounts.filter((a) => a.type !== 'credit_card')

  return (
    <>
      <TabHeader title="Accounts" />
      <div className="grid gap-3 md:grid-cols-2 md:gap-4 xl:grid-cols-3">

      {money.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => setEditing(a)}
          aria-label={`${a.name}, ${formatMoney(getAccountBalance(a, snapshot.transactions))}. Edit`}
          className="flex min-h-[76px] items-center justify-between rounded-card bg-card p-4 text-left outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 md:px-5"
        >
          <span className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold">{a.name}</span>
            <span className="text-[13px] text-muted-foreground">{TYPE_LABEL[a.type]}</span>
          </span>
          <span className={cn('money text-lg font-semibold', getAccountBalance(a, snapshot.transactions) < 0 && 'text-danger-bar')}>
            {formatMoney(getAccountBalance(a, snapshot.transactions))}
          </span>
        </button>
      ))}

      {model.cards.map((c) => (
        <section key={c.account.id} aria-label={c.account.name} className="flex flex-col gap-3.5 rounded-card bg-card p-4 md:col-span-full md:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{c.account.name}</span>
              <span className="text-[13px] text-muted-foreground">Amount owed</span>
            </div>
            <span className="money text-[22px] font-bold">{formatMoney(c.balance)}</span>
          </div>
          <dl className="m-0 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Tile term="Statement date" value={c.account.statementDay ? `${ordinal(c.account.statementDay)} of the month` : 'Not set'} />
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
            <Button variant="outline" className="h-11 bg-card" onClick={() => openAdd({ type: 'transfer', to: c.account.id })}>
              Record a payment
            </Button>
            <Button variant="outline" className="h-11 bg-card" onClick={() => setEditing(c.account)}>
              Edit card
            </Button>
          </div>
        </section>
      ))}

      </div>
      <DashedButton onClick={() => setAdding(true)}>Add account</DashedButton>

      <AccountDialog open={adding || editing !== null} account={editing} onClose={() => {
        setAdding(false)
        setEditing(null)
      }} />
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

// ---------------------------------------------------------------------------

const optionalDay = z.string().refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 31), 'Enter a day from 1 to 31')

const schema = z
  .object({
    type: z.enum(['cash', 'bank', 'credit_card']),
    name: z.string().trim().min(1, 'Give the account a name').max(40),
    balance: moneyField({ allowZero: true, message: 'Enter a balance (0 is fine)' }),
    statementDay: optionalDay,
    dueDay: optionalDay,
    minimum: optionalMoneyField(),
    rate: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.type !== 'credit_card') return
    if (!v.dueDay) ctx.addIssue({ code: 'custom', path: ['dueDay'], message: 'Enter the due day' })
    if (!(/^\d+(\.\d+)?$/.test(v.rate) && Number(v.rate) <= 10)) {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: 'Enter a rate between 0 and 10' })
    }
  })
type Values = z.infer<typeof schema>

function AccountDialog({ open, account, onClose }: { open: boolean; account: Account | null; onClose: () => void }) {
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

  const submit = async (v: Values) => {
    const isCard = v.type === 'credit_card'
    const data = {
      name: v.name,
      type: v.type,
      openingBalance: toCentavos(v.balance),
      statementDay: isCard && v.statementDay ? Number(v.statementDay) : null,
      dueDay: isCard && v.dueDay ? Number(v.dueDay) : null,
      minimumDue: isCard ? toCentavos(v.minimum) : null,
      monthlyInterestRate: isCard ? Number(v.rate) : null,
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
                {account ? 'Changes apply to all your past transactions on this account.' : 'Cash, a bank account or a credit card.'}
              </DialogDescription>
            </DialogHeader>
            {!account && (
              <Controller
                name="type"
                control={form.control}
                render={({ field: f }) => (
                  <Segmented
                    label="Account type"
                    value={f.value}
                    onChange={f.onChange}
                    options={[
                      { value: 'cash', label: 'Cash' },
                      { value: 'bank', label: 'Bank' },
                      { value: 'credit_card', label: 'Credit card' },
                    ]}
                  />
                )}
              />
            )}
            {field('name', 'Name', (p) => <TextInput placeholder={type === 'credit_card' ? 'My credit card' : 'BDO savings'} {...p} />)}
            {field(
              'balance',
              type === 'credit_card' ? 'Amount owed when added (₱)' : 'Starting balance (₱)',
              (p) => <MoneyInput {...p} />,
              type === 'credit_card' ? 'Card purchases add to this; payments to the card reduce it.' : 'What was in it before you started logging.',
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
