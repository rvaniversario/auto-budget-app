import { useRef, useState } from 'react'
import { ChevronRight, Upload } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { alive, formatLongDate, todayISO, transactionsToCSV } from '@/core'
import { parseBackup, repo, type BackupFile } from '@/data'
import { useAppData } from '@/hooks/useAppData'
import { SubHeader } from '@/components/layout'
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
import { canShareBackupFile, lastBackupFile, saveBackupFile, shareBackupFile } from '@/lib/backupFile'
import { downloadFile } from '@/lib/browser'
import { premiumEnabled, useEntitlement } from '@/premium'
import { PremiumBadge } from '@/premium/components'
import { useSync } from '@/sync'

const outline = 'h-[50px] rounded-xl border-input bg-card text-[15px] font-semibold'

function FreeTag() {
  return <span className="flex-none rounded-xl bg-success-tint px-2.5 py-[3px] text-xs font-bold text-success-text">Free</span>
}

/** /backup: free backup without an account. */
export function BackupScreen() {
  const { snapshot } = useAppData()
  const navigate = useNavigate()
  const ent = useEntitlement()
  const sync = useSync()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [, rerender] = useState(0)
  const last = lastBackupFile()
  const share = canShareBackupFile()

  const onSave = async () => {
    await saveBackupFile()
    rerender((n) => n + 1)
    toast.success('Backup file saved', { description: 'Keep it somewhere safe, like Google Drive or email.' })
  }

  const onShare = async () => {
    try {
      if (await shareBackupFile()) {
        rerender((n) => n + 1)
        toast.success('Backup file shared')
      }
    } catch {
      toast.error("Couldn't share the file", { description: 'Save it instead and send it yourself.' })
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    const result = parseBackup(await file.text())
    if (fileRef.current) fileRef.current.value = ''
    if (!result.ok) {
      toast.error("Couldn't restore that file", { description: result.error })
      return
    }
    setPending(result.backup)
  }

  const confirmRestore = async () => {
    if (!pending) return
    await repo.importBackup(pending)
    setPending(null)
    toast.success('Backup restored')
    navigate('/')
  }

  const exportCSV = () => {
    const csv = transactionsToCSV(snapshot.transactions, {
      categories: snapshot.categories,
      accounts: snapshot.accounts,
      fixedBills: snapshot.fixedBills,
    })
    downloadFile(`auto-budget-transactions-${todayISO()}.csv`, csv, 'text/csv;charset=utf-8')
    toast.success('Transactions exported')
  }

  const lastLine = last
    ? `Last saved ${formatLongDate(last.date)}${last.transactions !== null ? ` · ${last.transactions} transaction${last.transactions === 1 ? '' : 's'}` : ''}`
    : 'No backup file saved yet'

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4 md:mx-auto">
      <SubHeader title="Backup and restore" />
      <p className="text-sm leading-normal text-muted-foreground">
        Your data lives on this device. Keep a copy so you don't lose it if you clear your browser or change devices.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose a backup file"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      <section aria-labelledby="backup-file-heading" className="flex flex-col gap-3 rounded-card bg-card px-5 py-[18px]">
        <div className="flex items-center justify-between gap-3">
          <h2 id="backup-file-heading" className="font-sans text-base font-bold">
            Backup file
          </h2>
          <FreeTag />
        </div>
        <p className="text-sm leading-normal text-muted-foreground">{lastLine}</p>
        <Button className="h-[50px] rounded-xl text-[15px] font-semibold" onClick={onSave}>
          Save a backup file
        </Button>
        {share && (
          <Button variant="outline" className={outline} onClick={onShare}>
            Share to Google Drive, email…
          </Button>
        )}
        <Button variant="outline" className={outline} onClick={() => fileRef.current?.click()}>
          Restore from a file
        </Button>
        <p className="text-[13px] leading-normal text-muted-foreground">
          Saving downloads the file to this device. Restoring replaces the data on this device after you confirm.
        </p>
        <button
          type="button"
          onClick={exportCSV}
          className="min-h-11 self-start text-[15px] font-semibold text-link underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Export transactions as a spreadsheet (CSV)
        </button>
      </section>

      {premiumEnabled &&
        (ent.canSync && sync.user ? (
          <Link
            to="/account"
            className="flex items-center justify-between gap-3 rounded-card bg-card px-5 py-[18px] outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex flex-col gap-1">
              <span className="text-base font-bold">Sync across devices</span>
              <span className="text-sm leading-snug text-muted-foreground">On for {sync.user.email}</span>
            </span>
            <ChevronRight className="size-[18px] flex-none text-muted-foreground" aria-hidden="true" />
          </Link>
        ) : (
          <Link
            to="/premium?feature=sync"
            className="flex items-center justify-between gap-3 rounded-card bg-primary px-5 py-[18px] text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-base font-bold">
                Sync across devices
                <PremiumBadge className="bg-card text-success-text" />
              </span>
              <span className="text-sm leading-snug text-hero-muted">Use Auto Budget on your phone, tablet and the web, always up to date.</span>
            </span>
            <ChevronRight className="size-[18px] flex-none" aria-hidden="true" />
          </Link>
        ))}

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your data with this backup?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending &&
                `The backup from ${formatLongDate(pending.exportedAt.slice(0, 10))} has ${alive(pending.data.transactions).length} transactions. Everything currently on this device will be replaced.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRestore}>
              <Upload aria-hidden="true" /> Replace and restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
