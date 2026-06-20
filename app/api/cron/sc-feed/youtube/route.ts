import { NextResponse } from 'next/server'
import {
  fetchYouTubeRss,
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

  const newMsgs: NewMsg[] = []
  const cutoff = freshCutoff()

  let count = 0
  let error: string | null = null
  try {
    count = await fetchYouTubeRss(newMsgs, cutoff)
  } catch (err) {
    error = String(err)
  }

  if (newMsgs.length > 0) {
    await sendPushNotifications(newMsgs).catch(() => {})
  }

  await stampCronHeartbeat('youtube', { ok: !error, count, pushed: newMsgs.length, ...(error ? { error } : {}) })
  return NextResponse.json({ ok: !error, channel: 'sc-youtube', count, pushed: newMsgs.length, ...(error ? { error } : {}) })
}
