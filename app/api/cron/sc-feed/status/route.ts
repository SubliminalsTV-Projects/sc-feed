import { NextResponse } from 'next/server'
import { fetchRsiStatusRss, requireSecret, stampCronHeartbeat } from '../_shared'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauth = requireSecret(request)
  if (unauth) return unauth

  // No push for RSI status — informational, not news
  try {
    const count = await fetchRsiStatusRss()
    await stampCronHeartbeat('status', { ok: true, count })
    return NextResponse.json({ ok: true, channel: 'rsi-status', count })
  } catch (err) {
    const cause = (err as { cause?: unknown })?.cause
    await stampCronHeartbeat('status', { ok: false, error: String(err) })
    return NextResponse.json({
      ok: false,
      channel: 'rsi-status',
      error: String(err),
      cause: cause ? { name: (cause as Error).name, message: (cause as Error).message, code: (cause as { code?: string }).code, errno: (cause as { errno?: number }).errno } : null,
    }, { status: 500 })
  }
}
