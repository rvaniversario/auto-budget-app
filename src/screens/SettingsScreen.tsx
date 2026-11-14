import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Archive, ArchiveRestore, ChevronRight, Sparkles } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  alive,
  centavosToInput,
  formatLongDate,
  formatMoney,
  ordinal,
  type Category,
  type CategoryKind,
  type FixedBill,
  type ThemePreference,
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { forgetLastBackupFile, lastBackupFile } from '@/lib/backupFile'
import { backupStatus, cloudEnabled, useSync } from '@/sync'
import { dayField, moneyField, toCentavos } from '@/lib/forms'
import { premiumEnabled, useEntitlement } from '@/premium'
import { PremiumBadge } from '@/premium/components'

type Open = 'pay' | 'buffer' | 'delete' | null

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
      <RowButton first label="Take-home salary" value={formatMoney(settings.monthlySalary)} onClick={() => setOpen('pay')} />
      <RowButton label="Month starts on payday" value={ordinal(settings.paydayDay)} onClick={() => setOpen('pay')} />
      <RowButton label="Pay frequency" value="Monthly" onClick={() => toast('Twice-a-month pay is coming soon')} />
      <RowButton label="Categories" value={String(categories.filter((c) => !c.archived).length)} onClick={() => go('categories')} />
      <RowButton label="Fixed bills" value={`${bills.length} bill${bills.length === 1 ? '' : 's'}`} onClick={() => go('bills')} />
      <RowButton label="Buffer amount" value={formatMoney(settings.bufferAmount)} onClick={() => setOpen('buffer')} />
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
      <BufferDialog open={open === 'buffer'} onClose={close} />

      <AlertDialog open={open === 'delete'} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all your data?</AlertDialogTitle>
            <AlertDialogDescription>
              {sync.linked
                ? 'This removes your salary, bills, accounts and every transaction from this device, your synced data and your other devices. It can\x27t be undone. Save a backup file first if you might want it later.'
                : 'This removes your salary, bills, accounts and every transaction from this device. It can\x27t be undone. Save a backup file first if you might want it later.'}
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

const paySchema = z.object({ salary: moneyField({ message: 'Enter your take-home salary' }), payday: dayField })

function PayDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { snapshot } = useAppData()
  const form = useForm<z.infer<typeof paySchema>>({ resolver: zodResolver(paySchema), defaultValues: { salary: '', payday: '' } })
  useEffect(() => {
    if (open) form.reset({ salary: centavosToInput(snapshot.settings.monthlySalary), payday: String(snapshot.settings.paydayDay) })
  }, [open, snapshot.settings, form])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit(async (v) => {
            await repo.saveSettings({ monthlySalary: toCentavos(v.salary), paydayDay: Number(v.payday) })
            toast.success('Pay details saved')
            onClose()
          })}
        >
          <DialogHeader>
            <DialogTitle>Salary and payday</DialogTitle>
            <DialogDescription>Your budget month runs from one payday to the day before the next.</DialogDescription>
          </DialogHeader>
          <Controller
            name="salary"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1.5">
                <FieldLabel htmlFor="set-salary" className="text-sm font-semibold">Take-home salary (₱)</FieldLabel>
                <MoneyInput id="set-salary" large aria-invalid={fieldState.invalid} {...field} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="payday"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1.5">
                <FieldLabel htmlFor="set-payday" className="text-sm font-semibold">Payday (day of the month)</FieldLabel>
                <TextInput id="set-payday" inputMode="numeric" maxLength={2} aria-invalid={fieldState.invalid} {...field} />
                <FieldDescription className="text-[13px]">In shorter months we use the last day of the month.</FieldDescription>
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
  kind: z.enum(['essential', 'optional']),
})

function CategoryDialog({ open, category, onClose, nextSortOrder }: { open: boolean; category: Category | null; onClose: () => void; nextSortOrder: number }) {
  const form = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: '', kind: 'essential' },
  })
  useEffect(() => {
    if (open) form.reset({ name: category?.name ?? '', kind: category?.kind ?? 'essential' })
  }, [open, category, form])

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
            <DialogTitle>{category ? 'Edit category' : 'Add category'}</DialogTitle>
            <DialogDescription>Essential spending is protected first. Optional spending is what we suggest trimming.</DialogDescription>
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
  const [adding, setAdding] = useState(false)
  const categories = alive(snapshot.categories).sort((a, b) => a.sortOrder - b.sortOrder)
  const active = categories.filter((c) => !c.archived)
  const archived = categories.filter((c) => c.archived)
  const nextSortOrder = categories.reduce((m, c) => Math.max(m, c.sortOrder), -1) + 1

  const list = (items: Category[]) =>
    items.map((c, i) => (
      <RowButton
        key={c.id}
        first={i === 0}
        label={c.name}
        value={c.kind === 'essential' ? 'Essential' : 'Optional'}
        onClick={() => setEditing(c)}
      />
    ))

  return (
    <>
      <section aria-label="Categories" className="flex flex-col rounded-card bg-card px-4 py-2 md:px-5">{list(active)}</section>
      <DashedButton onClick={() => setAdding(true)}>Add category</DashedButton>
      {archived.length > 0 && (
        <section className="flex flex-col rounded-card bg-card px-4 py-3">
          <SectionLabel className="my-1">Archived</SectionLabel>
          {list(archived)}
        </section>
      )}
      <CategoryDialog
        open={adding || editing !== null}
        category={editing}
        nextSortOrder={nextSortOrder}
        onClose={() => {
          setAdding(false)
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
