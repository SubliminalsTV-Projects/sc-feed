import { NextResponse } from 'next/server'
import { pruneOldKbDiffs, pruneOldMessages, requireSecret, stampCronHeartbeat } from '../_shared'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauth = requireSecret(request)
  if (unauth) return unauth

  try {
    const count = await pruneOldMessages()
    const kbDiffs = await pruneOldKbDiffs()
    await stampCronHeartbeat('prune', { ok: true, deleted: count, kbDiffsDeleted: kbDiffs })
    return NextResponse.json({ ok: true, deleted: count, kbDiffsDeleted: kbDiffs })
  } catch (err) {
    await stampCronHeartbeat('prune', { ok: false, error: String(err) })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
