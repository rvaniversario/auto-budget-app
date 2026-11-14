// Helpers shared by every server function: CORS, JSON responses and the
// signed-in caller.

import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.119.0'

const ALLOWED_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0] ?? ''
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-device-id, x-device-label',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

export function errorResponse(req: Request, status: number, message: string): Response {
  return json(req, { error: message }, status)
}

export function preflight(req: Request): Response | null {
  return req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: corsHeaders(req) }) : null
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name)
    if (value) return value
  }
  throw new Error(`Missing environment variable ${names[0]}`)
}

export const SUPABASE_URL = () => env('SUPABASE_URL')
const anonKey = () => env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY')
const serviceKey = () => env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY')

export interface Caller {
  user: User
  /** Acts as the user: row-level security applies. */
  db: SupabaseClient
}

/** The signed-in user making the request, or null when the token is missing or invalid. */
export async function getCaller(req: Request): Promise<Caller | null> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return null
  const db = createClient(SUPABASE_URL(), anonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) return null
  return { user: data.user, db }
}

/** Service-role client: bypasses row-level security. Server code only. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL(), serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } })
}
