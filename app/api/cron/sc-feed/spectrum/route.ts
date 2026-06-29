import { NextResponse } from 'next/server'
import { loadRsiToken } from '@/lib/rsi-token'
import {
  SPECTRUM_FORUMS,
  fetchSpectrumForumThreads,
  freshCutoff,
  requireSecret,
  sendPushNotifications,
  stampCronHeartbeat,
  type NewMsg,
} from '../_shared'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauth = requireSecret(request)
  if (unauth) return unauth

  // PocketBase (extension-pushed) token first, env fallback. Required for Spectrum forum reads.
  // force=true: re-read the stored token each cycle so a freshly pushed token is picked up
  // immediately (the server is long-lived; without force it'd keep using the boot-time token).
  if (!(await loadRsiToken(true))) {
    await stampCronHeartbeat('spectrum', { ok: false, error: 'RSI_TOKEN not set' })
    return NextResponse.json({ error: 'RSI_TOKEN not set' }, { status: 500 })
  }

  const results: Record<string, unknown> = {}
  const newMsgs: NewMsg[] = []
  const cutoff = freshCutoff()

  for (const forum of SPECTRUM_FORUMS) {
    try {
      const count = await fetchSpectrumForumThreads(forum.forumId, forum.label, forum.channelId, newMsgs, cutoff)
      results[forum.channelId] = { ok: true, count }
    } catch (err) {
      results[forum.channelId] = { ok: false, error: String(err) }
    }
  }

  // NOTE: Spectrum MOTDs are no longer fetched here. RSI made getMotd moderator-only (denied
  // even to a logged-in Evocati member from a server context), so the MOTD is now scraped from
  // the rendered lobby page by the browser extension and pushed to /api/owner/motd.

  if (newMsgs.length > 0) {
    await sendPushNotifications(newMsgs).catch(() => {})
  }

  const ok = Object.values(results).every((r) => (r as { ok?: boolean }).ok !== false)
  const count = Object.values(results).reduce<number>((n, r) => n + ((r as { count?: number }).count ?? 0), 0)
  await stampCronHeartbeat('spectrum', { ok, count, pushed: newMsgs.length, channels: results })
  return NextResponse.json({ ok: true, channels: results, pushed: newMsgs.length })
}
