import { useCallback, useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { ChevronDown, Delete } from 'lucide-react'
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
import { ChoiceChips, MoneyInput, Segmented, TextInput, type ChoiceOption } from '@/components/inputs'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { moneyField, optionalMoneyField, toCentavos } from '@/lib/forms'
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
    /** Transfers only. Empty means no fee. */
    fee: optionalMoneyField(),
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
    categoryId: isExpense ? (isBill ? null : v.categoryId) : v.type === 'income' ? v.categoryId : null,
    fixedBillId: isBill ? v.fixedBillId : null,
    accountId: v.accountId,
    toAccountId: v.type === 'transfer' ? v.toAccountId : null,
    // Stored only when there is one, so plain transfers stay exactly as before.
    fee: v.type === 'transfer' && toCentavos(v.fee) > 0 ? toCentavos(v.fee) : undefined,
    note: v.note,
    isOneTime: isExpense && v.isOneTime,
  }
}

export function defaultValues(
  accounts: Account[],
  opts: { existing?: Transaction; type?: TransactionType; toAccountId?: string | null; categoryId?: string | null; accountId?: string | null } = {},
): TransactionFormValues {
  const { existing } = opts
  if (existing) {
    return {
      type: existing.type,
      amount: centavosToInput(existing.amount),
      categoryId: existing.type === 'expense' ? (existing.categoryId ?? BILLS_CHIP) : existing.type === 'income' ? existing.categoryId : null,
      fixedBillId: existing.fixedBillId,
      accountId: existing.accountId,
      toAccountId: existing.toAccountId,
      note: existing.note,
      date: existing.date,
      isOneTime: existing.isOneTime,
      fee: existing.type === 'transfer' && existing.fee ? centavosToInput(existing.fee) : '',
    }
  }
  const type = opts.type ?? 'expense'
  const last = safeStorage.get(LAST_ACCOUNT_KEY)
  const firstOf = (t: Account['type']) => accounts.find((a) => a.type === t)?.id
  let accountId = (last && accounts.some((a) => a.id === last) ? last : undefined) ?? firstOf('cash') ?? accounts[0]?.id ?? ''
  let toAccountId: string | null = null
  if (type === 'transfer') {
    toAccountId = opts.toAccountId ?? firstOf('credit_card') ?? null
    accountId = firstOf('bank') ?? firstOf('ewallet') ?? accounts.find((a) => a.id !== toAccountId)?.id ?? ''
  }
  if (type === 'income') accountId = firstOf('bank') ?? firstOf('ewallet') ?? accountId
  // Opened from an account's screen: that account is the one paid with (or paid from).
  if (opts.accountId && accounts.some((a) => a.id === opts.accountId)) {
    accountId = opts.accountId
    if (type === 'transfer' && toAccountId === accountId) toAccountId = accounts.find((a) => a.id !== accountId)?.id ?? null
  }
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
    fee: '',
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

function NumberPad({ onKey, raised = false }: { onKey: (key: string) => void; raised?: boolean }) {
  return (
    <div role="group" aria-label="Number pad" className="grid grid-cols-3 gap-1.5">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onKey(k)}
          aria-label={k === 'del' ? 'Delete last digit' : k === '.' ? 'Decimal point' : k}
          className={cn('flex h-[46px] items-center justify-center rounded-lg font-heading text-[19px] font-semibold text-foreground', raised ? 'bg-muted active:bg-border' : 'bg-card active:bg-muted')}
        >
          {k === 'del' ? <Delete className="size-6" aria-hidden="true" /> : k}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

/**
 * Touch layout: the field whose input shows in the bottom panel, replacing the
 * phone keyboard (number pad for amounts, a grid for categories and accounts).
 * Null when nothing is picked, or a text field is using the system keyboard.
 */
type ActiveField = 'amount' | 'fee' | 'category' | 'account' | 'toAccount' | null

const PANEL_TITLES: Record<Exclude<ActiveField, null>, string> = {
  amount: 'Amount',
  fee: 'Transfer fee',
  category: 'Category',
  account: 'Account',
  toAccount: 'To account',
}

/** One line of the touch form: label on the left, value on the right, like a ledger row. */
function FieldRow({
  label,
  value,
  placeholder,
  active,
  onPress,
  error,
  large = false,
}: {
  label: string
  value: string | null
  placeholder: string
  active: boolean
  onPress: () => void
  error?: string
  large?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-expanded={active}
      className={cn(
        'flex w-full items-center gap-3 px-3.5 text-left transition-colors outline-none focus-visible:bg-muted',
        large ? 'min-h-[54px]' : 'min-h-[46px]',
        active ? 'bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <span className={cn('w-[88px] flex-none text-[12px] font-semibold', active ? 'text-primary' : 'text-muted-foreground')}>{label}</span>
      <span className="flex min-w-0 flex-1 flex-col py-1.5">
        <span
          className={cn(
            'truncate font-semibold',
            large ? 'money text-[23px] leading-tight' : 'text-[13px]',
            !value && 'text-muted-foreground',
          )}
        >
          {value ?? placeholder}
        </span>
        {error && (
          <span role="alert" className="text-[12px] font-normal text-destructive">
            {error}
          </span>
        )}
      </span>
    </button>
  )
}

/** Options for the bottom panel: a fixed grid that fits without scrolling. */
function PanelGrid<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T | null
  onChange: (v: T) => void
  options: ChoiceOption<T>[]
}) {
  return <ChoiceChips label={label} value={value} onChange={onChange} options={options} columns={options.length > 6 ? 4 : 3} className="gap-1.5 [&>button]:px-2 [&>button]:text-[12px]" />
}

const sectionLabel = 'text-[12px] font-semibold text-muted-foreground'

interface TransactionFormProps {
  accounts: Account[]
  categories: Category[]
  bills: FixedBill[]
  initial: TransactionFormValues
  onSubmit: (values: TransactionFormValues) => Promise<void> | void
  /** Edit mode / mouse devices: plain fields and chips instead of the bottom panel. */
  compact?: boolean
  submitLabel?: string
  extraActions?: React.ReactNode
  /** Extra rows shown above the save button (Add only: the Repeat row). */
  extraFields?: React.ReactNode
  /** Focus the amount field on open (keyboard devices). */
  autoFocusAmount?: boolean
  /** Touch layout: the bottom panel shown on open (null starts with it closed). */
  initialField?: ActiveField
  /** Background behind the sticky bottom panel: the page, or a drawer/sheet. */
  surface?: 'background' | 'popover'
}

export function TransactionForm({
  accounts,
  categories,
  bills,
  initial,
  onSubmit,
  compact = false,
  submitLabel = 'Save',
  extraActions,
  extraFields,
  autoFocusAmount = false,
  initialField = 'amount',
  surface = 'background',
}: TransactionFormProps) {
  const form = useForm<TransactionFormValues>({ resolver: zodResolver(schema), defaultValues: initial })
  const { control, setValue, handleSubmit, formState } = form
  const type = useWatch({ control, name: 'type' })
  const amount = useWatch({ control, name: 'amount' })
  const fee = useWatch({ control, name: 'fee' })
  const categoryId = useWatch({ control, name: 'categoryId' })
  const fixedBillId = useWatch({ control, name: 'fixedBillId' })
  const accountId = useWatch({ control, name: 'accountId' })
  const toAccountId = useWatch({ control, name: 'toAccountId' })
  const date = useWatch({ control, name: 'date' })
  const formRef = useRef<HTMLFormElement>(null)
  // Touch layout only: which field's input shows in the bottom panel.
  const [activeField, setActiveField] = useState<ActiveField>(initialField)
  const padTarget = activeField === 'fee' ? 'fee' : activeField === 'amount' ? 'amount' : null

  const onKey = useCallback(
    (key: string) => {
      if (!padTarget) return
      setValue(padTarget, pressKey(form.getValues(padTarget), key), { shouldValidate: formState.isSubmitted, shouldDirty: true })
    },
    [form, setValue, formState.isSubmitted, padTarget],
  )

  // Desktop keyboard input for the number pad.
  useEffect(() => {
    if (compact || !padTarget) return
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
  }, [compact, onKey, padTarget])

  const changeType = (t: TransactionType) => {
    setValue('type', t)
    const firstOf = (k: Account['type']) => accounts.find((a) => a.type === k)?.id
    if (t === 'transfer' && !form.getValues('toAccountId')) {
      const to = firstOf('credit_card') ?? accounts.find((a) => a.id !== form.getValues('accountId'))?.id ?? null
      setValue('toAccountId', to)
      if (to === form.getValues('accountId')) setValue('accountId', firstOf('bank') ?? firstOf('ewallet') ?? accounts.find((a) => a.id !== to)?.id ?? '')
    }
    // Income and expense categories are separate lists.
    const current = form.getValues('categoryId')
    const cat = categories.find((c) => c.id === current)
    const fits = t === 'income' ? cat?.kind === 'income' : t === 'expense' ? current === BILLS_CHIP || (!!cat && cat.kind !== 'income') : false
    if (!fits) {
      setValue('categoryId', null)
      setValue('fixedBillId', null)
    }
    form.clearErrors()
    setActiveField('amount')
  }

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }))
  // Loans are paid into, never spent from or paid into as income.
  const sourceOptions = type === 'transfer' ? accountOptions : accounts.filter((a) => a.type !== 'loan' && a.type !== 'debt').map((a) => ({ value: a.id, label: a.name }))
  const categoryOptions =
    type === 'income'
      ? categories.filter((c) => c.kind === 'income' && !c.archived).map((c) => ({ value: c.id, label: c.name }))
      : [
          ...categories.filter((c) => c.kind !== 'income' && !c.archived).map((c) => ({ value: c.id, label: c.name })),
          { value: BILLS_CHIP, label: 'Bills' },
        ]
  const isToday = date === todayISO()
  const selectedAccount = accounts.find((a) => a.id === accountId)
  const toAccount = accounts.find((a) => a.id === toAccountId)

  /** After a pick, move to the next field still empty (amount, then category), else close the panel. */
  const advance = () => {
    const v = form.getValues()
    if (v.amount === '') return setActiveField('amount')
    if (v.type === 'expense' && !v.categoryId) return setActiveField('category')
    setActiveField(null)
  }

  const pickCategory = (v: string) => {
    if (type === 'income') {
      setValue('categoryId', categoryId === v ? null : v, { shouldValidate: formState.isSubmitted, shouldDirty: true })
      advance()
      return
    }
    setValue('categoryId', v, { shouldValidate: formState.isSubmitted, shouldDirty: true })
    if (v === BILLS_CHIP) {
      if (bills.length === 0) advance()
    } else {
      setValue('fixedBillId', null)
      advance()
    }
  }
  const pickBill = (v: string) => {
    setValue('fixedBillId', fixedBillId === v ? null : v, { shouldDirty: true })
    advance()
  }
  const pickAccount = (v: string) => {
    setValue('accountId', v, { shouldValidate: formState.isSubmitted, shouldDirty: true })
    advance()
  }
  const pickToAccount = (v: string) => {
    setValue('toAccountId', v, { shouldValidate: formState.isSubmitted, shouldDirty: true })
    advance()
  }

  const categoryValue = categoryId === BILLS_CHIP ? 'Bills' : (categories.find((c) => c.id === categoryId)?.name ?? null)
  const billName = categoryId === BILLS_CHIP ? bills.find((b) => b.id === fixedBillId)?.name : undefined
  const accountLabel = type === 'expense' ? 'Paid with' : type === 'income' ? 'Received in' : 'From'
  const cardHint = toAccount?.type === 'credit_card' && type === 'transfer' && (
    <p className="text-[12px] text-muted-foreground">A card payment is not spending, so it won't count against any category.</p>
  )
  const purchaseHint = selectedAccount?.type === 'credit_card' && type === 'expense' && (
    <p className="text-[12px] text-muted-foreground">Card purchases count as spending and add to your card bill.</p>
  )

  const typeSwitch = (
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
  )

  const oneTime = type === 'expense' && (
    <Controller
      name="isOneTime"
      control={control}
      render={({ field }) => (
        <div className={cn('flex min-h-11 items-center justify-between gap-3', !compact && 'px-3.5 py-1.5')}>
          <Label htmlFor="tx-onetime" className="flex flex-col items-start gap-0.5">
            <span className={cn('font-semibold', compact ? 'text-[13px]' : 'text-[12px] text-muted-foreground')}>One-time expense</span>
            {compact && <span className="text-[12px] font-normal text-muted-foreground">Unusual cost, kept out of your monthly averages</span>}
          </Label>
          <Switch id="tx-onetime" checked={field.value} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  )

  const submit = handleSubmit(async (v) => {
    rememberAccount(v.accountId)
    await onSubmit(v)
  })

  if (!compact) {
    // Touch layout: compact ledger rows on top, and a bottom panel that swaps
    // between the number pad and option grids depending on the tapped row.
    return (
      <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-3">
        {typeSwitch}

        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
          <Controller
            name="date"
            control={control}
            render={({ field, fieldState }) => (
              <label className="relative flex min-h-[46px] items-center gap-3 px-3.5">
                <span className="w-[88px] flex-none text-[12px] font-semibold text-muted-foreground">Date</span>
                <span className={cn('flex-1 text-[13px] font-semibold', fieldState.invalid && 'text-destructive')}>
                  {field.value && isValidISODate(field.value) ? `${isToday ? 'Today, ' : ''}${formatShortDate(field.value)}` : 'Pick a date'}
                </span>
                <input
                  id="tx-date"
                  type="date"
                  max="2100-12-31"
                  aria-label="Date"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onFocus={() => setActiveField(null)}
                  {...field}
                />
              </label>
            )}
          />
          <FieldRow
            label="Amount"
            large
            value={`₱${formatAmountText(amount)}`}
            placeholder=""
            active={activeField === 'amount'}
            onPress={() => setActiveField('amount')}
            error={formState.errors.amount?.message}
          />
          {type !== 'transfer' && (
            <FieldRow
              label="Category"
              value={billName ? `Bills · ${billName}` : categoryValue}
              placeholder={type === 'income' ? 'Optional' : 'Choose'}
              active={activeField === 'category'}
              onPress={() => setActiveField('category')}
              error={formState.errors.categoryId?.message}
            />
          )}
          <FieldRow
            label={accountLabel}
            value={selectedAccount?.name ?? null}
            placeholder="Choose"
            active={activeField === 'account'}
            onPress={() => setActiveField('account')}
            error={formState.errors.accountId?.message}
          />
          {type === 'transfer' && (
            <>
              <FieldRow
                label="To"
                value={toAccount?.name ?? null}
                placeholder="Choose"
                active={activeField === 'toAccount'}
                onPress={() => setActiveField('toAccount')}
                error={formState.errors.toAccountId?.message}
              />
              <FieldRow
                label="Fee"
                value={fee ? `₱${formatAmountText(fee)}` : null}
                placeholder="None"
                active={activeField === 'fee'}
                onPress={() => setActiveField('fee')}
                error={formState.errors.fee?.message}
              />
            </>
          )}
          <Controller
            name="note"
            control={control}
            render={({ field, fieldState }) => (
              <label className="flex min-h-[46px] items-center gap-3 px-3.5">
                <span className="w-[88px] flex-none text-[12px] font-semibold text-muted-foreground">Note</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <input
                    id="tx-note"
                    autoComplete="off"
                    enterKeyHint="done"
                    placeholder={type === 'income' ? 'Salary' : type === 'transfer' ? 'Card payment' : 'Lunch'}
                    className="h-[44px] w-full bg-transparent text-[13px] font-semibold outline-none placeholder:font-normal placeholder:text-muted-foreground"
                    onFocus={() => setActiveField(null)}
                    {...field}
                  />
                  {fieldState.error && (
                    <span role="alert" className="pb-1.5 text-[12px] text-destructive">
                      {fieldState.error.message}
                    </span>
                  )}
                </span>
              </label>
            )}
          />
          {oneTime}
        </div>

        {extraFields}
        {cardHint}
        {purchaseHint}

        <div
          className={cn(
            'sticky bottom-0 mt-auto flex flex-col gap-2.5 border-t border-border pt-2.5',
            surface === 'popover' ? 'bg-popover pb-0' : 'bg-background pb-[calc(10px+env(safe-area-inset-bottom))]',
          )}
        >
          {activeField && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className={sectionLabel}>{activeField === 'account' ? accountLabel : PANEL_TITLES[activeField]}</p>
                <button
                  type="button"
                  onClick={() => setActiveField(null)}
                  aria-label="Close panel"
                  className="-mr-2 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <ChevronDown className="size-5" aria-hidden="true" />
                </button>
              </div>
              <div className="min-h-[202px]">
              {padTarget && <NumberPad onKey={onKey} raised={surface === 'popover'} />}
              {activeField === 'category' && (
                <div className="flex flex-col gap-2">
                  <PanelGrid label="Category" value={categoryId} onChange={pickCategory} options={categoryOptions} />
                  {categoryId === BILLS_CHIP && bills.length > 0 && (
                    <>
                      <p className={sectionLabel}>Which bill? (optional)</p>
                      <PanelGrid label="Bill" value={fixedBillId} onChange={pickBill} options={bills.map((b) => ({ value: b.id, label: b.name }))} />
                    </>
                  )}
                </div>
              )}
              {activeField === 'account' && <PanelGrid label={type === 'transfer' ? 'From account' : 'Account'} value={accountId} onChange={pickAccount} options={sourceOptions} />}
              {activeField === 'toAccount' && <PanelGrid label="To account" value={toAccountId} onChange={pickToAccount} options={accountOptions} />}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            {extraActions}
            <Button type="submit" className="h-[50px] flex-1 rounded-[14px] text-base" disabled={formState.isSubmitting}>
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    )
  }

  return (
    <form ref={formRef} noValidate onSubmit={submit} className="flex flex-col gap-3.5">
      {typeSwitch}

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

      {type !== 'transfer' && (
        <div className="flex flex-col gap-2">
          <p className={sectionLabel}>{type === 'income' ? 'Category (optional)' : 'Category'}</p>
          <ChoiceChips label="Category" shape="pill" value={categoryId} onChange={pickCategory} options={categoryOptions} />
          {formState.errors.categoryId && (
            <p role="alert" className="text-sm text-destructive">
              {formState.errors.categoryId.message}
            </p>
          )}
          {categoryId === BILLS_CHIP && bills.length > 0 && (
            <div className="flex flex-col gap-2 pt-1">
              <p className={sectionLabel}>Which bill? (optional)</p>
              <ChoiceChips label="Bill" shape="pill" scroll value={fixedBillId} onChange={pickBill} options={bills.map((b) => ({ value: b.id, label: b.name }))} />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <p className={sectionLabel}>{accountLabel}</p>
        <ChoiceChips label={type === 'transfer' ? 'From account' : 'Account'} value={accountId} onChange={pickAccount} options={sourceOptions} />
        {formState.errors.accountId && (
          <p role="alert" className="text-sm text-destructive">
            {formState.errors.accountId.message}
          </p>
        )}
      </div>

      {type === 'transfer' && (
        <div className="flex flex-col gap-2">
          <p className={sectionLabel}>To</p>
          <ChoiceChips label="To account" value={toAccountId} onChange={pickToAccount} options={accountOptions} />
          {formState.errors.toAccountId && (
            <p role="alert" className="text-sm text-destructive">
              {formState.errors.toAccountId.message}
            </p>
          )}
          {cardHint}
        </div>
      )}

      {type === 'transfer' && (
        <Controller
          name="fee"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="gap-1.5">
              <FieldLabel htmlFor="tx-fee" className={sectionLabel}>
                Transfer fee (optional)
              </FieldLabel>
              <MoneyInput id="tx-fee" placeholder="0" className="h-[46px]" aria-describedby="tx-fee-help" aria-invalid={fieldState.invalid} {...field} />
              <p id="tx-fee-help" className="text-[12px] text-muted-foreground">
                Charged on top, like an InstaPay or cash-in fee. It comes out of the &ldquo;From&rdquo; account and counts as spending.
              </p>
              <FieldError errors={[fieldState.error]} />
            </Field>
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
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[13px]">
                  {field.value && isValidISODate(field.value) ? `${isToday ? 'Today, ' : ''}${formatShortDate(field.value)}` : 'Pick a date'}
                </span>
              </div>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </div>

      {oneTime}
      {extraFields}
      {purchaseHint}

      <div className={cn('flex gap-2', extraActions ? 'flex-row' : 'flex-col')}>
        {extraActions}
        <Button type="submit" className={cn('h-[54px] rounded-[14px] text-base', extraActions && 'flex-1')} disabled={formState.isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
