import { NextResponse } from 'next/server'
import { loadRsiToken, rsiTokenValue } from '@/lib/rsi-token'
import {
  fetchCommLinkBody,
  fetchTrackerDevContent,
  requireSecret,
  stampCronHeartbeat,
  upsertMessage,
} from '../_shared'
import {
  DIRECT_CHANNELS,
  fetchCommLinkListing,
  fetchRedditStaff,
  fetchStaffPosts,
  parseTimeAgo,
  staffHitToRow,
  storedRow,
  type DirectRow,
} from '../direct'
import { checkTrackerGaps } from '../direct-gaps'
import { getConfigValue, setConfigValue } from '@/lib/sc-config'

export const dynamic = 'force-dynamic'

// A dev post edited within this window is re-enriched; older ones keep their stored body.
const REENRICH_MS = 2 * 60 * 60 * 1000
// Reddit counts as failing only after this long with neither Arctic Shift search getting through.
const REDDIT_STALE_MS = 2 * 60 * 60 * 1000

// Shadow mode: no push notifications from this route. The same posts still arrive through
// TrackerSC (cig-news) until these channels replace it.
export async function GET(request: Request) {
  const unauth = requireSecret(request)
  if (unauth) return unauth

  const results: Record<string, unknown> = {}

  // ── Comm-Links ──
  try {
    const items = await fetchCommLinkListing()
    let added = 0
    for (const it of items) {
      const msgId = `commlink-${it.id}`
      const stored = await storedRow(msgId)
      // No exact publish time exists. Keep the first-seen time once stored.
      const ts = (stored?.tsRaw ?? parseTimeAgo(it.postedAgo)).toISOString()
      const row: DirectRow = {
        msg_id: msgId,
        title: it.title,
        // Rendered body (local runner only) beats the listing's one-line excerpt.
        body: stored?.body || await fetchCommLinkBody(it.url, it.title) || it.excerpt,
        url: it.url,
        source: 'Comm-Link',
        msg_timestamp: ts,
        ts_raw: ts,
        image: it.image || stored?.image || '',
      }
      if (await upsertMessage(DIRECT_CHANNELS.commlink.id, DIRECT_CHANNELS.commlink.label, row)) added++
    }
    results.commlink = { ok: true, count: items.length, added }
  } catch (err) {
    results.commlink = { ok: false, error: String(err) }
  }

  // ── Spectrum dev posts ──
  try {
    // Only enrichment reads the token (fetchTrackerDevContent, as the TrackerSC branch does);
    // the search itself is anonymous.
    await loadRsiToken(true)
    const hits = await fetchStaffPosts(1)
    // 25 per page. A full page that is all from the last hour means a burst: read one more.
    if (hits.length === 25 && Date.parse(hits[24]._source.time_created) > Date.now() - 3600e3) {
      hits.push(...await fetchStaffPosts(2))
    }
    let added = 0, enriched = 0
    for (const h of hits) {
      const row = staffHitToRow(h)
      if (!row) continue
      const stored = await storedRow(row.msg_id)
      const modified = Date.parse(h._source.time_modified ?? h._source.time_created)
      if (stored?.body && Date.now() - modified > REENRICH_MS) {
        row.body = stored.body
        row.image = stored.image
      } else if (rsiTokenValue()) {
        const devName = row.source.split('||')[1] ?? ''
        const rich = await fetchTrackerDevContent(row.url, devName)
        if (rich.body) { row.body = rich.body; enriched++ }
        row.image = rich.image || stored?.image || ''
      }
      if (await upsertMessage(DIRECT_CHANNELS.devpost.id, DIRECT_CHANNELS.devpost.label, row)) added++
    }
    results.devpost = { ok: true, count: hits.length, added, enriched }
  } catch (err) {
    results.devpost = { ok: false, error: String(err) }
  }

  // ── Reddit dev posts (Arctic Shift archive) ──
  try {
    const { rows, errors } = await fetchRedditStaff()
    let added = 0
    for (const row of rows) {
      if (await upsertMessage(DIRECT_CHANNELS.reddit.id, DIRECT_CHANNELS.reddit.label, row)) added++
    }
    // A refused search is routine (see fetchRedditStaff). Only call it a failure once nothing
    // has come through for REDDIT_STALE_MS.
    const now = Date.now()
    if (errors.length < 2) await setConfigValue('direct_reddit_last_ok', new Date(now).toISOString(), { updated_via: 'cron' })
    const lastOk = Date.parse(await getConfigValue('direct_reddit_last_ok').catch(() => '') || '') || 0
    results.reddit = { ok: now - lastOk < REDDIT_STALE_MS, count: rows.length, added, ...(errors.length ? { skipped: errors } : {}) }
  } catch (err) {
    results.reddit = { ok: false, error: String(err) }
  }

  const ok = Object.values(results).every((r) => (r as { ok?: boolean }).ok !== false)
  const count = Object.values(results).reduce<number>((n, r) => n + ((r as { count?: number }).count ?? 0), 0)

  // Side-by-side: flag anything TrackerSC relayed that we still lack (see ../direct-gaps.ts).
  let gaps: unknown
  try { gaps = await checkTrackerGaps() } catch (err) { gaps = { error: String(err) } }

  await stampCronHeartbeat('direct', { ok, count, channels: results, gaps })
  return NextResponse.json({ ok, channels: results, gaps })
}
