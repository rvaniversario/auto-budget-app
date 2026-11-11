import { useEffect, useRef, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Archive, ArchiveRestore, Download, FileJson, FileSpreadsheet, Upload } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import {
  alive,
  centavosToInput,
  formatLongDate,
  formatMoney,
  ordinal,
  todayISO,
  transactionsToCSV,
  type Category,
  type CategoryKind,
  type FixedBill,
  type ThemePreference,
} from '@/core'
import { parseBackup, repo, type BackupFile } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { useIsLg } from '@/hooks/useMedia'
import { cn } from '@/lib/utils'
import { BillDialog, BillsList } from '@/components/BillDialog'
import { DashedButton, RowButton, SectionLabel, SubHeader, TabHeader, Tag } from '@/components/layout'
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
import { downloadFile, safeStorage } from '@/lib/browser'
import { dayField, moneyField, toCentavos } from '@/lib/forms'

const LAST_BACKUP_KEY = 'auto-budget:last-backup'

type Open = 'pay' | 'buffer' | 'export' | 'cloud' | 'delete' | null

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
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastBackup = safeStorage.get(LAST_BACKUP_KEY)

  const categories = alive(snapshot.categories)
  const bills = alive(snapshot.fixedBills)
  const close = () => setOpen(null)

  const exportJSON = async () => {
    const backup = await repo.exportBackup()
    downloadFile(`auto-budget-backup-${todayISO()}.json`, JSON.stringify(backup, null, 2), 'application/json')
    safeStorage.set(LAST_BACKUP_KEY, todayISO())
    toast.success('Backup saved', { description: 'Keep the file somewhere safe, like Google Drive or email.' })
    close()
  }

  const exportCSV = () => {
    const csv = transactionsToCSV(snapshot.transactions, {
      categories: snapshot.categories,
      accounts: snapshot.accounts,
      fixedBills: snapshot.fixedBills,
    })
    downloadFile(`auto-budget-transactions-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8')
    toast.success('Transactions exported')
    close()
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const result = parseBackup(await file.text())
    if (fileRef.current) fileRef.current.value = ''
    if (!result.ok) {
      toast.error("Couldn't import that file", { description: result.error })
      return
    }
    setPendingImport(result.backup)
  }

  const confirmImport = async () => {
    if (!pendingImport) return
    await repo.importBackup(pendingImport)
    setPendingImport(null)
    toast.success('Backup imported')
    navigate('/')
  }

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
    </section>
  )

  const dataSection = (
    <section aria-label="Data settings" className="flex flex-col rounded-card bg-card px-4 py-3 md:px-5">
      <SectionLabel className="my-1">Your data</SectionLabel>
      <RowButton
        first
        label="Export data"
        description={lastBackup ? `Last backup ${formatLongDate(lastBackup)}` : 'No backup yet. Your data lives only on this device.'}
        value="CSV or JSON"
        onClick={() => setOpen('export')}
      />
      <RowButton label="Import data" value="From a backup file" onClick={() => fileRef.current?.click()} />
      <RowButton
        label="Cloud sync"
        description="Automatic backup, use on more devices"
        onClick={() => setOpen('cloud')}
        trailing={<span className="flex-none rounded-xl bg-ink px-2.5 py-1 text-xs font-bold text-ink-foreground">Paid</span>}
      />
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
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a backup file"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

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

      <p className="text-center text-xs text-muted-foreground">Auto Budget · Your data stays on this device.</p>

      <PayDialog open={open === 'pay'} onClose={close} />
      <BufferDialog open={open === 'buffer'} onClose={close} />

      <Dialog open={open === 'export'} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export your data</DialogTitle>
            <DialogDescription>
              A full backup restores everything on a new phone. The spreadsheet has just your transactions.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button className="h-12 justify-start gap-3" onClick={exportJSON}>
              <FileJson aria-hidden="true" /> Full backup (JSON)
            </Button>
            <Button variant="outline" className="h-12 justify-start gap-3" onClick={exportCSV}>
              <FileSpreadsheet aria-hidden="true" /> Transactions (CSV)
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'cloud'} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Cloud sync <Tag tone="success">Coming soon</Tag>
            </DialogTitle>
            <DialogDescription>
              Automatic backup and the same budget on more devices will be a paid add-on. Until then, use Export data to keep a free
              backup.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                close()
                setTimeout(() => setOpen('export'), 0)
              }}
            >
              <Download aria-hidden="true" /> Back up now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={open === 'delete'} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all your data?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes your salary, bills, accounts and every transaction from this device. It can't be undone. Export a backup first if
              you might want it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                await repo.deleteAllData()
                safeStorage.set(LAST_BACKUP_KEY, '')
                toast.success('All data deleted')
                navigate('/')
              }}
            >
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingImport !== null} onOpenChange={(o) => !o && setPendingImport(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your data with this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingImport &&
                `The backup from ${formatLongDate(pendingImport.exportedAt.slice(0, 10))} has ${alive(pendingImport.data.transactions).length} transactions. Everything currently on this device will be replaced.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport}>
              <Upload aria-hidden="true" /> Replace and import
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
