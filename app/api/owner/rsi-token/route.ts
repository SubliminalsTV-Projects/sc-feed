import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { auth } from '@/auth'
import { getConfigStatus, setConfigValue } from '@/lib/sc-config'
import { resetRsiTokenCache } from '@/lib/rsi-token'

// Owner-only endpoint that stores Sub's RSI session cookie (`Rsi-Token`) into the locked
// `sc_feed_config` singleton, replacing the manual DevTools copy-paste. The browser
// extension POSTs here whenever the cookie changes.
//
// "Only my token" is enforced at THREE layers: (1) this auth gate — owner NextAuth session
// OR the owner-held push secret, never a plain guest; (2) the value always lands in THE one
// `rsi_token` row (sc-config upserts, never inserts per-user); (3) the PB collection itself
// is admin-only (no open writes). A signed-in guest hitting this gets 403.
//
// NOTE: there is deliberately NO "is this token logged in?" probe. RSI's identify endpoint
// can't be verified from a server context — it reports anonymous for a perfectly valid token
// (member resolution needs browser-only context), so the old probe rejected every real push.
// The token is used only for forum/dev-tracker reads now; the MOTD is scraped in-browser by the
// extension and pushed to /api/owner/motd, since RSI made getMotd moderator-only.

export const dynamic = 'force-dynamic'

const KEY = 'rsi_token'

function secretOk(req: Request): boolean {
  const secret = process.env.OWNER_PUSH_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!presented) return false
  const a = Buffer.from(presented), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function authorize(req: Request): Promise<{ ok: boolean; via: 'session' | 'secret' | null; who: string }> {
  const session = await auth().catch(() => null)
  if (session?.user?.role === 'owner') return { ok: true, via: 'session', who: session.user.email ?? 'owner' }
  if (secretOk(req)) return { ok: true, via: 'secret', who: 'extension' }
  return { ok: false, via: null, who: '' }
}

export async function POST(req: Request) {
  const a = await authorize(req)
  if (!a.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let token = ''
  try { token = String(((await req.json()) as { token?: unknown }).token ?? '').trim() }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  // Sanity-check it looks like a session cookie, not an empty/garbage value, so a broken
  // extension push can't wipe a working token.
  if (token.length < 16 || /\s/.test(token)) {
    return NextResponse.json({ error: 'token missing or malformed' }, { status: 422 })
  }

  try {
    await setConfigValue(KEY, token, { updated_by: a.who, updated_via: a.via === 'secret' ? 'extension' : 'owner-session' })
    resetRsiTokenCache() // long-lived server: drop the cached token so the next fetch uses this one
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// Status for the extension popup / owner UI. Never returns the token value itself.
export async function GET(req: Request) {
  const a = await authorize(req)
  if (!a.ok) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try { return NextResponse.json(await getConfigStatus(KEY)) }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }) }
}
