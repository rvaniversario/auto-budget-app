import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Archive, ArchiveRestore, ChevronRight, Sparkles } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  addDays,
  alive,
  budgetPeriodFor,
  centavosToInput,
  formatDayHeading,
  formatLongDate,
  formatMoney,
  formatWeekdays,
  monthPaydays,
  monthStartIsPayday,
  ordinal,
  parseISODate,
  payWeekday,
  paydayShift,
  secondPayday,
  todayISO,
  weekdayName,
  weekdayOf,
  workWeekdays,
  MAX_PAYDAY_SHIFT_DAYS,
  PAY_FREQUENCY_LABEL,
  type Category,
  type CategoryKind,
  type FixedBill,
  type ISODate,
  type MonthPayday,
  type Settings,
  type ThemePreference,
  type YearMonth,
} from '@/core'
import { repo } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { useIsLg } from '@/hooks/useMedia'
import { cn } from '@/lib/utils'
import { BillDialog, BillsList } from '@/components/BillDialog'
import { DashedButton, RowButton, SectionLabel, SubHeader, TabHeader } from '@/components/layout'
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { forgetLastBackupFile, lastBackupFile } from '@/lib/backupFile'
import { backupStatus, cloudEnabled, useSync } from '@/sync'
import { moneyField, toCentavos } from '@/lib/forms'
import { savePaySettings } from '@/lib/paySettings'
import { PayScheduleFields, payFormDefaults, payFormSchema, payFormToSettings, type PayForm } from '@/components/PayScheduleFields'
import { premiumEnabled, useEntitlement } from '@/premium'
import { PremiumBadge } from '@/premium/components'

type Open = 'pay' | 'dates' | 'buffer' | 'delete' | null

type SectionId = 'budget' | 'categories' | 'bills' | 'data' | 'appearance'
const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'budget', label: 'Budget' },
  { id: 'categories', label: 'Categories' },
  { id: 'bills', label: 'Fixed bills' },
  { id: 'data', label: 'Your data' },
  { id: 'appearance', label: 'Appearance' },
]

export function SettingsScreen() {
  const { snapshot } = useAppData()
  const navigate = useNavigate()
  const { settings } = snapshot
  const [open, setOpen] = useState<Open>(null)
  const lastBackup = lastBackupFile()
  const sync = useSync()
  const ent = useEntitlement()

  const categories = alive(snapshot.categories)
  const bills = alive(snapshot.fixedBills)
  const close = () => setOpen(null)
  const today = todayISO()
  const upcoming = monthPaydays(settings, today, 0, 13)
  const nextPayday = upcoming.find((p) => p.actual > today)
  const movedCount = upcoming.filter((p) => p.moved && p.actual >= budgetPeriodFor(settings, today).start).length

  const setTheme = (theme: ThemePreference) => repo.saveSettings({ theme })
  const isLg = useIsLg()
  const [params, setParams] = useSearchParams()
  const requested = params.get('section') as SectionId | null
  const section: SectionId = requested && SECTIONS.some((x) => x.id === requested) ? requested : 'budget'

  const go = (id: SectionId) => {
    if (isLg) setParams({ section: id }, { replace: true })
    else if (id === 'categories' || id === 'bills') navigate(`/settings/${id}`)
  }

  const budgetSection = (
    <section aria-label="Budget settings" className="flex flex-col rounded-card bg-card px-4 py-3 md:px-5">
      <SectionLabel className="my-1">Budget</SectionLabel>
      <RowButton first label="Pay frequency" value={PAY_FREQUENCY_LABEL[settings.payFrequency]} onClick={() => setOpen('pay')} />
      {paydayRows(settings).map((r) => (
        <RowButton key={r.label} label={r.label} value={r.value} onClick={() => setOpen('pay')} />
      ))}
      {monthStartIsPayday(settings.payFrequency) && (
        <RowButton
          label="Payday dates"
          description={nextPayday ? `Next: ${formatDayHeading(nextPayday.actual)}${nextPayday.moved ? ' (moved)' : ''}` : undefined}
          value={movedCount ? `${movedCount} moved` : 'As scheduled'}
          onClick={() => setOpen('dates')}
        />
      )}
      <RowButton label="Categories" value={String(categories.filter((c) => !c.archived).length)} onClick={() => go('categories')} />
      <RowButton label="Fixed bills" value={`${bills.length} bill${bills.length === 1 ? '' : 's'}`} onClick={() => go('bills')} />
      <RowButton label="Buffer amount" value={formatMoney(settings.bufferAmount)} onClick={() => setOpen('buffer')} />
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-t border-border py-2">
        <Label htmlFor="safe-to-pay" className="flex flex-col items-start gap-0.5">
          <span className="text-[15px] font-semibold">Safe to pay on your credit card</span>
          <span className="text-[13px] font-normal text-muted-foreground">
            Each month, set aside what you can safely pay on your cards and show it on Home
          </span>
        </Label>
        <Switch
          id="safe-to-pay"
          checked={settings.safePaymentEnabled === true}
          onCheckedChange={(v) => void repo.saveSettings({ safePaymentEnabled: v })}
        />
      </div>
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-t border-border py-2">
        <Label htmlFor="carry-over" className="flex flex-col items-start gap-0.5">
          <span className="text-[15px] font-semibold">Carry-over</span>
          <span className="text-[13px] font-normal text-muted-foreground">
            Add what was left from earlier months to this month, or take away what was overspent
          </span>
        </Label>
        <Switch
          id="carry-over"
          checked={settings.carryOverEnabled === true}
          onCheckedChange={(v) => void repo.saveSettings({ carryOverEnabled: v })}
        />
      </div>
      {premiumEnabled && (
        <RowButton
          label={
            <span className="flex items-center gap-2">
              Recurring transactions
              {!ent.isPremium && <PremiumBadge />}
            </span>
          }
          value={ent.isPremium ? String(alive(snapshot.recurringTemplates ?? []).length) : undefined}
          onClick={() => navigate('/recurring')}
        />
      )}
    </section>
  )

  const dataSection = (
    <section aria-label="Data settings" className="flex flex-col rounded-card bg-card px-4 py-3 md:px-5">
      <SectionLabel className="my-1">Your data</SectionLabel>
      <RowButton
        first
        label="Backup and restore"
        description={lastBackup ? `Backup file saved ${formatLongDate(lastBackup.date)}` : 'Backup file. No backup saved yet.'}
        onClick={() => navigate('/backup')}
        trailing={<ChevronRight className="size-[18px] flex-none text-muted-foreground" aria-hidden="true" />}
      />
      {cloudEnabled && <SyncRow />}
    </section>
  )

  const appSection = (
    <section aria-label="App settings" className="flex flex-col gap-3 rounded-card bg-card px-4 py-3 md:px-5">
      <div className="flex flex-col gap-2 pt-1">
        <span id="appearance-label" className="text-[15px] font-semibold">
          Appearance
        </span>
        <Segmented
          label="Appearance"
          value={settings.theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
      </div>
      <RowButton label="Delete all my data" danger onClick={() => setOpen('delete')} />
    </section>
  )

  return (
    <>
      <TabHeader title="Settings" />
      <PremiumCard />

      {isLg ? (
        <div className="flex items-start gap-6">
          <nav aria-label="Settings sections" className="sticky top-8 flex w-56 flex-none flex-col gap-1 rounded-card bg-card p-2">
            {SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                aria-current={section === sec.id ? 'page' : undefined}
                onClick={() => go(sec.id)}
                className={cn(
                  'flex min-h-11 items-center rounded-[10px] px-3 text-left text-[15px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  section === sec.id ? 'bg-success-tint text-success-text' : 'hover:bg-muted',
                )}
              >
                {sec.label}
              </button>
            ))}
          </nav>
          <div className="flex max-w-2xl min-w-0 flex-1 flex-col gap-4">
            {section === 'budget' && budgetSection}
            {section === 'categories' && <CategoriesPanel />}
            {section === 'bills' && <BillsPanel />}
            {section === 'data' && dataSection}
            {section === 'appearance' && appSection}
          </div>
        </div>
      ) : (
        <>
          {budgetSection}
          {dataSection}
          {appSection}
        </>
      )}

      <p className="text-center text-xs text-muted-foreground">
        Auto Budget · {sync.linked && sync.allowed ? 'Synced with your account.' : 'Your data stays on this device.'}{' '}
        <Link to="/privacy" className="underline underline-offset-2">
          Privacy Policy
        </Link>
      </p>

      <PayDialog open={open === 'pay'} onClose={close} />
      <PaydayDatesDialog open={open === 'dates'} onClose={close} />
      <BufferDialog open={open === 'buffer'} onClose={close} />

      <AlertDialog open={open === 'delete'} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all your data?</AlertDialogTitle>
            <AlertDialogDescription>
              {sync.linked
                ? 'This removes your settings, bills, accounts and every transaction from this device, your synced data and your other devices. It can\x27t be undone. Save a backup file first if you might want it later.'
                : 'This removes your settings, bills, accounts and every transaction from this device. It can\x27t be undone. Save a backup file first if you might want it later.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await repo.deleteAllData()
                forgetLastBackupFile()
                toast.success('All data deleted')
                navigate('/')
              }}
            >
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  )
}

// ---------------------------------------------------------------------------

/**
 * "Sync across devices": Premium (or legacy) accounts open Account and sync;
 * everyone else sees a Premium badge and the paywall with sync listed first.
 */
function SyncRow() {
  const sync = useSync()
  const ent = useEntitlement()
  const navigate = useNavigate()
  const allowed = sync.user ? ent.canSync : false
  if (sync.user && (allowed || !premiumEnabled)) {
    return (
      <RowButton
        label="Sync across devices"
        description={sync.user.email}
        value={backupStatus(sync).label}
        onClick={() => navigate('/account')}
      />
    )
  }
  return (
    <RowButton
      label={
        <span className="flex items-center gap-2">
          Sync across devices
          {premiumEnabled && <PremiumBadge />}
        </span>
      }
      description="Phone, tablet and the web"
      onClick={() => navigate(premiumEnabled ? '/premium?feature=sync' : sync.user ? '/account' : '/account/sign-in')}
      trailing={<ChevronRight className="size-[18px] flex-none text-muted-foreground" aria-hidden="true" />}
    />
  )
}

/** The Auto Budget Premium card at the top of Settings. Hidden when Premium is off. */
function PremiumCard() {
  const ent = useEntitlement()
  if (!premiumEnabled) return null
  const status = ent.loading
    ? ''
    : ent.isLifetime
      ? 'Unlocked'
      : ent.isPremium
        ? `Free trial: ${ent.daysLeft} day${ent.daysLeft === 1 ? '' : 's'} left`
        : ent.trialAvailable
          ? 'Try free for 14 days'
          : 'Unlock in the Android app'
  return (
    <Link
      to="/premium"
      className="flex min-h-[76px] items-center gap-3.5 rounded-card bg-primary p-4 lg:max-w-[920px] text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 md:px-5"
    >
      <span className="flex size-11 flex-none items-center justify-center rounded-lg bg-hero-chip text-hero-link">
        <Sparkles className="size-[22px]" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-base font-bold">
          Auto Budget Premium
          {!ent.isPremium && <PremiumBadge className="bg-hero-chip text-hero-link" />}
        </span>
        <span className="text-sm text-hero-muted">{status || 'Debt planner, reports and recurring transactions'}</span>
      </span>
      <ChevronRight className="size-5 flex-none" aria-hidden="true" />
    </Link>
  )
}

// ---------------------------------------------------------------------------

/** The schedule rows under "Pay frequency" in Settings. */
function paydayRows(settings: Settings): { label: string; value: string }[] {
  const starts = { label: 'Month starts on', value: ordinal(settings.paydayDay) }
  switch (settings.payFrequency) {
    case 'monthly':
      return [{ label: 'Month starts on payday', value: ordinal(settings.paydayDay) }]
    case 'semimonthly': {
      const days = [settings.paydayDay, secondPayday(settings)].sort((a, b) => a - b)
      return [{ label: 'Paydays', value: `${ordinal(days[0])} and ${ordinal(days[1])}` }]
    }
    case 'weekly':
      return [{ label: 'Payday', value: `${weekdayName(payWeekday(settings))}s` }, starts]
    case 'daily':
      return [{ label: 'Days worked', value: formatWeekdays(workWeekdays(settings)) }, starts]
  }
}

function PayDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snapshot } = useAppData()
  const form = useForm<PayForm>({ resolver: zodResolver(payFormSchema), defaultValues: payFormDefaults(snapshot.settings) })
  useEffect(() => {
    if (open) form.reset(payFormDefaults(snapshot.settings))
  }, [open, snapshot.settings, form])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            const changes = payFormToSettings(v)
            const resetsMoved =
              changes.paydayDay !== snapshot.settings.paydayDay && Object.keys(snapshot.settings.paydayOverrides ?? {}).length > 0
            await savePaySettings(snapshot, changes)
            toast.success(resetsMoved ? 'Pay details saved. Moved paydays were reset for the new payday.' : 'Pay details saved')
            onClose()
          })}
        >
          <DialogHeader>
            <DialogTitle>Payday</DialogTitle>
            <DialogDescription>Your budget month runs from one payday to the day before the next. How much you get is taken from the income you log.</DialogDescription>
          </DialogHeader>
          <PayScheduleFields form={form} idPrefix="set" labelClass="text-sm font-semibold" existing={snapshot.settings} />
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The month before the current budget month, then this one and the next six. */
const DATES_FROM = -1
const DATES_COUNT = 8

const isWeekend = (d: ISODate) => weekdayOf(d) === 0 || weekdayOf(d) === 6

/**
 * Move a month's payday for a weekend or holiday. The budget month then starts
 * on the real date, and the month before ends the day before it.
 */
function PaydayDatesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snapshot } = useAppData()
  const { settings } = snapshot
  const [months, setMonths] = useState<MonthPayday[]>([])
  const [dates, setDates] = useState<Record<YearMonth, ISODate>>({})

  // Load once per opening, so a sync arriving mid-edit doesn't wipe the edits.
  const [loadedFor, setLoadedFor] = useState(false)
  if (open && !loadedFor) {
    const list = monthPaydays(settings, todayISO(), DATES_FROM, DATES_COUNT)
    setLoadedFor(true)
    setMonths(list)
    setDates(Object.fromEntries(list.map((m) => [m.yearMonth, m.actual])))
  } else if (!open && loadedFor) {
    setLoadedFor(false)
  }

  const errorFor = (regular: ISODate, value: ISODate | undefined): string | null => {
    if (!value) return 'Pick a date'
    if (Math.abs(paydayShift({ regular, actual: value })) > MAX_PAYDAY_SHIFT_DAYS) {
      return `Keep it within ${MAX_PAYDAY_SHIFT_DAYS} days of the usual payday`
    }
    return null
  }
  const invalid = months.some((m) => errorFor(m.regular, dates[m.yearMonth]))
  const upcomingWeekend = months.some((m, i) => i + DATES_FROM >= 0 && isWeekend(m.regular))

  const moveWeekends = () => {
    setDates((prev) => {
      const next = { ...prev }
      months.forEach((m, i) => {
        if (i + DATES_FROM < 0) return // leave months already over alone
        const wd = weekdayOf(m.regular)
        if (wd === 6) next[m.yearMonth] = addDays(m.regular, -1)
        else if (wd === 0) next[m.yearMonth] = addDays(m.regular, -2)
      })
      return next
    })
  }

  const save = async () => {
    const overrides = { ...(settings.paydayOverrides ?? {}) }
    for (const m of months) {
      const d = dates[m.yearMonth]
      if (!d || d === m.regular) delete overrides[m.yearMonth]
      else overrides[m.yearMonth] = d
    }
    await savePaySettings(snapshot, { paydayOverrides: overrides })
    toast.success('Payday dates saved')
    onClose()
  }

  const thisYear = parseISODate(todayISO()).year

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payday dates</DialogTitle>
          <DialogDescription>
            Paid early or late because of a weekend or holiday? Set the real date and your budget month starts that day.
          </DialogDescription>
        </DialogHeader>

        {upcomingWeekend && (
          <Button type="button" variant="outline" onClick={moveWeekends} className="self-start">
            Move weekend paydays to the Friday before
          </Button>
        )}

        <ul className="flex flex-col">
          {months.map((m, i) => {
            const value = dates[m.yearMonth] ?? m.actual
            const error = errorFor(m.regular, dates[m.yearMonth])
            const { year, month } = parseISODate(m.regular)
            const name = `${MONTH_NAMES[month - 1]}${year === thisYear ? '' : ` ${year}`}`
            const id = `payday-${m.yearMonth}`
            return (
              <li
                key={m.yearMonth}
                className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3', i > 0 && 'border-t border-border')}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <label htmlFor={id} className="text-[15px] font-semibold">
                    {name} payday
                    {i + DATES_FROM === 0 && <span className="ml-2 text-[13px] font-medium text-success-text">This month</span>}
                  </label>
                  <span className="text-[13px] text-muted-foreground">
                    Usually {formatDayHeading(m.regular)}
                    {isWeekend(m.regular) && ' · a weekend'}
                  </span>
                  {error && <span className="text-[13px] font-medium text-danger-text">{error}</span>}
                </div>
                <div className="flex items-center gap-1">
                  <TextInput
                    id={id}
                    type="date"
                    value={value}
                    min={addDays(m.regular, -MAX_PAYDAY_SHIFT_DAYS)}
                    max={addDays(m.regular, MAX_PAYDAY_SHIFT_DAYS)}
                    aria-invalid={!!error}
                    onChange={(e) => setDates((prev) => ({ ...prev, [m.yearMonth]: e.target.value }))}
                    className="h-[46px] w-[164px]"
                  />
                  {value !== m.regular && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Reset ${name} payday to ${formatDayHeading(m.regular)}`}
                      onClick={() => setDates((prev) => ({ ...prev, [m.yearMonth]: m.regular }))}
                    >
                      Reset
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <DialogFooter>
          <Button type="button" disabled={invalid} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const bufferSchema = z.object({ amount: moneyField({ allowZero: true }) })

function BufferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snapshot } = useAppData()
  const form = useForm<z.infer<typeof bufferSchema>>({ resolver: zodResolver(bufferSchema), defaultValues: { amount: '' } })
  useEffect(() => {
    if (open) form.reset({ amount: centavosToInput(snapshot.settings.bufferAmount) })
  }, [open, snapshot.settings, form])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            await repo.saveSettings({ bufferAmount: toCentavos(v.amount) })
            toast.success('Buffer saved')
            onClose()
          })}
        >
          <DialogHeader>
            <DialogTitle>Buffer</DialogTitle>
            <DialogDescription>
              Money kept aside every month for surprises. A bigger buffer is safer but lowers your card payment.
            </DialogDescription>
          </DialogHeader>
          <Controller
            name="amount"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1.5">
                <FieldLabel htmlFor="set-buffer" className="text-sm font-semibold">Buffer each month (₱)</FieldLabel>
                <MoneyInput id="set-buffer" large aria-invalid={fieldState.invalid} {...field} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, 'Give the category a name').max(30),
  kind: z.enum(['essential', 'optional', 'income']),
})

function CategoryDialog({
  open,
  category,
  forIncome,
  onClose,
  nextSortOrder,
}: {
  open: boolean
  category: Category | null
  /** True while adding or editing an income category: hides the Essential/Optional choice. */
  forIncome: boolean
  onClose: () => void
  nextSortOrder: number
}) {
  const form = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', kind: 'essential' },
  })
  useEffect(() => {
    if (open) form.reset({ name: category?.name ?? '', kind: category?.kind ?? (forIncome ? 'income' : 'essential') })
  }, [open, category, forIncome, form])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            if (category) await repo.updateCategory(category.id, v)
            else await repo.addCategory({ ...v, sortOrder: nextSortOrder, archived: false })
            toast.success(category ? 'Category saved' : `${v.name} added`)
            onClose()
          })}
        >
          <DialogHeader>
            <DialogTitle>{category ? 'Edit category' : forIncome ? 'Add income category' : 'Add category'}</DialogTitle>
            <DialogDescription>
              {forIncome ? 'A label for income, such as Salary or Freelance.' : 'Essential spending is protected first. Optional spending is what we suggest trimming.'}
            </DialogDescription>
          </DialogHeader>
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1.5">
                <FieldLabel htmlFor="cat-name" className="text-sm font-semibold">Name</FieldLabel>
                <TextInput id="cat-name" aria-invalid={fieldState.invalid} {...field} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          {!forIncome && (
            <Controller
              name="kind"
              control={form.control}
              render={({ field }) => (
                <Segmented<CategoryKind>
                  label="Kind"
                  value={field.value}
                  onChange={field.onChange}
                  options={[
                    { value: 'essential', label: 'Essential' },
                    { value: 'optional', label: 'Optional' },
                  ]}
                />
              )}
            />
          )}
          <DialogFooter className="gap-2">
            {category && (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await repo.updateCategory(category.id, { archived: !category.archived })
                  toast.success(category.archived ? `${category.name} restored` : `${category.name} archived`, {
                    description: category.archived ? undefined : 'Past transactions keep it; it leaves your plan.',
                  })
                  onClose()
                }}
              >
                {category.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                {category.archived ? 'Restore' : 'Archive'}
              </Button>
            )}
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CategoriesScreen() {
  return (
    <>
      <SubHeader title="Categories" to="/settings" />
      <CategoriesPanel />
    </>
  )
}

function CategoriesPanel() {
  const { snapshot } = useAppData()
  const [editing, setEditing] = useState<Category | null>(null)
  const [adding, setAdding] = useState<'expense' | 'income' | null>(null)
  const categories = alive(snapshot.categories).sort((a, b) => a.sortOrder - b.sortOrder)
  const expense = categories.filter((c) => c.kind !== 'income')
  const income = categories.filter((c) => c.kind === 'income')
  const nextSortOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1
  const forIncome = editing ? editing.kind === 'income' : adding === 'income'

  const list = (items: Category[]) =>
    items.map((c, i) => (
      <RowButton
        key={c.id}
        first={i === 0}
        label={c.name}
        value={c.kind === 'essential' ? 'Essential' : c.kind === 'optional' ? 'Optional' : undefined}
        onClick={() => setEditing(c)}
      />
    ))

  return (
    <>
      <SectionLabel className="my-1">Expense categories</SectionLabel>
      <section aria-label="Expense categories" className="flex flex-col rounded-card bg-card px-4 py-2 md:px-5">
        {list(expense.filter((c) => !c.archived))}
      </section>
      <DashedButton onClick={() => setAdding('expense')}>Add expense category</DashedButton>

      <SectionLabel className="my-1">Income categories</SectionLabel>
      <section aria-label="Income categories" className="flex flex-col rounded-card bg-card px-4 py-2 md:px-5">
        {list(income.filter((c) => !c.archived))}
      </section>
      <DashedButton onClick={() => setAdding('income')}>Add income category</DashedButton>

      {categories.some((c) => c.archived) && (
        <section className="flex flex-col rounded-card bg-card px-4 py-3">
          <SectionLabel className="my-1">Archived</SectionLabel>
          {list(categories.filter((c) => c.archived))}
        </section>
      )}
      <CategoryDialog
        open={adding !== null || editing !== null}
        category={editing}
        forIncome={forIncome}
        nextSortOrder={nextSortOrder}
        onClose={() => {
          setAdding(null)
          setEditing(null)
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

export function BillsScreen() {
  return (
    <>
      <SubHeader title="Fixed bills" />
      <BillsPanel />
    </>
  )
}

function BillsPanel() {
  const { snapshot } = useAppData()
  const [editing, setEditing] = useState<FixedBill | undefined>()
  const [open, setOpen] = useState(false)
  const bills = alive(snapshot.fixedBills).sort((a, b) => a.dueDay - b.dueDay)
  return (
    <>
      <p className="text-sm text-muted-foreground">Set aside first each month, before anything else.</p>
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
      <BillDialog open={open} onOpenChange={setOpen} bill={editing} />
    </>
  )
}
