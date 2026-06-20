import { NextResponse } from 'next/server'
import { loadRsiToken } from '@/lib/rsi-token'
import {
  SPECTRUM_FORUMS,
  SPECTRUM_MOTDS,
  fetchSpectrumForumThreads,
  fetchSpectrumMotd,
  freshCutoff,
  requireSecret,
  sendPushNotifications,
  stampCronHeartbeat,
  upsertMessage,
  type NewMsg,
} from '../_shared'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauth = requireSecret(request)
  if (unauth) return unauth

  // PocketBase (extension-pushed) token first, env fallback. Required for Spectrum/MOTD.
  if (!(await loadRsiToken())) {
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

  // Spectrum MOTDs — upsert only, no push (MOTD changes are informational, not news)
  for (const motd of SPECTRUM_MOTDS) {
    try {
      const parsed = await fetchSpectrumMotd(motd.lobbyId, motd.label)
      await upsertMessage(motd.channelId, motd.label, parsed)
      results[motd.channelId] = { ok: true }
    } catch (err) {
      results[motd.channelId] = { ok: false, error: String(err) }
    }
  }

  if (newMsgs.length > 0) {
    await sendPushNotifications(newMsgs).catch(() => {})
  }

  const ok = Object.values(results).every((r) => (r as { ok?: boolean }).ok !== false)
  const count = Object.values(results).reduce<number>((n, r) => n + ((r as { count?: number }).count ?? 0), 0)
  await stampCronHeartbeat('spectrum', { ok, count, pushed: newMsgs.length, channels: results })
  return NextResponse.json({ ok: true, channels: results, pushed: newMsgs.length })
}
