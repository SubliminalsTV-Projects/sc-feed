import { NextResponse } from 'next/server'
import { resolveCaller } from '@/lib/sc-saved'
import { getPrefs, putPrefs } from '@/lib/sc-prefs'

// Per-account settings sync. GET returns the caller's stored settings ({ prefs: null } if none
// yet); PUT replaces them. Caller = NextAuth session email (or the owner push secret, same as the
// Saved list). Per-user, so NEVER CDN-cached.

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
// Read state is the big one (a list of message ids); this leaves it plenty of room while
// stopping a runaway client from writing megabytes per save.
const MAX_BYTES = 512 * 1024

export async function GET(req: Request) {
  const email = await resolveCaller(req)
  if (!email) return NextResponse.json({ error: 'sign in to sync' }, { status: 401, headers: NO_STORE })
  try {
    const row = await getPrefs(email)
    return NextResponse.json(row ?? { prefs: null, updated: null }, { headers: NO_STORE })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: NO_STORE })
  }
}

export async function PUT(req: Request) {
  const email = await resolveCaller(req)
  if (!email) return NextResponse.json({ error: 'sign in to sync' }, { status: 401, headers: NO_STORE })

  const raw = await req.text()
  if (raw.length > MAX_BYTES) return NextResponse.json({ error: 'settings too large' }, { status: 413, headers: NO_STORE })

  let prefs: Record<string, string>
  try {
    const body = JSON.parse(raw) as { prefs?: unknown }
    if (!body.prefs || typeof body.prefs !== 'object' || Array.isArray(body.prefs)) throw new Error('prefs must be an object')
    prefs = {}
    for (const [k, v] of Object.entries(body.prefs)) {
      if (typeof v !== 'string') throw new Error(`prefs.${k} must be a string`)
      prefs[k] = v
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400, headers: NO_STORE })
  }

  try {
    const updated = await putPrefs(email, prefs)
    return NextResponse.json({ updated }, { headers: NO_STORE })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: NO_STORE })
  }
}
