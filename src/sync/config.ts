export interface CloudConfig {
  supabaseUrl: string
  supabaseKey: string
  /** Base URL of the project's server functions. */
  apiUrl: string
  googleSignIn: boolean
}

function readConfig(): CloudConfig | null {
  const env = import.meta.env
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '')
  const supabaseKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)?.trim()
  if (!supabaseUrl || !supabaseKey) return null
  return {
    supabaseUrl,
    supabaseKey,
    apiUrl: env.VITE_API_URL?.trim().replace(/\/+$/, '') || `${supabaseUrl}/functions/v1`,
    googleSignIn: env.VITE_GOOGLE_SIGN_IN === 'true',
  }
}

/**
 * Digits in an emailed sign-in code. Must match the Supabase project's "Email OTP
 * Length" (Authentication settings) and `otp_length` in supabase/config.toml.
 */
export const SIGN_IN_CODE_LENGTH = 8

/** Null when the app is built without a backend: it then works exactly as an offline-only app. */
export const cloudConfig = readConfig()
export const cloudEnabled = cloudConfig !== null
