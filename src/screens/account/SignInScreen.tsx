import { useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check } from 'lucide-react'
import { Controller, useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { z } from 'zod'
import { SubHeader } from '@/components/layout'
import { TextInput } from '@/components/inputs'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { cloudConfig, sendSignInCode, signInWithGoogle, useSync } from '@/sync'

/** Optional state passed when another screen sends the user here. */
export interface SignInState {
  /** Shown above the form, e.g. why signing in is needed. */
  message?: string
  /** Where to go once signed in. Defaults to the Account screen. */
  returnTo?: string
}

const schema = z.object({ email: z.email('Enter a valid email address').trim() })

const BENEFITS = ['Get everything back on a new phone', 'Use it on your laptop or tablet too', 'Only your account can read your data']

export function SignInScreen() {
  const sync = useSync()
  const navigate = useNavigate()
  const location = useLocation()
  const nav = (location.state ?? {}) as SignInState
  const [error, setError] = useState<string | null>(null)
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '' } })

  if (sync.user) return <Navigate to={nav.returnTo ?? '/account'} replace />

  const onSubmit = async ({ email }: z.infer<typeof schema>) => {
    setError(null)
    const result = await sendSignInCode(email)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate('/account/verify', { state: { ...nav, email } })
  }

  const google = async () => {
    setError(null)
    const result = await signInWithGoogle(nav.returnTo ?? '/account')
    if (result && !result.ok) setError(result.error)
  }

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-5 md:mx-auto">
      <SubHeader title="" />
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.01em]">Back up your data</h1>
        <p className="text-[15px] leading-normal text-muted-foreground">
          {nav.message ??
            'Sign in to save your budget online. This is optional: without an account, everything stays on this device and the app works the same.'}
        </p>
      </div>

      <ul className="flex flex-col gap-2.5 rounded-card bg-card p-4">
        {BENEFITS.map((b) => (
          <li key={b} className="flex items-center gap-2.5 text-[15px]">
            <Check className="size-5 flex-none text-link" strokeWidth={2.4} aria-hidden="true" />
            {b}
          </li>
        ))}
      </ul>

      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3.5">
        {cloudConfig?.googleSignIn && (
          <>
            <Button type="button" variant="outline" className="h-[54px] rounded-[14px] bg-card text-base font-semibold" onClick={google}>
              Continue with Google
            </Button>
            <div className="flex items-center gap-3 text-[13px] text-muted-foreground" aria-hidden="true">
              <span className="h-px flex-1 bg-input" />
              or
              <span className="h-px flex-1 bg-input" />
            </div>
          </>
        )}
        <Controller
          name="email"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="gap-1.5">
              <FieldLabel htmlFor="si-email" className="text-sm font-semibold">
                Email address
              </FieldLabel>
              <TextInput id="si-email" type="email" autoComplete="email" inputMode="email" aria-invalid={fieldState.invalid} {...field} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        {error && (
          <p role="alert" className="rounded-lg bg-danger-tint px-3.5 py-3 text-sm text-danger-text">
            {error}
          </p>
        )}
        <Button type="submit" className="h-[54px] rounded-[14px] text-base font-semibold" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Sending…' : 'Email me a sign-in code'}
        </Button>
        <p className="text-[13px] leading-normal text-muted-foreground">No password needed. We email you a 6-digit code each time you sign in.</p>
      </form>

      <Button type="button" variant="ghost" className="min-h-11 text-[15px] font-semibold text-link" onClick={() => navigate(-1)}>
        Not now
      </Button>
      <p className="text-center text-xs leading-normal text-muted-foreground">
        By continuing you agree to the{' '}
        <Link to="/privacy" className="text-link underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  )
}
