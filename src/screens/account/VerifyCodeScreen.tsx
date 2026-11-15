import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { repo } from '@/data'
import { SubHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { sendSignInCode, SIGN_IN_CODE_LENGTH, useSync, verifySignInCode } from '@/sync'
import type { SignInState } from './SignInScreen'

const LENGTH = SIGN_IN_CODE_LENGTH
const RESEND_SECONDS = 60

export function VerifyCodeScreen() {
  const sync = useSync()
  const navigate = useNavigate()
  const location = useLocation()
  const nav = (location.state ?? {}) as SignInState & { email?: string }
  const [code, setCode] = useState('')
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(RESEND_SECONDS)
  const inputRef = useRef<HTMLInputElement>(null)
  const transactions = useLiveQuery(async () => (await repo.listTransactions()).length)

  useEffect(() => {
    if (wait <= 0) return
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000)
    return () => window.clearTimeout(id)
  }, [wait])

  if (!nav.email) return <Navigate to="/account/sign-in" replace />
  if (sync.user) return <Navigate to={nav.returnTo ?? '/account'} replace />
  const email = nav.email

  const verify = async (value: string) => {
    if (value.length !== LENGTH || busy) return
    setBusy(true)
    setError(null)
    const result = await verifySignInCode(email, value)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      setCode('')
      inputRef.current?.focus()
      return
    }
    navigate(nav.returnTo ?? '/account', { replace: true })
  }

  const resend = async () => {
    setError(null)
    const result = await sendSignInCode(email)
    if (result.ok) setWait(RESEND_SECONDS)
    else setError(result.error)
  }

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5 md:mx-auto">
      <SubHeader title="" />
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.01em]">Enter the {LENGTH}-digit code</h1>
        <p className="text-[15px] leading-normal text-muted-foreground">
          We sent it to <strong className="font-semibold text-foreground">{email}</strong>. It expires in 10 minutes.
        </p>
      </div>

      <form
        noValidate
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          void verify(code)
        }}
      >
        {/* One real input (so paste and one-time-code autofill work) drawn as one box per digit. */}
        <div className="relative">
          <label htmlFor="otp" className="sr-only">
            Sign-in code
          </label>
          <input
            ref={inputRef}
            id="otp"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={LENGTH}
            value={code}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'otp-error' : undefined}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, LENGTH)
              setCode(digits)
              if (digits.length === LENGTH) void verify(digits)
            }}
            className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
          />
          <div aria-hidden="true" className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${LENGTH}, minmax(0, 1fr))` }}>
            {Array.from({ length: LENGTH }, (_, i) => {
              const active = focused && (i === code.length || (i === LENGTH - 1 && code.length === LENGTH))
              return (
                <div
                  key={i}
                  className={cn(
                    'flex h-[56px] items-center justify-center rounded-lg border bg-card font-heading text-[24px] font-semibold',
                    error ? 'border-danger-bar' : 'border-input',
                    active && 'border-ring ring-3 ring-ring/50',
                  )}
                >
                  {code[i] ?? ''}
                </div>
              )
            })}
          </div>
        </div>
        {error && (
          <p id="otp-error" role="alert" className="rounded-lg bg-danger-tint px-3.5 py-3 text-sm text-danger-text">
            {error}
          </p>
        )}
        <Button type="submit" className="h-[54px] rounded-[14px] text-base font-semibold" disabled={busy || code.length !== LENGTH}>
          {busy ? 'Checking…' : 'Verify and sign in'}
        </Button>
        {wait > 0 ? (
          <p className="text-center text-sm text-muted-foreground" aria-live="polite">
            Resend code in 0:{String(wait).padStart(2, '0')}
          </p>
        ) : (
          <Button type="button" variant="ghost" className="min-h-11 text-[15px] font-semibold text-link" onClick={resend}>
            Resend code
          </Button>
        )}
      </form>

      {!!transactions && (
        <div className="flex flex-col gap-1 rounded-lg bg-success-tint px-4 py-3.5">
          <span className="text-sm font-bold text-success-text">Your existing data comes with you</span>
          <span className="text-sm leading-[1.45]">
            The {transactions} transaction{transactions === 1 ? '' : 's'} already on this device will be saved to your account.
          </span>
        </div>
      )}

      <Link
        to="/account/sign-in"
        replace
        state={{ message: nav.message, returnTo: nav.returnTo }}
        className="flex min-h-11 items-center justify-center rounded-lg text-[15px] font-semibold text-link outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Use a different email
      </Link>
    </div>
  )
}
