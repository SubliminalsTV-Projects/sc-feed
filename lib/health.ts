// Owner-backend health snapshot. Read-only aggregate over the Timescale `scfeed` schema +
// the cron heartbeats stamped by the per-source endpoints (lib/sc-config / _shared). Used by
// app/owner/page.tsx. Live RSI-token validity is NOT here — it needs an external probe and is
// fetched client-side from /api/sc-feed/spectrum-health so the page renders instantly.

import { like } from 'drizzle-orm'
import { db, sql, config } from './db'

export type DbHealth = { ok: boolean; latencyMs: number | null; error?: string }
export type SourceHealth = {
  channelId: string
  label: string
  lastTs: string | null
  ageMs: number | null
  lastUrl: string | null
  count24h: number
  total: number
}
export type CronHealth = {
  source: string
  lastRun: string | null
  ageMs: number | null
  ok: boolean
  summary: Record<string, unknown>
}
export type Counts = {
  messagesTotal: number
  messages24h: number
  kbSnapshots: number
  kbDiffs: number
  kbLastDiff: string | null
  saved: number
  pushSubs: number
}
export type Health = { db: DbHealth; cron: CronHealth[]; sources: SourceHealth[]; counts: Counts }

// The 5 cron endpoints, in run order. We list them explicitly so a never-fired source still
// shows as a (missing) row rather than silently vanishing.
const CRON_SOURCES = ['discord', 'spectrum', 'status', 'youtube', 'prune'] as const

// Friendly labels for the channel_ids the cron (+ Minion) write. Unknown ids fall back to raw.
const SOURCE_LABELS: Record<string, string> = {
  '1484315008216207450':  'SC News (Discord)',
  '1484315784816627903':  'Patch News (Discord)',
  '933047593666236487':   'CIG / Tracker SC (Discord)',
  '1484315527416647802':  'SC Leaks (Discord)',
  'spectrum-announce':     'Spectrum Announcements',
  'spectrum-patch-notes':  'Spectrum Patch Notes',
  'motd-sc':               'SC MOTD',
  'motd-evo':              'Evo MOTD',
  'rsi-status':            'RSI Status',
  'sc-youtube':            'SC YouTube',
  'subliminalstv':         'SubliminalsTV',
  'twitter-rsi':           'RSI Twitter',
}

const EMPTY_COUNTS: Counts = {
  messagesTotal: 0, messages24h: 0, kbSnapshots: 0, kbDiffs: 0, kbLastDiff: null, saved: 0, pushSubs: 0,
}

export async function getHealth(): Promise<Health> {
  // DB connectivity + round-trip latency. If this fails nothing else can run, so short-circuit.
  const t0 = Date.now()
  try {
    await sql`select 1`
  } catch (err) {
    return { db: { ok: false, latencyMs: null, error: String(err) }, cron: [], sources: [], counts: EMPTY_COUNTS }
  }
  const dbHealth: DbHealth = { ok: true, latencyMs: Date.now() - t0 }

  const now = Date.now()
  const [sourceRows, countRows, hbRows] = await Promise.all([
    // distinct-on grabs the newest row per channel (for its url + ts) and joins the per-channel
    // counts. JS re-sorts by recency afterward (distinct-on forces channel_id-first ordering).
    sql`
      select distinct on (m.channel_id)
             m.channel_id,
             m.url     as last_url,
             m.ts_raw  as last_ts,
             c.count_24h,
             c.total
      from scfeed.sc_feed_messages m
      join (
        select channel_id,
               count(*) filter (where ts_raw > now() - interval '24 hours') as count_24h,
               count(*)                                                     as total
        from scfeed.sc_feed_messages
        group by channel_id
      ) c on c.channel_id = m.channel_id
      order by m.channel_id, m.ts_raw desc
    `,
    sql`
      select
        (select count(*) from scfeed.sc_feed_messages)                                            as messages_total,
        (select count(*) from scfeed.sc_feed_messages where ts_raw > now() - interval '24 hours') as messages_24h,
        (select count(*) from scfeed.sc_feed_kb_snapshots)                                         as kb_snapshots,
        (select count(*) from scfeed.sc_feed_kb_diffs)                                             as kb_diffs,
        (select max(created) from scfeed.sc_feed_kb_diffs)                                         as kb_last_diff,
        (select count(*) from scfeed.sc_feed_saved)                                                as saved,
        (select count(*) from scfeed.sc_feed_push_subscriptions)                                   as push_subs
    `,
    db.select().from(config).where(like(config.key, 'cron_hb_%')),
  ])

  const sources: SourceHealth[] = sourceRows
    .map((r) => {
      const last = r.last_ts ? new Date(r.last_ts as string) : null
      const url = (r.last_url as string) || ''
      return {
        channelId: r.channel_id as string,
        label: SOURCE_LABELS[r.channel_id as string] ?? (r.channel_id as string),
        lastTs: last ? last.toISOString() : null,
        ageMs: last ? now - last.getTime() : null,
        lastUrl: /^https?:\/\//i.test(url) ? url : null,
        count24h: Number(r.count_24h),
        total: Number(r.total),
      }
    })
    .sort((a, b) => (a.ageMs ?? Infinity) - (b.ageMs ?? Infinity))

  const hbMap = new Map(hbRows.map((h) => [h.key.replace('cron_hb_', ''), h]))
  const cron: CronHealth[] = CRON_SOURCES.map((source) => {
    const row = hbMap.get(source)
    let summary: Record<string, unknown> = {}
    if (row?.value) { try { summary = JSON.parse(row.value) } catch { /* keep {} */ } }
    const last = row?.updated ? new Date(row.updated) : null
    return {
      source,
      lastRun: last ? last.toISOString() : null,
      ageMs: last ? now - last.getTime() : null,
      ok: !!last && summary.ok !== false,
      summary,
    }
  })

  const c = countRows[0]
  const counts: Counts = {
    messagesTotal: Number(c.messages_total),
    messages24h: Number(c.messages_24h),
    kbSnapshots: Number(c.kb_snapshots),
    kbDiffs: Number(c.kb_diffs),
    kbLastDiff: c.kb_last_diff ? new Date(c.kb_last_diff as string).toISOString() : null,
    saved: Number(c.saved),
    pushSubs: Number(c.push_subs),
  }

  return { db: dbHealth, cron, sources, counts }
}
