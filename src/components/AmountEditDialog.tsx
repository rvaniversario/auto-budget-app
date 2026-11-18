import { useEffect } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { centavosToInput, checkBudgetEdit, formatMoney, parseMoney, type CategoryKind } from '@/core'
import { useAppData } from '@/hooks/useAppData'
import { MoneyInput } from '@/components/inputs'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { moneyField, toCentavos } from '@/lib/forms'

const schema = z.object({ amount: moneyField({ allowZero: true }) })

/**
 * Edit one line of this month's plan. Any change comes out of (or goes back to)
 * the credit card payment, which may not fall below the minimum due.
 */
export function AmountEditDialog({
  open,
  onOpenChange,
  title,
  description,
  current,
  suggested,
  kind,
  onSave,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  current: number
  suggested?: number
  /** Which total the change applies to in the safe-payment formula. */
  kind: CategoryKind
  onSave: (amount: number) => Promise<void>
  onReset?: () => Promise<void>
}) {
  const { model } = useAppData()
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { amount: '' } })
  const text = useWatch({ control: form.control, name: 'amount' })

  useEffect(() => {
    if (open) form.reset({ amount: centavosToInput(current) })
  }, [open, current, form])

  const next = parseMoney(text ?? '')
  const check = next === null ? null : checkBudgetEdit(model.safeInput, kind, current, next)
  const hasCard = model.safeEnabled && model.cards.length > 0

  const submit = async (v: z.infer<typeof schema>) => {
    const amount = toCentavos(v.amount)
    const result = checkBudgetEdit(model.safeInput, kind, current, amount)
    if (!result.ok) {
      form.setError('amount', { message: result.message })
      return
    }
    await onSave(amount)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit(submit)} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Controller
            name="amount"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || (check !== null && !check.ok)} className="gap-1.5">
                <FieldLabel htmlFor="edit-amount" className="text-sm font-semibold">
                  Amount for this month (₱)
                </FieldLabel>
                <MoneyInput id="edit-amount" large autoFocus aria-invalid={fieldState.invalid} {...field} />
                {check && !check.ok ? (
                  <FieldError>{check.message}</FieldError>
                ) : (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
          {hasCard && check?.ok && next !== current && (
            <p className="rounded-lg bg-success-tint p-3 text-sm" aria-live="polite">
              Card payment changes from {formatMoney(check.before.amount)} to{' '}
              <strong className="money">{formatMoney(check.after.amount)}</strong>.
            </p>
          )}
          {suggested !== undefined && suggested !== current && (
            <p className="text-[13px] text-muted-foreground">Suggested from last month: {formatMoney(suggested)}</p>
          )}
          <DialogFooter className="gap-2">
            {onReset && (
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await onReset()
                  onOpenChange(false)
                }}
              >
                Use suggested
              </Button>
            )}
            <Button type="submit" disabled={form.formState.isSubmitting || (check !== null && !check.ok)}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
