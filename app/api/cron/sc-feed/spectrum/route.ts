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
import { runMotdFetch } from '../motd'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauth = requireSecret(request)
  if (unauth) return unauth

  // PocketBase (extension-pushed) token first, env fallback. Required for Spectrum forum reads.
  // force=true: re-read the stored token each cycle so a freshly pushed token is picked up
  // immediately (the server is long-lived; without force it'd keep using the boot-time token).
  const token = await loadRsiToken(true)
  if (!token) {
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

  // Spectrum MOTDs — fetched server-side with the stored token (see ../motd.ts). Each result is
  // recorded as motd_fetch_<channel>; that record IS the session health check. Upsert only, no
  // push (MOTD changes are informational, not news).
  const motd = await runMotdFetch(token)

  if (newMsgs.length > 0) {
    await sendPushNotifications(newMsgs).catch(() => {})
  }

  const ok = Object.values(results).every((r) => (r as { ok?: boolean }).ok !== false)
  const count = Object.values(results).reduce<number>((n, r) => n + ((r as { count?: number }).count ?? 0), 0)
  await stampCronHeartbeat('spectrum', { ok, count, pushed: newMsgs.length, channels: results, motd })
  return NextResponse.json({ ok: true, channels: results, motd, pushed: newMsgs.length })
}
