import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { centavosToInput, formatMoney, ordinal, type FixedBill } from '@/core'
import { repo } from '@/data'
import { AmountButton, MoneyInput, TextInput } from '@/components/inputs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { dayField, moneyField, toCentavos } from '@/lib/forms'

const schema = z.object({
  name: z.string().trim().min(1, 'Give the bill a name').max(40),
  amount: moneyField(),
  dueDay: dayField,
})
type Values = z.infer<typeof schema>

export function BillDialog({
  open,
  onOpenChange,
  bill,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  bill?: FixedBill
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', amount: '', dueDay: '' },
  })

  useEffect(() => {
    if (open) {
      form.reset({
        name: bill?.name ?? '',
        amount: bill ? centavosToInput(bill.amount) : '',
        dueDay: bill ? String(bill.dueDay) : '',
      })
    }
  }, [open, bill, form])

  const onSubmit = async (v: Values) => {
    const data = { name: v.name, amount: toCentavos(v.amount), dueDay: Number(v.dueDay) }
    if (bill) await repo.updateFixedBill(bill.id, data)
    else await repo.addFixedBill(data)
    toast.success(bill ? 'Bill updated' : 'Bill added')
    onOpenChange(false)
  }

  const onDelete = async () => {
    if (!bill) return
    await repo.deleteFixedBill(bill.id)
    toast.success(`${bill.name} removed`)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{bill ? 'Edit bill' : 'Add a bill'}</DialogTitle>
            <DialogDescription>Bills you pay every month, like rent, electricity, internet or water.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Controller
              name="name"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="bill-name">Name</FieldLabel>
                  <TextInput id="bill-name" placeholder="Rent" aria-invalid={fieldState.invalid} {...field} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <Controller
                name="amount"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="bill-amount">Amount (₱)</FieldLabel>
                    <MoneyInput id="bill-amount" aria-invalid={fieldState.invalid} {...field} />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                name="dueDay"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="bill-due">Due day</FieldLabel>
                    <TextInput id="bill-due" inputMode="numeric" placeholder="15" aria-invalid={fieldState.invalid} {...field} />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </div>
          </FieldGroup>
          <DialogFooter className="gap-2">
            {bill && (
              <Button type="button" variant="destructive" onClick={onDelete}>
                Delete
              </Button>
            )}
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {bill ? 'Save' : 'Add bill'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** List of fixed bills with a total, as in Settings. */
export function BillsList({ bills, onEdit }: { bills: FixedBill[]; onEdit: (bill: FixedBill) => void }) {
  const total = bills.reduce((acc, b) => acc + b.amount, 0)
  if (bills.length === 0) {
    return <p className="rounded-card bg-card p-4 text-[15px] text-muted-foreground">No bills yet. Add the ones you pay every month.</p>
  }
  return (
    <section aria-label="Your fixed bills" className="flex flex-col rounded-card bg-card px-4 pt-1 pb-3">
      {bills.map((b, i) => (
        <div key={b.id} className={`flex min-h-[60px] items-center justify-between gap-3 ${i ? 'border-t border-border' : ''}`}>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[15px] font-semibold">{b.name}</span>
            <span className="text-[13px] text-muted-foreground">Due every {ordinal(b.dueDay)}</span>
          </div>
          <AmountButton aria-label={`Edit ${b.name}`} onClick={() => onEdit(b)}>
            {formatMoney(b.amount)}
          </AmountButton>
        </div>
      ))}
      <div className="flex items-baseline justify-between border-t-2 border-foreground pt-3">
        <span className="text-[15px] font-bold">Total each month</span>
        <span className="money text-xl font-bold">{formatMoney(total)}</span>
      </div>
    </section>
  )
}
