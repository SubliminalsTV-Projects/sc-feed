import { NextResponse } from 'next/server'
import { loadRsiToken } from '@/lib/rsi-token'
import { SPECTRUM_HEADERS } from '../../cron/sc-feed/_shared'

export const dynamic = 'force-dynamic'

type AuthHeaders = Record<string, string>
const buildHeaders = (token: string): AuthHeaders => ({
  ...SPECTRUM_HEADERS,
  'X-Rsi-Token': token,
  'Cookie':      `Rsi-Token=${token}`,
})

// Probe the forum endpoint — proves the stored token is a valid session, which is all it's used
// for now (Spectrum forum threads + dev-tracker reads).
//
// NOTE: MOTD validity is intentionally NOT probed here anymore. RSI made `getMotd` moderator-only
// — it returns ErrPermissionDenied even to a logged-in Evocati member from a server context — so
// the MOTD is now scraped in-browser by the extension and pushed to /api/owner/motd. A failing
// getMotd no longer means the token is bad, so gating `valid` on it gave a permanent false alarm.
async function checkForum(authHeaders: AuthHeaders, signal: AbortSignal): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch('https://robertsspaceindustries.com/api/spectrum/forum/channel/threads', {
    method: 'POST',
    signal,
    headers: authHeaders,
    body: JSON.stringify({ channel_id: '1', sort: 'newest', page: 1 }),
  })
  if (res.status === 401 || res.status === 403) return { ok: false, reason: `forum HTTP ${res.status}` }
  const data = await res.json().catch(() => null)
  if (!data?.success) return { ok: false, reason: data?.msg ?? 'forum success=false' }
  return { ok: true }
}

export async function GET() {
  // Validate the same token the cron uses: PocketBase (extension-pushed) first, env fallback.
  // force=true: reflect the CURRENT stored token, never a stale process-cached one.
  const token = await loadRsiToken(true)
  if (!token) {
    return NextResponse.json({ valid: false, reason: 'RSI_TOKEN not configured', forum: false, motd: {} })
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)
  try {
    const forum = await checkForum(buildHeaders(token), ctrl.signal)
    if (!forum.ok) {
      return NextResponse.json({ valid: false, reason: forum.reason, forum: false, motd: {} })
    }
    return NextResponse.json({
      valid: true,
      forum: true,
      motd: {},
      note: 'MOTD is ingested via the extension scrape now (getMotd is moderator-only)',
    })
  } catch (err) {
    return NextResponse.json({ valid: false, reason: String(err), forum: false, motd: {} })
  } finally {
    clearTimeout(timer)
  }
}
