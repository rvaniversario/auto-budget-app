import { useState } from 'react'
import { ChevronRight, Repeat } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  alive,
  describeSchedule,
  dueOccurrences,
  formatMoney,
  formatShortDate,
  parseISODate,
  todayISO,
  type RecurringSchedule,
  type TransactionType,
} from '@/core'
import { repo } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { useFinePointer } from '@/hooks/useMedia'
import { defaultValues, toTransactionRecord, TransactionForm } from '@/components/TransactionForm'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { premiumEnabled, useEntitlement } from '@/premium'
import { PremiumBadge } from '@/premium/components'

export interface AddPrefill {
  type?: TransactionType
  /** Transfer destination account id. */
  to?: string | null
  categoryId?: string | null
  /** The account paid with (or transferred from), when opened from an account's screen. */
  from?: string | null
}

type RepeatChoice = 'none' | 'monthly' | 'every2weeks' | 'weekly'

function scheduleFor(choice: Exclude<RepeatChoice, 'none'>, date: string): RecurringSchedule {
  if (choice === 'monthly') return { kind: 'monthly', day: parseISODate(date).day }
  return { kind: 'weekly', every: choice === 'weekly' ? 1 : 2 }
}

/**
 * The Add transaction form, shared by the full-screen phone page and the
 * tablet/desktop dialog. Touch devices get the number pad; mouse and keyboard
 * devices get a plain amount field.
 */
export function AddTransactionPanel({ prefill, onDone }: { prefill?: AddPrefill; onDone: () => void }) {
  const { snapshot } = useAppData()
  const finePointer = useFinePointer()
  const ent = useEntitlement()
  const accounts = alive(snapshot.accounts)
  const [repeat, setRepeat] = useState<RepeatChoice>('none')
  // Defaults are computed once, when the panel opens.
  const [initial] = useState(() =>
    defaultValues(accounts, {
      type: prefill?.type,
      toAccountId: prefill?.to ?? null,
      categoryId: prefill?.categoryId ?? null,
      accountId: prefill?.from ?? null,
    }),
  )

  if (accounts.length === 0) {
    return <p className="text-[13px] text-muted-foreground">Add an account first, such as Cash or your bank, on the Accounts tab.</p>
  }

  const canRepeat = premiumEnabled && ent.isPremium

  return (
    <TransactionForm
      compact={finePointer}
      autoFocusAmount={finePointer}
      accounts={accounts}
      categories={snapshot.categories.filter((c) => !c.deletedAt)}
      bills={alive(snapshot.fixedBills)}
      initial={initial}
      extraFields={premiumEnabled ? <RepeatRow value={repeat} onChange={setRepeat} unlocked={canRepeat} onLeave={onDone} /> : undefined}
      onSubmit={async (values) => {
        const record = toTransactionRecord(values)
        if (canRepeat && repeat !== 'none') {
          // A repeating entry is a template; its first occurrence is created now if it's due.
          const template = await repo.addRecurringTemplate({
            type: record.type,
            amount: record.amount,
            categoryId: record.categoryId,
            fixedBillId: record.fixedBillId,
            accountId: record.accountId,
            toAccountId: record.toAccountId,
            note: record.note,
            schedule: scheduleFor(repeat, record.date),
            startDate: record.date,
            endDate: null,
            paused: false,
            activeFrom: record.date,
          })
          const due = dueOccurrences([template], new Set(), todayISO(), new Date().toISOString())
          await repo.addRecurringOccurrences(due)
          toast.success(`Saved ${formatMoney(record.amount)}`, {
            description:
              record.date > todayISO()
                ? `${describeSchedule(template.schedule)}, starting ${formatShortDate(record.date)}`
                : describeSchedule(template.schedule),
            action: {
              label: 'Undo',
              onClick: () => {
                void repo.deleteRecurringTemplate(template.id)
                for (const t of due) void repo.deleteTransaction(t.id)
              },
            },
          })
        } else {
          const saved = await repo.addTransaction(record)
          toast.success(`Saved ${formatMoney(record.amount)}`, {
            action: { label: 'Undo', onClick: () => void repo.deleteTransaction(saved.id) },
          })
        }
        onDone()
      }}
    />
  )
}

/** "Repeat": a schedule picker for Premium, an entry to the locked view otherwise. */
function RepeatRow({
  value,
  onChange,
  unlocked,
  onLeave,
}: {
  value: RepeatChoice
  onChange: (v: RepeatChoice) => void
  unlocked: boolean
  onLeave: () => void
}) {
  const navigate = useNavigate()
  if (!unlocked) {
    return (
      <button
        type="button"
        onClick={() => {
          onLeave()
          navigate('/recurring')
        }}
        className="flex min-h-11 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Repeat className="size-5 flex-none text-muted-foreground" aria-hidden="true" />
        <span className="flex flex-1 items-center gap-2 text-[13px] font-semibold">
          Repeat
          <PremiumBadge />
        </span>
        <ChevronRight className="size-5 flex-none text-muted-foreground" aria-hidden="true" />
      </button>
    )
  }
  return (
    <div className="flex min-h-11 items-center justify-between gap-3">
      <span id="repeat-label" className="flex items-center gap-3 text-[13px] font-semibold">
        <Repeat className="size-5 flex-none text-muted-foreground" aria-hidden="true" />
        Repeat
      </span>
      <Select value={value} onValueChange={(v) => onChange(v as RepeatChoice)}>
        <SelectTrigger aria-labelledby="repeat-label" className="h-11 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Doesn't repeat</SelectItem>
          <SelectItem value="monthly">Every month</SelectItem>
          <SelectItem value="every2weeks">Every 2 weeks</SelectItem>
          <SelectItem value="weekly">Every week</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
