/**
 * Sign-in. The only module that uses the Supabase SDK; screens call these
 * functions (through the sync controller), never the SDK.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { cloudConfig } from './config'

export interface CloudUser {
  id: string
  email: string
  provider: 'email' | 'google' | string
}

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient {
  if (!cloudConfig) throw new Error('Online backup is not configured')
  client ??= createClient(cloudConfig.supabaseUrl, cloudConfig.supabaseKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'auto-budget-auth',
    },
  })
  return client
}

export function toCloudUser(user: User | null | undefined): CloudUser | null {
  if (!user) return null
  return { id: user.id, email: user.email ?? '', provider: (user.app_metadata?.provider as string | undefined) ?? 'email' }
}

/** Friendly text for an auth error. */
function message(error: { message?: string; status?: number; code?: string } | null, fallback: string): string {
  if (!error) return fallback
  if (error.status === 429 || error.code === 'over_email_send_rate_limit') return 'Too many attempts. Wait a minute and try again.'
  if (error.code === 'otp_expired' || /expired|invalid/i.test(error.message ?? '')) return 'That code is wrong or has expired. Check it or ask for a new one.'
  if (/fetch|network/i.test(error.message ?? '')) return "You're offline. Connect to the internet and try again."
  return fallback
}

export async function sendSignInCode(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await supabase().auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    return error ? { ok: false, error: message(error, "Couldn't send the code. Try again.") } : { ok: true }
  } catch {
    return { ok: false, error: "You're offline. Connect to the internet and try again." }
  }
}

export async function verifySignInCode(email: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { error } = await supabase().auth.verifyOtp({ email, token: code, type: 'email' })
    return error ? { ok: false, error: message(error, "Couldn't check the code. Try again.") } : { ok: true }
  } catch {
    return { ok: false, error: "You're offline. Connect to the internet and try again." }
  }
}

export async function signInWithGoogle(returnPath = '/account'): Promise<{ ok: false; error: string } | void> {
  const { error } = await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${returnPath}` },
  })
  if (error) return { ok: false, error: message(error, "Couldn't open Google sign-in. Try again.") }
}

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession()
  return data.session?.access_token ?? null
}

/** Sign out on this device only. */
export async function signOutLocally(): Promise<void> {
  await supabase().auth.signOut({ scope: 'local' })
}
