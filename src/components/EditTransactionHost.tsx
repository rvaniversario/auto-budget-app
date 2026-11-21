import { toast } from 'sonner'
import { alive, type Transaction } from '@/core'
import { repo } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { useFinePointer, useIsMd } from '@/hooks/useMedia'
import { defaultValues, toTransactionRecord, TransactionForm } from '@/components/TransactionForm'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

/** Soft-delete with an Undo action in the toast. */
export async function deleteWithUndo(t: Transaction) {
  await repo.deleteTransaction(t.id)
  toast.success('Transaction deleted', { action: { label: 'Undo', onClick: () => void repo.restoreTransaction(t.id) } })
}

function EditBody({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const { snapshot } = useAppData()
  const finePointer = useFinePointer()
  const accounts = alive(snapshot.accounts)
  const allAccounts = new Map(snapshot.accounts.map((a) => [a.id, a]))
  // Keep a deleted account selectable so old transactions still edit cleanly.
  const options = accounts.some((a) => a.id === transaction.accountId)
    ? accounts
    : [...accounts, allAccounts.get(transaction.accountId)].filter((a): a is NonNullable<typeof a> => !!a)

  return (
    <TransactionForm
      key={transaction.id}
      compact={finePointer}
      initialField={null}
      surface="popover"
      accounts={options}
      categories={snapshot.categories.filter((c) => !c.deletedAt)}
      bills={alive(snapshot.fixedBills)}
      initial={defaultValues(accounts, { existing: transaction })}
      extraActions={
        <Button
          type="button"
          variant="destructive"
          className={finePointer ? 'h-[54px] rounded-[14px] px-5 text-base' : 'h-[50px] rounded-[14px] px-5 text-base'}
          onClick={async () => {
            await deleteWithUndo(transaction)
            onClose()
          }}
        >
          Delete
        </Button>
      }
      onSubmit={async (values) => {
        await repo.updateTransaction(transaction.id, toTransactionRecord(values))
        toast.success('Changes saved')
        onClose()
      }}
    />
  )
}

/** Edit transaction: a bottom drawer on phones, a right-side sheet from tablet width. */
export function EditTransactionHost({ transaction, onClose }: { transaction: Transaction | null; onClose: () => void }) {
  const isMd = useIsMd()
  const open = transaction !== null
  const onOpenChange = (o: boolean) => {
    if (!o) onClose()
  }

  if (isMd) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-[420px]">
          <SheetHeader className="px-5 pt-5">
            <SheetTitle className="text-[15px] font-bold">Edit transaction</SheetTitle>
            <SheetDescription className="sr-only">Change or delete this transaction</SheetDescription>
          </SheetHeader>
          <div className="px-5 pt-3 pb-6">{transaction && <EditBody transaction={transaction} onClose={onClose} />}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-h-[92dvh] max-w-[640px]">
        <DrawerHeader className="pb-0">
          <DrawerTitle>Edit transaction</DrawerTitle>
          <DrawerDescription className="sr-only">Change or delete this transaction</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-5 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]">
          {transaction && <EditBody transaction={transaction} onClose={onClose} />}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
