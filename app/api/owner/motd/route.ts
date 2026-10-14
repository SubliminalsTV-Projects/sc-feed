import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { auth } from '@/auth'
import { upsertMessage, SPECTRUM_MOTDS } from '@/app/api/cron/sc-feed/_shared'
import { getConfigValue, setConfigValue } from '@/lib/sc-config'
import { fetchHealthy, getAllMotdFetchStatus, getMotdFetchStatus } from '@/app/api/cron/sc-feed/motd'

// Owner-only FALLBACK ingest for a Spectrum MOTD scraped by the browser extension. The primary
// source is the cron's own getMotd fetch (app/api/cron/sc-feed/motd.ts). While that fetch is
// healthy for a channel, a scraped push only stamps the scrape heartbeat and writes no card, so the
// two sources never produce duplicate cards. Owner-gated exactly like /api/owner/rsi-token:
// an owner NextAuth session OR the owner push secret.
//
// The extension posts on EVERY scrape, including unchanged ones, and this route decides which it
// is by comparing against the last signature it stored. That split matters:
//   • a real change  → upsert a new MOTD card (new msg_id, honest ts_raw)
//   • an unchanged   → stamp the scrape heartbeat ONLY
// Never re-upsert unchanged text: upsertMessage overwrites ts_raw on an existing row, so doing so
// would make the card look perpetually new and would mask a dead scraper behind fresh timestamps.
// The heartbeat (`motd_scan_<channelId>`) is what the watchdog reads for liveness — it separates
// "scraper alive, CIG just hasn't changed the MOTD" from "scraper dead", which content age alone
// cannot do. That ambiguity is what let the scraper stay dead for a week in 2026-07.

export const dynamic = 'force-dynamic'

// channelId → label, from the single source of truth. Also the allow-list of valid channels.
const LABELS: Record<string, string> = Object.fromEntries(SPECTRUM_MOTDS.map(m => [m.channelId, m.label]))

function secretOk(req: Request): boolean {
  const secret = process.env.OWNER_PUSH_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!presented) return false
  const a = Buffer.from(presented), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function authorized(req: Request): Promise<boolean> {
  const session = await auth().catch(() => null)
  if (session?.user?.role === 'owner') return true
  return secretOk(req)
}

// Cheap content signature — same algorithm as the extension, so a re-push of identical content
// maps to the same msg_id (idempotent) and a real change makes a new card.
function hashStr(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

export async function POST(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let b: { channelId?: string; body?: string; url?: string; sig?: string }
  try { b = await req.json() as typeof b } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const channelId = String(b.channelId ?? '')
  const body = String(b.body ?? '').trim()
  if (!LABELS[channelId]) return NextResponse.json({ error: 'unknown channelId' }, { status: 400 })
  if (body.length < 4) return NextResponse.json({ error: 'empty MOTD body' }, { status: 422 })

  // The server hashes the body itself rather than trusting the client's `sig`, so the
  // changed/unchanged verdict can't drift when an extension is reinstalled or its cache cleared.
  const sig = hashStr(body)
  const scanKey = `motd_scan_${channelId}`
  const title = body.replace(/\s+/g, ' ').trim().slice(0, 150)
  const nowIso = new Date().toISOString()

  try {
    const lastSig = await getConfigValue(scanKey)
    // Stamp the scrape heartbeat first: even a failed upsert below still proves the scraper ran.
    await setConfigValue(scanKey, sig, { updated_via: 'extension' })

    if (lastSig === sig) return NextResponse.json({ ok: true, isNew: false, unchanged: true })
    if (fetchHealthy(await getMotdFetchStatus(channelId))) {
      return NextResponse.json({ ok: true, isNew: false, skipped: 'server fetch healthy' })
    }

    const isNew = await upsertMessage(channelId, LABELS[channelId], {
      msg_id:        `motd-${channelId}-${sig}`,
      title,
      body,
      url:           String(b.url ?? ''),
      source:        'CIG',
      msg_timestamp: nowIso,
      ts_raw:        nowIso,
      image:         '',
    })
    return NextResponse.json({ ok: true, isNew, unchanged: false })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// Server fetch status per channel, for the extension (it skips its alarm scrape while healthy).
// Codes and times only, never MOTD text or the token.
export async function GET(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  return NextResponse.json({ serverFetch: await getAllMotdFetchStatus() })
}
