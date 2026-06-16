// Server-only PocketBase superuser client. Used ONLY for the locked `sc_feed_config`
// collection (admin-only rules) — the public feed still reads the open collections through
// the unauthenticated /api/pb proxy. The admin token never reaches the browser.
//
// PB superuser tokens are session-scoped (~14d default). Module-scoped cache; re-login on
// 401. Mirrors subliminal.gg's lib/pb.ts so the two apps behave identically against the
// shared PocketBase at mc-db.subliminal.gg.

const PB_URL = process.env.POCKETBASE_URL ?? 'https://mc-db.subliminal.gg'
const TOKEN_TTL_MS = 12 * 24 * 60 * 60 * 1000 // 12d, refresh before PB's 14d expiry

let cached: { token: string; at: number } | null = null
let inFlight: Promise<string> | null = null

async function login(): Promise<string> {
  const identity = process.env.PB_ADMIN_EMAIL
  const password = process.env.PB_ADMIN_PASSWORD
  if (!identity || !password) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD not set')
  const res = await fetch(`${PB_URL}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`PB admin login failed: ${res.status} ${await res.text().catch(() => '')}`)
  const { token } = (await res.json()) as { token: string }
  cached = { token, at: Date.now() }
  return token
}

async function getToken(force = false): Promise<string> {
  if (!force && cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached.token
  if (inFlight) return inFlight
  inFlight = login().finally(() => { inFlight = null })
  return inFlight
}

/** Authenticated PB fetch with the superuser token. Auto-refreshes once on 401. */
export async function pbAdminFetch(path: string, opts: RequestInit & { retryOn401?: boolean } = {}): Promise<Response> {
  const { retryOn401 = true, headers, ...rest } = opts
  const token = await getToken()
  const run = (t: string) => fetch(`${PB_URL}${path.startsWith('/') ? path : `/${path}`}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', Authorization: t, ...headers },
    cache: 'no-store',
  })
  let res = await run(token)
  if (res.status === 401 && retryOn401) res = await run(await getToken(true))
  return res
}
