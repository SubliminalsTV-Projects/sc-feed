import { NextResponse } from 'next/server'
import { SPECTRUM_MOTDS, SPECTRUM_HEADERS } from '../../cron/sc-feed/_shared'

export const dynamic = 'force-dynamic'

const RSI_TOKEN = process.env.RSI_TOKEN ?? ''

const authHeaders = {
  ...SPECTRUM_HEADERS,
  'X-Rsi-Token': RSI_TOKEN,
  'Cookie':      `Rsi-Token=${RSI_TOKEN}`,
}

// Probe the public forum endpoint — proves the token is a valid session.
// Works even for a non-Evocati account, so a pass here does NOT prove MOTD access.
async function checkForum(signal: AbortSignal): Promise<{ ok: boolean; reason?: string }> {
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

// Probe getMotd for a gated lobby. This is the Evocati-gated call the forum check can't see.
// success:1            → accessible (message may be empty if no MOTD is currently set)
// success:0 / Err...   → account lacks access to this lobby (e.g. Evocati wave closed)
async function checkMotd(lobbyId: string, signal: AbortSignal): Promise<{ ok: boolean; code: string }> {
  const res = await fetch('https://robertsspaceindustries.com/api/spectrum/lobby/getMotd', {
    method: 'POST',
    signal,
    headers: authHeaders,
    body: JSON.stringify({ lobby_id: lobbyId }),
  })
  if (res.status === 401 || res.status === 403) return { ok: false, code: `HTTP ${res.status}` }
  const data = await res.json().catch(() => null)
  if (data?.success) return { ok: true, code: 'OK' }
  return { ok: false, code: data?.code ?? 'success=false' }
}

export async function GET() {
  if (!RSI_TOKEN) {
    return NextResponse.json({ valid: false, reason: 'RSI_TOKEN not configured', forum: false, motd: {} })
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8000)

  try {
    const forum = await checkForum(ctrl.signal)

    // Probe every configured MOTD lobby so a lapsed-Evocati token can't pass silently.
    const motdResults = await Promise.all(
      SPECTRUM_MOTDS.map(async (m) => [m.channelId, await checkMotd(m.lobbyId, ctrl.signal)] as const),
    )
    const motd = Object.fromEntries(motdResults.map(([id, r]) => [id, r.code]))
    const motdFailed = motdResults.filter(([, r]) => !r.ok)

    // A truly invalid/expired token fails the forum probe — report that first.
    if (!forum.ok) {
      return NextResponse.json({ valid: false, reason: forum.reason, forum: false, motd })
    }

    // Forum works but MOTD is denied → token is a valid session on an account that
    // has lost Evocati/PTU access. This is the case the old check missed entirely.
    if (motdFailed.length > 0) {
      const detail = motdFailed.map(([id, r]) => `${id}:${r.code}`).join(', ')
      return NextResponse.json({
        valid: false,
        reason: `MOTD access denied (${detail}) — token valid but account lacks Evocati access`,
        forum: true,
        motd,
      })
    }

    return NextResponse.json({ valid: true, forum: true, motd })
  } catch (err) {
    return NextResponse.json({ valid: false, reason: String(err), forum: false, motd: {} })
  } finally {
    clearTimeout(timer)
  }
}
