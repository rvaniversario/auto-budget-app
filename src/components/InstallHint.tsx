import { useEffect, useState } from 'react'
import { Share, X } from 'lucide-react'
import { isIOS, isSafari, isStandalone, safeStorage } from '@/lib/browser'

const KEY = 'auto-budget:ios-install-hint-shown'

/** One-time hint for iPhone Safari users: Share → Add to Home Screen. */
export function InstallHint() {
  const [show, setShow] = useState(() => !safeStorage.get(KEY) && isIOS() && isSafari() && !isStandalone())

  // Remember that the hint was shown so it only appears once.
  useEffect(() => {
    if (show) safeStorage.set(KEY, '1')
  }, [show])

  if (!show) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[calc(96px+env(safe-area-inset-bottom))] z-50 mx-auto w-[calc(100%-32px)] max-w-[448px] rounded-card bg-ink p-4 pr-12 text-sm leading-normal text-ink-foreground shadow-lg"
    >
      <p className="font-semibold">Install Auto Budget</p>
      <p>
        Tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> then <strong>Add to Home Screen</strong> to open it like an
        app, even offline.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setShow(false)}
        className="absolute top-2 right-2 flex size-11 items-center justify-center rounded-lg"
      >
        <X className="size-5" />
      </button>
    </div>
  )
}
