import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { SubHeader, Tag } from '@/components/layout'
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
import { backupStatus, deleteAccount, describeDevices, formatWhen, loadRemoteStatus, signOut, syncNow, thisDeviceId, useSync } from '@/sync'

function Row({ label, value, warn, first }: { label: string; value: string; warn?: boolean; first?: boolean }) {
  return (
    <div className={`flex min-h-12 items-center justify-between gap-3 ${first ? '' : 'border-t border-border'}`}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-right text-[15px] font-semibold ${warn ? 'text-warning-text' : ''}`}>{value}</span>
    </div>
  )
}

export function AccountScreen() {
  const sync = useSync()
  const navigate = useNavigate()
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    void thisDeviceId().then(setDeviceId)
  }, [])
  useEffect(() => {
    if (sync.linked && sync.phase === 'idle') void loadRemoteStatus()
  }, [sync.linked, sync.phase, sync.lastSyncedAt])

  if (!sync.ready) return <div aria-busy="true" />
  if (!sync.user) return <Navigate to="/account/sign-in" replace />

  const status = backupStatus(sync)
  const offline = sync.phase === 'offline'
  const online = sync.remote ? (sync.remote.counts.transactions ?? 0) : undefined
  const changes = `${sync.pending} change${sync.pending === 1 ? '' : 's'}`

  let note = 'Changes back up automatically. When you are offline, they wait on this device and upload once you are connected again.'
  if (offline && sync.pending) note = `You are offline. Your ${changes} are safe on this device and will back up automatically as soon as you are connected again.`
  if (sync.error) note = sync.error

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5 md:mx-auto">
      <SubHeader title="Account and backup" />

      <section aria-label="Account" className="flex flex-col gap-0.5 rounded-card bg-card p-4">
        <span className="text-base font-bold break-all">{sync.user.email}</span>
        <span className="text-[13px] text-muted-foreground">
          {sync.user.provider === 'google' ? 'Signed in with Google' : 'Signed in with an email code'}
        </span>
      </section>

      <section aria-labelledby="backup-heading" className="flex flex-col gap-3 rounded-card bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="backup-heading" className="font-sans text-base font-bold">
            Backup
          </h2>
          <span aria-live="polite">
            <Tag tone={status.tone}>{status.label}</Tag>
          </span>
        </div>
        <div className="flex flex-col">
          <Row first label="Last backed up" value={formatWhen(sync.lastSyncedAt)} />
          <Row label="Saved online" value={online === undefined ? '…' : `${online} transaction${online === 1 ? '' : 's'}`} />
          {sync.pending > 0 && <Row label="Waiting on this device" value={changes} warn />}
          <Row label="Devices" value={sync.remote ? describeDevices(sync.remote.devices, deviceId) : '…'} />
        </div>
        <p className="border-t border-border pt-3 text-[13px] leading-normal text-muted-foreground">{note}</p>
        <Button
          variant="outline"
          className="h-12 rounded-lg border-primary bg-card text-[15px] font-semibold text-link disabled:border-input disabled:text-muted-foreground"
          disabled={offline || sync.phase === 'syncing' || !sync.linked}
          onClick={async () => {
            await syncNow()
            await loadRemoteStatus()
          }}
        >
          {offline ? 'Back up now (needs a connection)' : sync.phase === 'syncing' ? 'Backing up…' : 'Back up now'}
        </Button>
      </section>

      <div className="flex flex-col gap-2.5">
        <Button
          variant="outline"
          className="h-[52px] rounded-[14px] bg-card text-base font-semibold"
          onClick={async () => {
            await signOut()
            toast.success('Signed out', { description: 'Your data is still on this device.' })
            navigate('/settings', { replace: true })
          }}
        >
          Sign out
        </Button>
        <p className="text-center text-[13px] leading-normal text-muted-foreground">
          Signing out keeps your data on this device. It stops backing up until you sign in again.
        </p>
      </div>

      <Button variant="ghost" className="min-h-11 text-[15px] font-semibold text-danger-bar hover:text-danger-bar" onClick={() => setConfirmDelete(true)}>
        Delete account and online data
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your account and everything saved online, on every device you signed in on. The data on this device stays
              here. It can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault()
                setDeleting(true)
                const result = await deleteAccount()
                setDeleting(false)
                if (!result.ok) {
                  toast.error("Couldn't delete your account", { description: result.error })
                  return
                }
                setConfirmDelete(false)
                toast.success('Account deleted', { description: 'Your online data is gone. This device still has your budget.' })
                navigate('/settings', { replace: true })
              }}
            >
              {deleting ? 'Deleting…' : 'Delete account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
