/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL. Leave unset to build without sign-in and online backup. */
  readonly VITE_SUPABASE_URL?: string
  /** Supabase publishable (or legacy anon) key. Public by design. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** Base URL of the server functions. Defaults to `${VITE_SUPABASE_URL}/functions/v1`. */
  readonly VITE_API_URL?: string
  /** "true" to show "Continue with Google" (the provider must be enabled in Supabase). */
  readonly VITE_GOOGLE_SIGN_IN?: string
  /** "true" to show Auto Budget Premium. Needs the backend; off means the app behaves like version 1. */
  readonly VITE_PREMIUM_ENABLED?: string
  /** Shown when a payment is still being confirmed. */
  readonly VITE_SUPPORT_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
