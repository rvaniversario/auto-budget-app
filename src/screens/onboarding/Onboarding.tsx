import { useEffect, useState, type ReactNode } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  centavosToInput,
  formatMoney,
  formatPeriod,
  getBudgetPeriod,
  parseMoney,
  todayISO,
  type Account,
  type Category,
  type FixedBill,
  type Settings,
  type SpendingEstimate,
} from '@/core'
import { repo } from '@/data'
import { Column } from '@/components/AppShell'
import { BillDialog, BillsList } from '@/components/BillDialog'
import { DashedButton } from '@/components/layout'
import { MoneyInput, TextInput } from '@/components/inputs'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { dayField, moneyField, optionalMoneyField, toCentavos } from '@/lib/forms'
import { cn } from '@/lib/utils'
import { cloudEnabled } from '@/sync'

const TOTAL_STEPS = 4

function Frame({
  step,
  title,
  description,
  children,
  footer,
}: {
  step: number
  title: string
  description: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <Column className="sm:items-center sm:justify-center sm:px-6 sm:py-10">
      <div className="flex flex-1 flex-col gap-6 px-5 pt-7 pb-[calc(24px+env(safe-area-inset-bottom))] sm:w-full sm:max-w-[560px] sm:flex-none sm:rounded-hero sm:bg-card sm:p-8 sm:shadow-[0_1px_3px_rgba(20,32,27,0.08)]">
        <div className="flex flex-col gap-2.5">
          <p className="text-[13px] font-semibold text-muted-foreground">
            Step {step} of {TOTAL_STEPS}
          </p>
          <div role="img" aria-label={`Setup progress, step ${step} of ${TOTAL_STEPS}`} className="grid grid-cols-4 gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <div key={i} className={cn('h-1.5 rounded-[3px]', i < step ? 'bg-primary' : 'bg-step-off')} />
            ))}
          </div>
        </div>
        <header className="flex flex-col gap-2">
          <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.01em]">{title}</h1>
          <p className="text-[15px] leading-normal text-muted-foreground">{description}</p>
        </header>
        <div className="flex flex-1 flex-col gap-4">{children}</div>
        {footer}
      </div>
    </Column>
  )
}

function FooterButtons({
  onBack,
  next,
  nextDisabled,
  onNext,
}: {
  onBack?: () => void
  next: string
  nextDisabled?: boolean
  /** When given, Continue is a plain button instead of submitting a form. */
  onNext?: () => void
}) {
  return (
    <div className={cn('grid gap-3', onBack ? 'grid-cols-2' : 'grid-cols-1')}>
      {onBack && (
        <Button type="button" variant="outline" className="h-[54px] rounded-[14px] bg-card text-base" onClick={onBack}>
          Back
        </Button>
      )}
      <Button
        type={onNext ? 'button' : 'submit'}
        onClick={onNext}
        className="h-[54px] rounded-[14px] text-base"
        disabled={nextDisabled}
      >
        {next}
      </Button>
    </div>
  )
}

const labelClass = 'text-sm font-semibold'

// ---------------------------------------------------------------------------
// Step 1: salary and payday
// ---------------------------------------------------------------------------

const salarySchema = z.object({
  salary: moneyField({ message: 'Enter your take-home salary' }),
  payday: dayField,
})

function SalaryStep({ settings, onNext }: { settings: Settings | undefined; onNext: () => void }) {
  const form = useForm<z.infer<typeof salarySchema>>({
    resolver: zodResolver(salarySchema),
    defaultValues: {
      salary: settings?.monthlySalary ? centavosToInput(settings.monthlySalary) : '',
      payday: String(settings?.paydayDay ?? 30),
    },
  })
  const payday = useWatch({ control: form.control, name: 'payday' })
  const paydayNum = Number(payday)
  const preview = Number.isInteger(paydayNum) && paydayNum >= 1 && paydayNum <= 31 ? getBudgetPeriod(todayISO(), paydayNum) : null

  const onSubmit = async (v: z.infer<typeof salarySchema>) => {
    await repo.saveSettings({ monthlySalary: toCentavos(v.salary), paydayDay: Number(v.payday), payFrequency: 'monthly' })
    onNext()
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="contents">
      <Frame
        step={1}
        title="When and how much do you get paid?"
        description="Your budget month runs from one payday to the next, so it matches the money you actually have."
        footer={<FooterButtons next="Continue" />}
      >
        <div className="flex flex-col gap-[18px]">
          <Controller
            name="salary"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1.5">
                <FieldLabel htmlFor="os-salary" className={labelClass}>
                  Take-home salary (₱)
                </FieldLabel>
                <MoneyInput id="os-salary" large autoFocus aria-invalid={fieldState.invalid} aria-describedby="os-salary-help" {...field} />
                <FieldDescription id="os-salary-help" className="text-[13px]">
                  The amount that reaches your account after tax and deductions.
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <div className="flex flex-col gap-2">
            <span id="os-freq-label" className={labelClass}>
              How often are you paid?
            </span>
            <div role="group" aria-labelledby="os-freq-label" className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed="true"
                className="h-[52px] rounded-lg border border-primary bg-primary text-[15px] font-semibold text-primary-foreground"
              >
                Monthly
              </button>
              <button
                type="button"
                aria-pressed="false"
                disabled
                aria-describedby="os-freq-soon"
                className="flex h-[52px] flex-col items-center justify-center rounded-lg border border-input bg-card text-[15px] font-semibold text-foreground opacity-60"
              >
                Twice a month
                <span id="os-freq-soon" className="text-[11px] font-medium text-muted-foreground">
                  Coming soon
                </span>
              </button>
            </div>
          </div>

          <Controller
            name="payday"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1.5">
                <FieldLabel htmlFor="os-payday" className={labelClass}>
                  Payday (day of the month)
                </FieldLabel>
                <TextInput id="os-payday" inputMode="numeric" maxLength={2} aria-invalid={fieldState.invalid} {...field} />
                {paydayNum > 28 && !fieldState.invalid && (
                  <FieldDescription className="text-[13px]">In shorter months we use the last day of the month.</FieldDescription>
                )}
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          {preview && (
            <div className="flex flex-col gap-1 rounded-lg bg-success-tint p-3.5" aria-live="polite">
              <span className="text-[13px]">Your first budget month</span>
              <span className="money text-lg font-bold text-success-text">{formatPeriod(preview)}</span>
            </div>
          )}

          {cloudEnabled && (
            <p className="text-center text-sm text-muted-foreground">
              Already use Auto Budget on another device?{' '}
              <Link to="/account/sign-in" className="font-semibold text-link underline-offset-2 hover:underline">
                Sign in to restore it
              </Link>
            </p>
          )}
        </div>
      </Frame>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Step 2: fixed bills
// ---------------------------------------------------------------------------

function BillsStep({ bills, onBack, onNext }: { bills: FixedBill[]; onBack: () => void; onNext: () => void }) {
  const [editing, setEditing] = useState<FixedBill | undefined>()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Frame
        step={2}
        title="Which bills do you pay every month?"
        description="We set these aside first, before anything else. Leave out your credit card; that comes next."
        footer={<FooterButtons onBack={onBack} onNext={onNext} next={bills.length ? 'Continue' : 'Skip for now'} />}
      >
        <BillsList
          bills={bills}
          onEdit={(b) => {
            setEditing(b)
            setOpen(true)
          }}
        />
        <DashedButton
          onClick={() => {
            setEditing(undefined)
            setOpen(true)
          }}
        >
          Add a bill
        </DashedButton>
      </Frame>
      <BillDialog open={open} onOpenChange={setOpen} bill={editing} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Step 3: credit card
// ---------------------------------------------------------------------------

const cardSchema = z.object({
  name: z.string().trim().min(1, 'Give the card a name').max(40),
  balance: moneyField({ message: 'Enter your current bill total' }),
  minimum: moneyField({ allowZero: true, message: 'Enter the minimum due' }),
  dueDay: dayField,
  rate: z
    .string()
    .trim()
    .refine((v) => /^\d+(\.\d+)?$/.test(v) && Number(v) >= 0 && Number(v) <= 10, 'Enter a rate between 0 and 10'),
})

function CardStep({ card, onBack, onNext }: { card: Account | undefined; onBack: () => void; onNext: () => void }) {
  const form = useForm<z.infer<typeof cardSchema>>({
    resolver: zodResolver(cardSchema),
    defaultValues: {
      name: card?.name ?? 'My credit card',
      balance: card ? centavosToInput(card.openingBalance) : '',
      minimum: card?.minimumDue != null ? centavosToInput(card.minimumDue) : '',
      dueDay: card?.dueDay ? String(card.dueDay) : '',
      rate: card?.monthlyInterestRate != null ? String(card.monthlyInterestRate) : '3',
    },
  })

  const onSubmit = async (v: z.infer<typeof cardSchema>) => {
    const data = {
      name: v.name,
      openingBalance: toCentavos(v.balance),
      minimumDue: toCentavos(v.minimum),
      dueDay: Number(v.dueDay),
      monthlyInterestRate: Number(v.rate),
    }
    if (card) await repo.updateAccount(card.id, data)
    else await repo.addAccount({ ...data, type: 'credit_card', statementDay: null })
    onNext()
  }

  const skip = async () => {
    if (card) await repo.deleteAccount(card.id)
    onNext()
  }

  const fieldFor = (name: keyof z.infer<typeof cardSchema>, label: string, input: (props: object) => ReactNode, help?: string) => (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid} className="gap-1.5">
          <FieldLabel htmlFor={`ob-${name}`} className={labelClass}>
            {label}
          </FieldLabel>
          {input({ id: `ob-${name}`, 'aria-invalid': fieldState.invalid, ...(help ? { 'aria-describedby': `ob-${name}-help` } : {}), ...field })}
          {help && (
            <FieldDescription id={`ob-${name}-help`} className="text-[13px]">
              {help}
            </FieldDescription>
          )}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  )

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="contents">
      <Frame
        step={3}
        title="Tell us about your credit card"
        description="We use these to work out how much you can safely pay each month. You can find them on your statement."
        footer={
          <div className="flex flex-col gap-1">
            <FooterButtons onBack={onBack} next="Continue" />
            <button type="button" onClick={skip} className="flex min-h-11 items-center justify-center text-sm font-semibold text-link">
              I don't have a credit card
            </button>
          </div>
        }
      >
        {fieldFor('name', 'Card nickname', (p) => <TextInput {...p} />)}
        {fieldFor('balance', 'Current bill total (₱)', (p) => <MoneyInput {...p} />)}
        <div className="grid grid-cols-2 gap-3">
          {fieldFor('minimum', 'Minimum due (₱)', (p) => <MoneyInput {...p} />)}
          {fieldFor('dueDay', 'Due day each month', (p) => <TextInput inputMode="numeric" maxLength={2} {...p} />)}
        </div>
        {fieldFor(
          'rate',
          'Monthly interest rate (%)',
          (p) => <TextInput inputMode="decimal" {...p} />,
          'Used to estimate interest on any amount you do not pay this month. Most cards in the Philippines charge up to 3% a month.',
        )}
      </Frame>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Step 4: spending estimates
// ---------------------------------------------------------------------------

function SpendingStep({
  categories,
  estimates,
  onBack,
}: {
  categories: Category[]
  estimates: SpendingEstimate[]
  onBack: () => void
}) {
  const active = categories.filter((c) => !c.archived)
  const schema = z.object({ amounts: z.record(z.string(), optionalMoneyField()) })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      amounts: Object.fromEntries(
        active.map((c) => {
          const e = estimates.find((x) => x.categoryId === c.id)
          return [c.id, e ? centavosToInput(e.amount) : '']
        }),
      ),
    },
  })
  const amounts = useWatch({ control: form.control, name: 'amounts' })
  const total = Object.values(amounts ?? {}).reduce((acc, v) => acc + (parseMoney(v ?? '') ?? 0), 0)

  const onSubmit = async (v: z.infer<typeof schema>) => {
    for (const c of active) await repo.setSpendingEstimate(c.id, toCentavos(v.amounts[c.id] ?? ''))
    const accounts = await repo.listAccounts()
    if (!accounts.some((a) => a.type === 'cash')) {
      await repo.addAccount({ name: 'Cash', type: 'cash', openingBalance: 0, statementDay: null, dueDay: null, minimumDue: null, monthlyInterestRate: null })
    }
    if (!accounts.some((a) => a.type === 'bank')) {
      await repo.addAccount({ name: 'Bank', type: 'bank', openingBalance: 0, statementDay: null, dueDay: null, minimumDue: null, monthlyInterestRate: null })
    }
    await repo.saveSettings({ onboardingComplete: true })
    toast.success('Your budget is ready')
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="contents">
      <Frame
        step={4}
        title="Roughly, what do you spend in a month?"
        description="Guesses are fine. After your first month we replace them with your real spending."
        footer={<FooterButtons onBack={onBack} next="Build my budget" nextDisabled={form.formState.isSubmitting} />}
      >
        <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
          {active.map((c) => (
            <Controller
              key={c.id}
              name={`amounts.${c.id}`}
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid} className="gap-1.5">
                  <FieldLabel htmlFor={`sp-${c.id}`} className={labelClass}>
                    {c.name} (₱)
                  </FieldLabel>
                  <MoneyInput id={`sp-${c.id}`} aria-invalid={fieldState.invalid} {...field} value={field.value ?? ''} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          ))}
        </div>
        <div className="flex items-baseline justify-between rounded-lg bg-success-tint p-3.5" aria-live="polite">
          <span className="text-sm">Estimated monthly spending</span>
          <span className="money text-xl font-bold text-success-text">{formatMoney(total)}</span>
        </div>
      </Frame>
    </form>
  )
}

// ---------------------------------------------------------------------------

export function Onboarding() {
  const [step, setStep] = useState(1)
  const data = useLiveQuery(async () => ({
    settings: await repo.getSettings(),
    bills: await repo.listFixedBills(),
    categories: await repo.listCategories(),
    accounts: await repo.listAccounts(),
    estimates: await repo.listSpendingEstimates(),
  }))

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  if (!data) return <div className="min-h-dvh bg-background" aria-busy="true" />

  const card = data.accounts.find((a) => a.type === 'credit_card')
  switch (step) {
    case 1:
      return <SalaryStep settings={data.settings} onNext={() => setStep(2)} />
    case 2:
      return <BillsStep bills={data.bills} onBack={() => setStep(1)} onNext={() => setStep(3)} />
    case 3:
      return <CardStep card={card} onBack={() => setStep(2)} onNext={() => setStep(4)} />
    default:
      return <SpendingStep categories={data.categories} estimates={data.estimates} onBack={() => setStep(3)} />
  }
}
