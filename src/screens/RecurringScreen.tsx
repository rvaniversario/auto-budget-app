import { useState } from 'react'
import { Pause, Pencil, Play, Plus, Repeat, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  addDays,
  alive,
  centavosToInput,
  describeSchedule,
  formatMoney,
  formatShortDate,
  isValidISODate,
  nextOccurrenceDate,
  parseISODate,
  parseMoney,
  todayISO,
  type RecurringSchedule,
  type RecurringTemplate,
  type TransactionType,
} from '@/core'
import { repo, type NewRecord } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { cn } from '@/lib/utils'
import { ChoiceChips, MoneyInput, Segmented, TextInput } from '@/components/inputs'
import { DashedButton, SubHeader, Tag } from '@/components/layout'
import { BILLS_CHIP } from '@/components/TransactionForm'
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { PremiumGate } from '@/premium/components'

export function RecurringScreen() {
  return (
    <PremiumGate feature="recurring">
      <RecurringList />
    </PremiumGate>
  )
}

/** First day no occurrence has been created for yet, after an edit or resume. */
function futureFrom(t: Pick<RecurringTemplate, 'startDate'>): string {
  const tomorrow = addDays(todayISO(), 1)
  return t.startDate > tomorrow ? t.startDate : tomorrow
}

function RecurringList() {
  const { snapshot, model } = useAppData()
  const templates = alive(snapshot.recurringTemplates ?? [])
  const [editing, setEditing] = useState<RecurringTemplate | 'new' | null>(null)
  const [deleting, setDeleting] = useState<RecurringTemplate | null>(null)
  const describe = useTemplateTitle()

  const togglePause = async (t: RecurringTemplate) => {
    if (t.paused) {
      // Missed dates while paused are skipped, not created all at once.
      await repo.updateRecurringTemplate(t.id, { paused: false, activeFrom: t.startDate > model.today ? t.startDate : model.today })
      toast.success(`${describe(t)} resumed`)
    } else {
      await repo.updateRecurringTemplate(t.id, { paused: true })
      toast.success(`${describe(t)} paused`)
    }
  }

  return (
    <>
      <SubHeader title="Recurring" action={<Button onClick={() => setEditing('new')} className="hidden md:inline-flex"><Plus aria-hidden="true" /> Add recurring</Button>} />
      <p className="max-w-prose text-[13px] leading-normal text-muted-foreground">
        These are added to your transactions on schedule, each time you open the app. Created transactions are marked "Recurring" and can be edited one by one.
      </p>
      {templates.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-card border border-dashed border-dash-line px-5 py-8 text-center">
          <Repeat className="size-10 text-link" strokeWidth={1.6} aria-hidden="true" />
          <h2 className="font-sans text-[17px] font-bold">Nothing repeating yet</h2>
          <p className="max-w-prose text-sm text-muted-foreground">Add rent, subscriptions or your salary once, and they'll log themselves.</p>
          <Button className="h-12 rounded-[14px] px-5" onClick={() => setEditing('new')}>
            Add a recurring transaction
          </Button>
        </section>
      ) : (
        <section aria-label="Recurring transactions" className="rounded-card bg-card px-4 py-2 md:px-5">
          <ul className="flex flex-col">
            {templates.map((t, i) => {
              const next = nextOccurrenceDate(t, model.today)
              const ended = !t.paused && !next
              return (
                <li key={t.id} className={cn('flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between', i > 0 && 'border-t border-border')}>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2 text-[15px] font-semibold">
                      <span className="truncate">{describe(t)}</span>
                      {t.paused && <Tag tone="warning">Paused</Tag>}
                      {ended && <Tag tone="success">Ended</Tag>}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      {describeSchedule(t.schedule)}
                      {next ? ` · next ${formatShortDate(next)}` : ''}
                      {t.endDate ? ` · until ${formatShortDate(t.endDate)}` : ''}
                    </span>
                  </div>
                  <div className="flex flex-none items-center gap-1">
                    <span className={cn('money mr-2 text-base font-semibold', t.type === 'income' && 'text-income')}>
                      {t.type === 'income' ? '+ ' : t.type === 'expense' ? '− ' : ''}
                      {formatMoney(t.amount)}
                    </span>
                    <Button variant="ghost" size="icon" aria-label={`${t.paused ? 'Resume' : 'Pause'} ${describe(t)}`} onClick={() => void togglePause(t)}>
                      {t.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Edit ${describe(t)}`} onClick={() => setEditing(t)}>
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`Delete ${describe(t)}`} onClick={() => setDeleting(t)}>
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {templates.length > 0 && (
        <div className="md:hidden">
          <DashedButton onClick={() => setEditing('new')}>Add recurring</DashedButton>
        </div>
      )}

      {/* Keyed so the form starts fresh each time it opens. */}
      <RecurringDialog key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id} open={editing !== null} existing={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {deleting ? describe(deleting) : 'this'}?</AlertDialogTitle>
            <AlertDialogDescription>No new transactions will be added. The ones already created stay in your history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                if (!deleting) return
                await repo.deleteRecurringTemplate(deleting.id)
                toast.success('Recurring transaction deleted')
                setDeleting(null)
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

/** "Rent", or the category / account it goes to when there is no note. */
function useTemplateTitle() {
  const { snapshot } = useAppData()
  const cats = new Map(snapshot.categories.map((c) => [c.id, c.name]))
  const accts = new Map(snapshot.accounts.map((a) => [a.id, a.name]))
  const bills = new Map(snapshot.fixedBills.map((b) => [b.id, b.name]))
  return (t: Pick<RecurringTemplate, 'note' | 'type' | 'categoryId' | 'fixedBillId' | 'toAccountId'>) => {
    if (t.note) return t.note
    if (t.type === 'income') return 'Income'
    if (t.type === 'transfer') return `Transfer to ${accts.get(t.toAccountId ?? '') ?? 'account'}`
    if (t.fixedBillId) return bills.get(t.fixedBillId) ?? 'Bill'
    return t.categoryId ? (cats.get(t.categoryId) ?? 'Expense') : 'Bills'
  }
}

// ---------------------------------------------------------------------------

type Kind = RecurringSchedule['kind']

interface Draft {
  type: TransactionType
  amount: string
  categoryId: string | null
  fixedBillId: string | null
  accountId: string
  toAccountId: string | null
  note: string
  kind: Kind
  day: string
  day2: string
  every: string
  startDate: string
  endDate: string
}

function draftFrom(t: RecurringTemplate | null, accountId: string): Draft {
  const today = todayISO()
  const start = t?.startDate ?? today
  const day = String(parseISODate(start).day)
  const s = t?.schedule ?? null
  return {
    type: t?.type ?? 'expense',
    amount: t ? centavosToInput(t.amount) : '',
    categoryId: t ? (t.type === 'expense' ? (t.categoryId ?? BILLS_CHIP) : null) : null,
    fixedBillId: t?.fixedBillId ?? null,
    accountId: t?.accountId ?? accountId,
    toAccountId: t?.toAccountId ?? null,
    note: t?.note ?? '',
    kind: s?.kind ?? 'monthly',
    day: s?.kind === 'monthly' ? String(s.day) : s?.kind === 'twiceMonthly' ? String(s.days[0]) : day,
    day2: s?.kind === 'twiceMonthly' ? String(s.days[1]) : String(Number(day) <= 15 ? Number(day) + 15 : Number(day) - 15),
    every: s?.kind === 'weekly' ? String(s.every) : '1',
    startDate: start,
    endDate: t?.endDate ?? '',
  }
}

const label = 'text-[13px] font-semibold text-muted-foreground'

function dayValue(v: string): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null
}

/** Add or edit a recurring template. Editing changes future occurrences only. */
export function RecurringDialog({
  open,
  existing,
  onClose,
}: {
  open: boolean
  existing: RecurringTemplate | null
  onClose: () => void
}) {
  const { snapshot } = useAppData()
  const accounts = alive(snapshot.accounts)
  const categories = alive(snapshot.categories).filter((c) => !c.archived)
  const bills = alive(snapshot.fixedBills)
  const defaultAccount = (accounts.find((a) => a.type === 'bank') ?? accounts.find((a) => a.type === 'ewallet'))?.id ?? accounts[0]?.id ?? ''
  const [d, setD] = useState<Draft>(() => draftFrom(existing, defaultAccount))
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((prev) => ({ ...prev, [k]: v }))
    setError(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseMoney(d.amount)
    if (amount === null || amount <= 0) return setError('Enter an amount')
    if (d.type === 'expense' && !d.categoryId) return setError('Pick a category')
    if (!d.accountId) return setError('Choose an account')
    if (d.type === 'transfer' && (!d.toAccountId || d.toAccountId === d.accountId)) return setError('Pick two different accounts')
    if (!isValidISODate(d.startDate)) return setError('Pick a start date')
    if (d.endDate && (!isValidISODate(d.endDate) || d.endDate < d.startDate)) return setError('The end date must be after the start date')

    let schedule: RecurringSchedule
    if (d.kind === 'monthly') {
      const day = dayValue(d.day)
      if (!day) return setError('Enter a day from 1 to 31')
      schedule = { kind: 'monthly', day }
    } else if (d.kind === 'twiceMonthly') {
      const a = dayValue(d.day)
      const b = dayValue(d.day2)
      if (!a || !b || a === b) return setError('Enter two different days from 1 to 31')
      schedule = { kind: 'twiceMonthly', days: a < b ? [a, b] : [b, a] }
    } else {
      const every = Number(d.every)
      if (!Number.isInteger(every) || every < 1 || every > 52) return setError('Enter a number of weeks from 1 to 52')
      schedule = { kind: 'weekly', every }
    }

    const isBill = d.type === 'expense' && d.categoryId === BILLS_CHIP
    const record: NewRecord<RecurringTemplate> = {
      type: d.type,
      amount,
      categoryId: d.type === 'expense' && !isBill ? d.categoryId : null,
      fixedBillId: isBill ? d.fixedBillId : null,
      accountId: d.accountId,
      toAccountId: d.type === 'transfer' ? d.toAccountId : null,
      note: d.note.trim(),
      schedule,
      startDate: d.startDate,
      endDate: d.endDate || null,
      paused: existing?.paused ?? false,
      activeFrom: d.startDate,
    }
    if (existing) {
      // Future occurrences only: what was already created stays as it is.
      await repo.updateRecurringTemplate(existing.id, { ...record, activeFrom: futureFrom(record) })
      toast.success('Changes apply from tomorrow')
    } else {
      await repo.addRecurringTemplate(record)
      toast.success(d.startDate <= todayISO() ? 'Recurring transaction added' : `Starts ${formatShortDate(d.startDate)}`)
    }
    onClose()
  }

  const sourceAccounts = d.type === 'transfer' ? accounts : accounts.filter((a) => a.type !== 'loan')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit recurring' : 'Add recurring'}</DialogTitle>
          <DialogDescription>{existing ? 'Changes apply to future transactions only.' : 'Added for you on schedule, starting on the date you pick.'}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="flex flex-col gap-3.5">
          <Segmented
            label="Transaction type"
            value={d.type}
            onChange={(v) => set('type', v)}
            options={[
              { value: 'expense', label: 'Expense' },
              { value: 'income', label: 'Income' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-amount" className={label}>
                Amount (₱)
              </Label>
              <MoneyInput id="rec-amount" value={d.amount} onChange={(e) => set('amount', e.target.value)} className="h-[46px]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-note" className={label}>
                Note (optional)
              </Label>
              <TextInput id="rec-note" value={d.note} maxLength={120} placeholder={d.type === 'income' ? 'Salary' : 'Rent'} onChange={(e) => set('note', e.target.value)} className="h-[46px]" />
            </div>
          </div>

          {d.type === 'expense' && (
            <div className="flex flex-col gap-2">
              <p className={label}>Category</p>
              <ChoiceChips
                label="Category"
                shape="pill"
                value={d.categoryId}
                onChange={(v) => {
                  set('categoryId', v)
                  if (v !== BILLS_CHIP) set('fixedBillId', null)
                }}
                options={[...categories.map((c) => ({ value: c.id, label: c.name })), { value: BILLS_CHIP, label: 'Bills' }]}
              />
              {d.categoryId === BILLS_CHIP && bills.length > 0 && (
                <>
                  <p className={label}>Link to a fixed bill (optional)</p>
                  <ChoiceChips
                    label="Fixed bill"
                    shape="pill"
                    scroll
                    value={d.fixedBillId}
                    onChange={(v) => set('fixedBillId', d.fixedBillId === v ? null : v)}
                    options={bills.map((b) => ({ value: b.id, label: b.name }))}
                  />
                </>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p className={label}>{d.type === 'expense' ? 'Paid with' : d.type === 'income' ? 'Received in' : 'From'}</p>
            <ChoiceChips label="Account" value={d.accountId} onChange={(v) => set('accountId', v)} options={sourceAccounts.map((a) => ({ value: a.id, label: a.name }))} />
          </div>
          {d.type === 'transfer' && (
            <div className="flex flex-col gap-2">
              <p className={label}>To</p>
              <ChoiceChips label="To account" value={d.toAccountId} onChange={(v) => set('toAccountId', v)} options={accounts.map((a) => ({ value: a.id, label: a.name }))} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <p className={label}>Repeats</p>
            <Segmented
              label="Repeats"
              value={d.kind}
              onChange={(v) => set('kind', v)}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'twiceMonthly', label: 'Twice a month' },
                { value: 'weekly', label: 'Weekly' },
              ]}
            />
            {d.kind === 'monthly' && (
              <DayInput id="rec-day" text="On day" value={d.day} onChange={(v) => set('day', v)} />
            )}
            {d.kind === 'twiceMonthly' && (
              <div className="grid grid-cols-2 gap-2">
                <DayInput id="rec-day" text="First day" value={d.day} onChange={(v) => set('day', v)} />
                <DayInput id="rec-day2" text="Second day" value={d.day2} onChange={(v) => set('day2', v)} />
              </div>
            )}
            {d.kind === 'weekly' && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rec-every" className={label}>
                  Every how many weeks? (1 = every week)
                </Label>
                <TextInput id="rec-every" inputMode="numeric" value={d.every} onChange={(e) => set('every', e.target.value)} className="h-[46px]" />
                <p className="text-[13px] text-muted-foreground">On the same weekday as the start date.</p>
              </div>
            )}
            {(d.kind === 'monthly' || d.kind === 'twiceMonthly') && <p className="text-[13px] text-muted-foreground">In shorter months, the 31st becomes the last day.</p>}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-start" className={label}>
                Starts
              </Label>
              <TextInput id="rec-start" type="date" value={d.startDate} onChange={(e) => set('startDate', e.target.value)} className="h-[46px]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rec-end" className={label}>
                Ends (optional)
              </Label>
              <TextInput id="rec-end" type="date" min={d.startDate} value={d.endDate} onChange={(e) => set('endDate', e.target.value)} className="h-[46px]" />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="h-[54px] rounded-[14px] text-base">
            {existing ? 'Save changes' : 'Add recurring'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DayInput({ id, text, value, onChange }: { id: string; text: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className={label}>
        {text}
      </Label>
      <TextInput id={id} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} className="h-[46px]" />
    </div>
  )
}
