import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { auth } from '@/auth'
import { getConfigStatus, getConfigValue, setConfigValue } from '@/lib/sc-config'
import { resetRsiTokenCache } from '@/lib/rsi-token'
import { SESSION_ENDED_CODE, SPECTRUM_TOKEN_CHECK_LOBBY, fetchSpectrumMotd, getMotdFetchStatus } from '@/app/api/cron/sc-feed/motd'

// Owner-only endpoint that stores Sub's RSI session cookie (`Rsi-Token`) into the locked
// `sc_feed_config` singleton, replacing the manual DevTools copy-paste. The browser
// extension POSTs here whenever the cookie changes.
//
// "Only my token" is enforced at THREE layers: (1) this auth gate — owner NextAuth session
// OR the owner-held push secret, never a plain guest; (2) the value always lands in THE one
// `rsi_token` row (sc-config upserts, never inserts per-user); (3) the PB collection itself
// is admin-only (no open writes). A signed-in guest hitting this gets 403.
//
// NOTE: never probe RSI's identify endpoint with the token — it reports anonymous for a valid token
// from a server, and the extension's identify probe logged Sub out in June 2026. The only check is
// the read-only getMotd guard below.
// The cron uses the token for getMotd (app/api/cron/sc-feed/motd.ts) and forum/dev-tracker reads.
// Whether it is a signed-in Evocati session shows up in the recorded getMotd result, not here.

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

  // Two browsers can push (Sub's Chrome and the always-on VPS browser). RSI keeps one session per
  // account, so one of them may hold a dead token and keep pushing it. Never let a push replace a
  // WORKING token with one that cannot read the Evocati lobby: while the last server fetch is OK,
  // a different token must pass one read-only getMotd first. If the current token is already
  // failing, accept anything — it cannot make things worse.
  try {
    const current = await getConfigValue(KEY)
    const working = (await getMotdFetchStatus('motd-sc'))?.ok === true
    if (token !== current && working) {
      const probe = await fetchSpectrumMotd(SPECTRUM_TOKEN_CHECK_LOBBY, token)
      if (!probe.ok && probe.code === SESSION_ENDED_CODE) {
        return NextResponse.json({ error: 'token cannot read the Evocati lobby; keeping the working token', code: probe.code }, { status: 409 })
      }
    }
  } catch { /* guard is best-effort; fall through and store */ }

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
