import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { formatLongDate } from '@/core'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { safeStorage } from '@/lib/browser'
import { APP_VERSION, RELEASES } from '@/lib/releases'
import { cn } from '@/lib/utils'

const SEEN_KEY = 'auto-budget:whats-new-seen'

/**
 * The app version as a header button. A dot marks a version whose notes
 * haven't been opened on this device yet; tapping opens What's new.
 */
export function WhatsNew({ className }: { className?: string }) {
  const [seen, setSeen] = useState(() => safeStorage.get(SEEN_KEY) === APP_VERSION)

  const onOpenChange = (open: boolean) => {
    if (open && !seen) {
      safeStorage.set(SEEN_KEY, APP_VERSION)
      setSeen(true)
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`What's new in version ${APP_VERSION}${seen ? '' : ', not read yet'}`}
          className={cn(
            'relative flex h-9 flex-none items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[12px] font-semibold text-foreground hover:bg-muted',
            'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            className,
          )}
        >
          <Sparkles className="size-4 text-link" aria-hidden="true" />
          v{APP_VERSION}
          {!seen && <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-danger-bar" />}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
          <DialogDescription>You're on Auto Budget v{APP_VERSION}.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-5">
          {RELEASES.map((r) => (
            <section key={r.version} aria-label={`Version ${r.version}`} className="flex flex-col gap-2">
              <h3 className="flex items-baseline justify-between gap-3 font-sans text-[13px] font-bold">
                v{r.version}
                <span className="text-[12px] font-normal text-muted-foreground">{formatLongDate(r.date)}</span>
              </h3>
              <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-[1.45]">
                {r.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
