import { useCallback, useEffect, useRef } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Delete } from 'lucide-react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import {
  centavosToInput,
  formatShortDate,
  isValidISODate,
  todayISO,
  type Account,
  type Category,
  type FixedBill,
  type Transaction,
  type TransactionType,
} from '@/core'
import type { NewRecord } from '@/data'
import { ChoiceChips, MoneyInput, Segmented, TextInput } from '@/components/inputs'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { moneyField, toCentavos } from '@/lib/forms'
import { safeStorage } from '@/lib/browser'
import { cn } from '@/lib/utils'

/** Category chip value meaning "a bill payment" (stored as categoryId = null). */
export const BILLS_CHIP = '__bills__'
const LAST_ACCOUNT_KEY = 'auto-budget:last-account'

const schema = z
  .object({
    type: z.enum(['expense', 'income', 'transfer']),
    amount: moneyField(),
    categoryId: z.string().nullable(),
    fixedBillId: z.string().nullable(),
    accountId: z.string().min(1, 'Choose an account'),
    toAccountId: z.string().nullable(),
    note: z.string().trim().max(120, 'Keep the note under 120 characters'),
    date: z.string().refine(isValidISODate, 'Pick a date'),
    isOneTime: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'expense' && !v.categoryId) {
      ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Pick a category' })
    }
    if (v.type === 'transfer') {
      if (!v.toAccountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Choose where the money goes' })
      else if (v.toAccountId === v.accountId) ctx.addIssue({ code: 'custom', path: ['toAccountId'], message: 'Pick two different accounts' })
    }
  })

export type TransactionFormValues = z.infer<typeof schema>

export function toTransactionRecord(v: TransactionFormValues): NewRecord<Transaction> {
  const isExpense = v.type === 'expense'
  const isBill = isExpense && v.categoryId === BILLS_CHIP
  return {
    type: v.type,
    amount: toCentavos(v.amount),
    date: v.date,
    categoryId: isExpense && !isBill ? v.categoryId : null,
    fixedBillId: isBill ? v.fixedBillId : null,
    accountId: v.accountId,
    toAccountId: v.type === 'transfer' ? v.toAccountId : null,
    note: v.note,
    isOneTime: isExpense && v.isOneTime,
  }
}

export function defaultValues(
  accounts: Account[],
  opts: { existing?: Transaction; type?: TransactionType; toAccountId?: string | null; categoryId?: string | null } = {},
): TransactionFormValues {
  const { existing } = opts
  if (existing) {
    return {
      type: existing.type,
      amount: centavosToInput(existing.amount),
      categoryId: existing.type === 'expense' ? (existing.categoryId ?? BILLS_CHIP) : null,
      fixedBillId: existing.fixedBillId,
      accountId: existing.accountId,
      toAccountId: existing.toAccountId,
      note: existing.note,
      date: existing.date,
      isOneTime: existing.isOneTime,
    }
  }
  const type = opts.type ?? 'expense'
  const last = safeStorage.get(LAST_ACCOUNT_KEY)
  const firstOf = (t: Account['type']) => accounts.find((a) => a.type === t)?.id
  let accountId = (last && accounts.some((a) => a.id === last) ? last : undefined) ?? firstOf('cash') ?? accounts[0]?.id ?? ''
  let toAccountId: string | null = null
  if (type === 'transfer') {
    toAccountId = opts.toAccountId ?? firstOf('credit_card') ?? null
    accountId = firstOf('bank') ?? accounts.find((a) => a.id !== toAccountId)?.id ?? ''
  }
  if (type === 'income') accountId = firstOf('bank') ?? accountId
  return {
    type,
    amount: '',
    categoryId: opts.categoryId ?? null,
    fixedBillId: null,
    accountId,
    toAccountId,
    note: '',
    date: todayISO(),
    isOneTime: false,
  }
}

export function rememberAccount(accountId: string) {
  safeStorage.set(LAST_ACCOUNT_KEY, accountId)
}

// ---------------------------------------------------------------------------

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'] as const

/** Apply one number-pad key to the amount text. */
export function pressKey(current: string, key: string): string {
  if (key === 'del') return current.slice(0, -1)
  if (key === '.') {
    if (current.includes('.')) return current
    return current === '' ? '0.' : `${current}.`
  }
  const [whole, cents] = current.split('.')
  if (cents !== undefined && cents.length >= 2) return current
  if (cents === undefined && whole.length >= 8) return current
  if (current === '0') return key
  return current + key
}

function formatAmountText(text: string): string {
  if (text === '') return '0'
  const [whole, cents] = text.split('.')
  const grouped = (whole || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return cents === undefined ? grouped : `${grouped}.${cents}`
}

function NumberPad({ onKey }: { onKey: (key: string) => void }) {
  return (
    <div role="group" aria-label="Number pad" className="grid grid-cols-3 gap-2">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          aria-label={k === 'del' ? 'Delete last digit' : k === '.' ? 'Decimal point' : k}
          className="flex h-[50px] items-center justify-center rounded-lg bg-card font-heading text-[22px] font-semibold text-foreground active:bg-muted"
        >
          {k === 'del' ? <Delete className="size-6" aria-hidden="true" /> : k}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

const sectionLabel = 'text-[13px] font-semibold text-muted-foreground'

export function TransactionForm({
  accounts,
  categories,
  bills,
  initial,
  onSubmit,
  compact = false,
  submitLabel = 'Save',
  extraActions,
  autoFocusAmount = false,
}: {
  accounts: Account[]
  categories: Category[]
  bills: FixedBill[]
  initial: TransactionFormValues
  onSubmit: (values: TransactionFormValues) => Promise<void> | void
  /** Edit mode: amount as a text field instead of the number pad. */
  compact?: boolean
  submitLabel?: string
  extraActions?: React.ReactNode
  /** Focus the amount field on open (keyboard devices). */
  autoFocusAmount?: boolean
}) {
  const form = useForm<TransactionFormValues>({ resolver: zodResolver(schema), defaultValues: initial })
  const { control, setValue, handleSubmit, formState } = form
  const type = useWatch({ control, name: 'type' })
  const amount = useWatch({ control, name: 'amount' })
  const categoryId = useWatch({ control, name: 'categoryId' })
  const accountId = useWatch({ control, name: 'accountId' })
  const date = useWatch({ control, name: 'date' })
  const formRef = useRef<HTMLFormElement>(null)

  const setAmount = useCallback(
    (next: string) => setValue('amount', next, { shouldValidate: formState.isSubmitted, shouldDirty: true }),
    [setValue, formState.isSubmitted],
  )

  const onKey = useCallback((key: string) => setAmount(pressKey(form.getValues('amount'), key)), [form, setAmount])

  // Desktop keyboard input for the number pad.
  useEffect(() => {
    if (compact) return
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]') || target.closest('[role="dialog"]'))) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (/^\d$/.test(e.key)) onKey(e.key)
      else if (e.key === '.' || e.key === ',') onKey('.')
      else if (e.key === 'Backspace') onKey('del')
      else if (e.key === 'Enter') formRef.current?.requestSubmit()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [compact, onKey])

  const changeType = (t: TransactionType) => {
    setValue('type', t)
    const firstOf = (k: Account['type']) => accounts.find((a) => a.type === k)?.id
    if (t === 'transfer' && !form.getValues('toAccountId')) {
      const to = firstOf('credit_card') ?? accounts.find((a) => a.id !== form.getValues('accountId'))?.id ?? null
      setValue('toAccountId', to)
      if (to === form.getValues('accountId')) setValue('accountId', firstOf('bank') ?? accounts.find((a) => a.id !== to)?.id ?? '')
    }
    form.clearErrors()
  }

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }))
  const categoryOptions = [
    ...categories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: c.name })),
    { value: BILLS_CHIP, label: 'Bills' },
  ]
  const isToday = date === todayISO()
  const selectedAccount = accounts.find((a) => a.id === accountId)

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit(async (v) => {
        rememberAccount(v.accountId)
        await onSubmit(v)
      })}
      className="flex flex-col gap-3.5"
    >
      <Segmented
        label="Transaction type"
        value={type}
        onChange={changeType}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
          { value: 'transfer', label: 'Transfer' },
        ]}
      />

      {compact ? (
        <Controller
          name="amount"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="gap-1.5">
              <FieldLabel htmlFor="tx-amount" className={sectionLabel}>
                Amount (₱)
              </FieldLabel>
              <MoneyInput id="tx-amount" large autoFocus={autoFocusAmount} aria-invalid={fieldState.invalid} {...field} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      ) : (
        <div className="flex flex-col items-center gap-1 py-1.5">
          <p className="text-[13px] font-medium text-muted-foreground">Amount</p>
          <p aria-live="polite" className="money text-[52px] leading-[1.05] font-bold tracking-[-0.02em]">
            ₱{formatAmountText(amount)}
          </p>
          {formState.errors.amount && (
            <p role="alert" className="text-sm text-destructive">
              {formState.errors.amount.message}
            </p>
          )}
        </div>
      )}

      {type === 'expense' && (
        <div className="flex flex-col gap-2">
          <p className={sectionLabel}>Category</p>
          <ChoiceChips
            label="Category"
            shape="pill"
            value={categoryId}
            onChange={(v) => {
              setValue('categoryId', v, { shouldValidate: formState.isSubmitted })
              if (v !== BILLS_CHIP) setValue('fixedBillId', null)
            }}
            options={categoryOptions}
          />
          {formState.errors.categoryId && (
            <p role="alert" className="text-sm text-destructive">
              {formState.errors.categoryId.message}
            </p>
          )}
          {categoryId === BILLS_CHIP && bills.length > 0 && (
            <Controller
              name="fixedBillId"
              control={control}
              render={({ field }) => (
                <div className="flex flex-col gap-2 pt-1">
                  <p className={sectionLabel}>Which bill? (optional)</p>
                  <ChoiceChips
                    label="Bill"
                    shape="pill"
                    scroll
                    value={field.value}
                    onChange={(v) => field.onChange(field.value === v ? null : v)}
                    options={bills.map((b) => ({ value: b.id, label: b.name }))}
                  />
                </div>
              )}
            />
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className={sectionLabel}>{type === 'expense' ? 'Paid with' : type === 'income' ? 'Received in' : 'From'}</p>
        <ChoiceChips
          label={type === 'transfer' ? 'From account' : 'Account'}
          value={accountId}
          onChange={(v) => setValue('accountId', v, { shouldValidate: formState.isSubmitted })}
          options={accountOptions}
        />
        {formState.errors.accountId && (
          <p role="alert" className="text-sm text-destructive">
            {formState.errors.accountId.message}
          </p>
        )}
      </div>

      {type === 'transfer' && (
        <Controller
          name="toAccountId"
          control={control}
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-2">
              <p className={sectionLabel}>To</p>
              <ChoiceChips label="To account" value={field.value} onChange={field.onChange} options={accountOptions} />
              {fieldState.error && (
                <p role="alert" className="text-sm text-destructive">
                  {fieldState.error.message}
                </p>
              )}
              {accounts.find((a) => a.id === field.value)?.type === 'credit_card' && (
                <p className="text-[13px] text-muted-foreground">A card payment is not spending, so it won't count against any category.</p>
              )}
            </div>
          )}
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <Controller
          name="note"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="gap-1.5">
              <FieldLabel htmlFor="tx-note" className={sectionLabel}>
                Note (optional)
              </FieldLabel>
              <TextInput id="tx-note" placeholder={type === 'income' ? 'Salary' : type === 'transfer' ? 'Card payment' : 'Lunch'} className="h-[46px]" {...field} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="date"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="gap-1.5">
              <FieldLabel htmlFor="tx-date" className={sectionLabel}>
                Date
              </FieldLabel>
              <div className="relative">
                <TextInput
                  id="tx-date"
                  type="date"
                  max="2100-12-31"
                  className="peer h-[46px] text-transparent [&::-webkit-datetime-edit]:opacity-0"
                  {...field}
                />
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[15px]">
                  {field.value && isValidISODate(field.value) ? `${isToday ? 'Today, ' : ''}${formatShortDate(field.value)}` : 'Pick a date'}
                </span>
              </div>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </div>

      {type === 'expense' && (
        <Controller
          name="isOneTime"
          control={control}
          render={({ field }) => (
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="tx-onetime" className="flex flex-col items-start gap-0.5">
                <span className="text-[15px] font-semibold">One-time expense</span>
                <span className="text-[13px] font-normal text-muted-foreground">Unusual cost, kept out of your monthly averages</span>
              </Label>
              <Switch id="tx-onetime" checked={field.value} onCheckedChange={field.onChange} />
            </div>
          )}
        />
      )}

      {!compact && <NumberPad onKey={onKey} />}

      {selectedAccount?.type === 'credit_card' && type === 'expense' && (
        <p className="text-[13px] text-muted-foreground">Card purchases count as spending and add to your card bill.</p>
      )}

      <div className={cn('flex gap-2', extraActions ? 'flex-row' : 'flex-col')}>
        {extraActions}
        <Button type="submit" className={cn('h-[54px] rounded-[14px] text-base', extraActions && 'flex-1')} disabled={formState.isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
