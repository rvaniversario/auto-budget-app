import { useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { resolveChoice, signOut, useSync } from '@/sync'

const plural = (n: number) => `${n} transaction${n === 1 ? '' : 's'}`

/**
 * Shown after sign-in when this device and the account both already have a
 * budget. Merging two budgets would duplicate settings and categories, so the
 * user keeps one of them.
 */
export function LinkChoiceDialog() {
  const sync = useSync()
  const [busy, setBusy] = useState(false)
  const choice = sync.choice
  if (!choice) return null

  const pick = async (keep: 'device' | 'online') => {
    setBusy(true)
    await resolveChoice(keep)
    setBusy(false)
    toast.success(keep === 'online' ? 'Your synced budget is on this device' : 'This device’s budget is now synced')
  }

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Which budget do you want to keep?</AlertDialogTitle>
          <AlertDialogDescription>
            This device and your account both have a budget. Pick one; it replaces the other everywhere. If you might want the other one later,
            sign out and export a backup first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Button className="h-auto min-h-12 flex-col items-start gap-0.5 py-2.5 text-left" disabled={busy} onClick={() => pick('online')}>
            <span className="text-[15px] font-semibold">Keep the online budget</span>
            <span className="text-[13px] font-normal opacity-90">{plural(choice.remoteTransactions)}, replaces this device</span>
          </Button>
          <Button
            variant="outline"
            className="h-auto min-h-12 flex-col items-start gap-0.5 py-2.5 text-left"
            disabled={busy}
            onClick={() => pick('device')}
          >
            <span className="text-[15px] font-semibold">Keep this device’s budget</span>
            <span className="text-[13px] font-normal text-muted-foreground">{plural(choice.localTransactions)}, replaces the online copy</span>
          </Button>
        </div>
        <AlertDialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => void signOut()}>
            Sign out instead
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
