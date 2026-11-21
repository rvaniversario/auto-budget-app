import { toast } from 'sonner'
import { BUFFER_KEY, formatMoney, possibleDonors, type CategoryRow } from '@/core'
import { repo } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** Cover an overspent category: move budget from another category, or from the buffer. */
export function useCoverOverspend() {
  const { model } = useAppData()
  return async (over: CategoryRow, source: { type: 'category'; row: CategoryRow; amount: number } | { type: 'buffer'; amount: number }) => {
    const entries = [{ key: over.categoryId, amount: over.budget + source.amount }]
    if (source.type === 'category') entries.push({ key: source.row.categoryId, amount: source.row.budget - source.amount })
    else entries.push({ key: BUFFER_KEY, amount: Math.max(0, model.buffer - source.amount) })
    await repo.setBudgetOverrides(model.period.start, entries)
    toast.success(
      `Moved ${formatMoney(source.amount)} from ${source.type === 'category' ? source.row.name : 'your buffer'} to ${over.name}`,
    )
  }
}

export function MoveBudgetDialog({ over, open, onOpenChange }: { over: CategoryRow | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { model } = useAppData()
  const cover = useCoverOverspend()
  if (!over) return null
  const donors = possibleDonors(over.categoryId, model.categoryRows)
  const byId = new Map(model.categoryRows.map((r) => [r.categoryId, r]))

  const pick = async (fn: () => Promise<void>) => {
    await fn()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cover {formatMoney(over.overBy)} for {over.name}</DialogTitle>
          <DialogDescription>Pick where the money comes from. Your card payment stays the same.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col">
          {donors.map((d, i) => {
            const row = byId.get(d.categoryId)!
            const left = d.budget - d.spent
            const amount = Math.min(over.overBy, left)
            return (
              <li key={d.categoryId} className={i ? 'border-t border-border' : ''}>
                <button
                  type="button"
                  onClick={() => pick(() => cover(over, { type: 'category', row, amount }))}
                  className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left hover:bg-muted/50"
                >
                  <span className="flex flex-col">
                    <span className="text-[13px] font-semibold">{d.name}</span>
                    <span className="text-[12px] text-muted-foreground">{formatMoney(left)} left</span>
                  </span>
                  <span className="text-sm font-semibold text-link">
                    {amount < over.overBy ? `Move ${formatMoney(amount)}` : 'Move'}
                  </span>
                </button>
              </li>
            )
          })}
          {model.buffer > 0 && (
            <li className={donors.length ? 'border-t border-border' : ''}>
              <button
                type="button"
                onClick={() => pick(() => cover(over, { type: 'buffer', amount: Math.min(over.overBy, model.buffer) }))}
                className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left hover:bg-muted/50"
              >
                <span className="flex flex-col">
                  <span className="text-[13px] font-semibold">Buffer</span>
                  <span className="text-[12px] text-muted-foreground">{formatMoney(model.buffer)} set aside for surprises</span>
                </span>
                <span className="text-sm font-semibold text-link">Use buffer</span>
              </button>
            </li>
          )}
        </ul>
        {donors.length === 0 && model.buffer === 0 && (
          <p className="text-sm text-muted-foreground">No other category has money left this month. Try lowering a budget on the Budget tab.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
