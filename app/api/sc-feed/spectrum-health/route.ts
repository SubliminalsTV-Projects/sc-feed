import { NextResponse } from 'next/server'
import { loadRsiToken } from '@/lib/rsi-token'
import { SESSION_ENDED_CODE, getAllMotdFetchStatus } from '../../cron/sc-feed/motd'

export const dynamic = 'force-dynamic'

// Is the stored RSI token a working signed-in Evocati session?
//
// Answered from the cron's last real getMotd result (motd_fetch_<channel>), not a live probe:
// anonymous callers pass the forum read, so the old forum probe proved nothing, and a live probe
// here would spend Sub's token on RSI every time the owner page loads. `ErrPermissionDenied` on a
// testing lobby is exact: the session has ended. Other codes are RSI/network trouble.
export async function GET() {
  if (!(await loadRsiToken(true))) {
    return NextResponse.json({ valid: false, reason: 'RSI_TOKEN not configured', motd: {} })
  }
  const status = await getAllMotdFetchStatus()
  const motd = Object.fromEntries(Object.entries(status).map(([ch, s]) => [ch, s?.code ?? 'never fetched']))
  const sc = status['motd-sc']
  if (!sc) return NextResponse.json({ valid: false, reason: 'MOTD fetch has not run yet', motd })
  if (sc.ok) return NextResponse.json({ valid: true, checkedAt: sc.at, motd })
  const reason = sc.code === SESSION_ENDED_CODE
    ? `RSI session ended — sign in to RSI once in Chrome (getMotd denied ${sc.failStreak}× in a row, last OK ${sc.lastOkAt ?? 'never'})`
    : `MOTD fetch failing (${sc.code}) — RSI or network trouble, not necessarily the token`
  return NextResponse.json({ valid: false, reason, checkedAt: sc.at, motd })
}
