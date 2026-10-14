// Server-side Spectrum MOTD fetch (restored 2026-09-16, flight `motdfix`).
//
// `getMotd` is NOT moderator-only. Spectrum's own web app calls it for every viewer of a lobby, and
// it gates on lobby READ access: anonymous callers get the public `general` lobby's MOTD and
// `ErrPermissionDenied` on the Evocati/testing lobbies. The June 2026 "moderator-only" conclusion
// came from a dead token. So a denial on a testing lobby means exactly one thing: the stored
// `Rsi-Token` is no longer a signed-in Evocati session. That makes every run's result the health
// check — recorded as `motd_fetch_<channelId>` and read by the watchdog, spectrum-health, the owner
// dashboard and the extension (which skips its fallback scrape while this is healthy).
//
// NDA: never log the MOTD text. Status codes and lengths only.

import { eq, max } from 'drizzle-orm'
import { db, messages as messagesTbl } from '@/lib/db'
import { getConfigValue, setConfigValue } from '@/lib/sc-config'
import { SPECTRUM_HEADERS, SPECTRUM_MOTDS, upsertMessage } from './_shared'

// The only code that means "the session is gone". Anything else (HTTP 5xx, NETWORK, …) is RSI or
// the network misbehaving, and says nothing about the token.
export const SESSION_ENDED_CODE = 'ErrPermissionDenied'
// sc-testing-chat: the lobby whose getMotd result decides "is this token a signed-in Evocati session".
export const SPECTRUM_TOKEN_CHECK_LOBBY = '38230'

export type MotdFetchStatus = {
  ok: boolean
  code: string          // 'OK' | 'ErrPermissionDenied' | 'HTTP 503' | 'NETWORK' | …
  at: string            // ISO time of this attempt
  failStreak: number    // consecutive failed runs, 0 after a success
  lastOkAt: string | null
}

type Motd = { message: string; last_modified: number }

// The token is always passed in, never read from the module-cached helper: the caller has already
// loaded it, and a second module instance of lib/rsi-token (seen under tsx) resolves to an empty
// token, which sends an ANONYMOUS request that RSI denies — indistinguishable from a dead session.
export async function fetchSpectrumMotd(lobbyId: string, token: string): Promise<{ ok: boolean; code: string; motd?: Motd }> {
  try {
    const res = await fetch('https://robertsspaceindustries.com/api/spectrum/lobby/getMotd', {
      method: 'POST',
      headers: { ...SPECTRUM_HEADERS, 'X-Rsi-Token': token, 'Cookie': `Rsi-Token=${token}` },
      body: JSON.stringify({ lobby_id: lobbyId }),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    const data = await res.json().catch(() => null) as { success?: number; code?: string; data?: { motd?: Motd } } | null
    if (data?.success) return { ok: true, code: 'OK', motd: data.data?.motd }
    if (data?.code) return { ok: false, code: data.code }
    return { ok: false, code: res.ok ? 'success=false' : `HTTP ${res.status}` }
  } catch {
    return { ok: false, code: 'NETWORK' }
  }
}

const statusKey = (channelId: string) => `motd_fetch_${channelId}`

export async function getMotdFetchStatus(channelId: string): Promise<MotdFetchStatus | null> {
  try {
    const raw = await getConfigValue(statusKey(channelId))
    return raw ? JSON.parse(raw) as MotdFetchStatus : null
  } catch { return null }
}

export async function getAllMotdFetchStatus(): Promise<Record<string, MotdFetchStatus | null>> {
  const out: Record<string, MotdFetchStatus | null> = {}
  for (const m of SPECTRUM_MOTDS) out[m.channelId] = await getMotdFetchStatus(m.channelId)
  return out
}

/** True when this channel's server fetch succeeded within `withinMs`. */
export function fetchHealthy(s: MotdFetchStatus | null, withinMs = 45 * 60_000): boolean {
  return !!s?.ok && Date.now() - new Date(s.at).getTime() < withinMs
}

async function recordMotdFetch(channelId: string, ok: boolean, code: string): Promise<MotdFetchStatus> {
  const prev = await getMotdFetchStatus(channelId)
  const at = new Date().toISOString()
  const status: MotdFetchStatus = {
    ok, code, at,
    failStreak: ok ? 0 : (prev?.failStreak ?? 0) + 1,
    lastOkAt: ok ? at : (prev?.lastOkAt ?? null),
  }
  await setConfigValue(statusKey(channelId), JSON.stringify(status), { updated_via: 'cron' }).catch(() => {})
  return status
}

// Upsert the MOTD as a card only when RSI's last_modified is newer than the newest card already in
// the channel. That keeps one card per real change, and stops a duplicate at the switch-over from
// the extension scrape (whose cards carry the scrape time, which is always after last_modified).
async function upsertIfNewer(channelId: string, label: string, motd: Motd): Promise<boolean> {
  const message = (motd.message ?? '').trim()
  if (!message || !motd.last_modified) return false
  const modified = new Date(motd.last_modified * 1000)
  const [{ newest }] = await db.select({ newest: max(messagesTbl.tsRaw) }).from(messagesTbl)
    .where(eq(messagesTbl.channelId, channelId))
  if (newest && new Date(newest).getTime() >= modified.getTime()) return false

  const url = message.match(/\]\(([^)]+)\)/)?.[1] ?? ''
  const title = message
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)
  const iso = modified.toISOString()
  return upsertMessage(channelId, label, {
    msg_id: `motd-${channelId}-${motd.last_modified}`,
    title, body: message, url, source: 'CIG', msg_timestamp: iso, ts_raw: iso, image: '',
  })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Fetch every MOTD lobby (3.5s apart), record the result, upsert real changes. Never throws. */
export async function runMotdFetch(token: string): Promise<Record<string, { ok: boolean; code: string; isNew?: boolean; failStreak: number }>> {
  const results: Record<string, { ok: boolean; code: string; isNew?: boolean; failStreak: number }> = {}
  for (const [i, m] of SPECTRUM_MOTDS.entries()) {
    if (i > 0) await sleep(3500)
    const r = await fetchSpectrumMotd(m.lobbyId, token)
    const status = await recordMotdFetch(m.channelId, r.ok, r.code)
    let isNew: boolean | undefined
    if (r.ok && r.motd) isNew = await upsertIfNewer(m.channelId, m.label, r.motd).catch(() => false)
    results[m.channelId] = { ok: r.ok, code: r.code, failStreak: status.failStreak, ...(isNew !== undefined ? { isNew } : {}) }
  }
  return results
}
