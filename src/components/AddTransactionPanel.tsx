import { useState } from 'react'
import { toast } from 'sonner'
import { alive, formatMoney, type TransactionType } from '@/core'
import { repo } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { useFinePointer } from '@/hooks/useMedia'
import { defaultValues, toTransactionRecord, TransactionForm } from '@/components/TransactionForm'

export interface AddPrefill {
  type?: TransactionType
  /** Transfer destination account id. */
  to?: string | null
  categoryId?: string | null
}

/**
 * The Add transaction form, shared by the full-screen phone page and the
 * tablet/desktop dialog. Touch devices get the number pad; mouse and keyboard
 * devices get a plain amount field.
 */
export function AddTransactionPanel({ prefill, onDone }: { prefill?: AddPrefill; onDone: () => void }) {
  const { snapshot } = useAppData()
  const finePointer = useFinePointer()
  const accounts = alive(snapshot.accounts)
  // Defaults are computed once, when the panel opens.
  const [initial] = useState(() =>
    defaultValues(accounts, { type: prefill?.type, toAccountId: prefill?.to ?? null, categoryId: prefill?.categoryId ?? null }),
  )

  if (accounts.length === 0) {
    return <p className="text-[15px] text-muted-foreground">Add an account first, such as Cash or your bank, on the Accounts tab.</p>
  }

  return (
    <TransactionForm
      compact={finePointer}
      autoFocusAmount={finePointer}
      accounts={accounts}
      categories={snapshot.categories.filter((c) => !c.deletedAt)}
      bills={alive(snapshot.fixedBills)}
      initial={initial}
      onSubmit={async (values) => {
        const record = toTransactionRecord(values)
        const saved = await repo.addTransaction(record)
        toast.success(`Saved ${formatMoney(record.amount)}`, {
          action: { label: 'Undo', onClick: () => void repo.deleteTransaction(saved.id) },
        })
        onDone()
      }}
    />
  )
}
