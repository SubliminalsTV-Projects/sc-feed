import { NextResponse } from 'next/server'
import { desc, inArray } from 'drizzle-orm'
import { db, messages as messagesTbl, kbDiffs, kbSnapshots } from '@/lib/db'
import { getStreamStates, isTwitchConfigured } from '@/lib/twitch'

const DISCORD_BASE    = 'https://discord.com/api/v10'
const DISCORD_TOKEN   = process.env.DISCORD_BOT_TOKEN ?? ''
const SUBLIMINALSTV_TWITCH_LOGIN = 'subliminalstv'

export interface FeedMessage {
  id: string
  title: string
  body?: string
  url: string
  source: string
  timestamp: string
  ts_raw?: string
  image?: string
  discord_jump_url?: string
  tag?: string
  dev?: string
  kbDiff?: { summary: string; added: number; removed: number; preview?: string; excerpt?: string; dupeCount?: number }
}

export interface FeedChannel {
  id: string
  label: string
  file: string
  messages: FeedMessage[]
  updated_at: string | null
  error?: string
  rsiStatus?: {
    summaryStatus: string
    systems: Array<{ name: string; status: string }>
  }
}

// Build the preview body for a Knowledge Base article from its normalized snapshot
// (already newline-delimited plaintext). Drops a leading line that just repeats the
// title and keeps paragraph breaks so the card can clamp to a few lines and expand
// to the full article. Capped to bound payload size.
function kbExcerpt(bodyNormalized: string, title: string): string {
  let lines = bodyNormalized.split('\n').map(l => l.trim()).filter(Boolean)
  const t = title.replace(/^\[Updated\]\s*/i, '').trim().toLowerCase()
  if (lines[0]?.toLowerCase() === t) lines = lines.slice(1)
  let text = lines.join('\n').trim()
  if (text.length > 2000) text = text.slice(0, 2000).replace(/\s+\S*$/, '') + '…'
  return text
}

// Discord channels — channel_id is the real Discord channel snowflake stored in PB
const DISCORD_CHANNELS = [
  { id: 'sc-news',    channel_id: '1484315008216207450' },
  { id: 'patch-news', channel_id: '1484315784816627903' },
  { id: 'cig-news',   channel_id: '933047593666236487'  },
  { id: 'sc-leaks',   channel_id: '1484315527416647802' },
]
const DISCORD_CHANNEL_ID_SET = new Set(DISCORD_CHANNELS.map(c => c.channel_id))

// Channels to exclude from the feed — used for isolation testing
const SKIP_CHANNELS = new Set<string>([
])

const CHANNEL_ORDER = [
  // Discord pipeline relay channels
  { id: 'sc-news',               label: 'SC News - Pipeline',    channel_id: '1484315008216207450' },
  { id: 'patch-news',            label: 'Patch News - Pipeline', channel_id: '1484315784816627903' },
  { id: 'cig-news',              label: 'CIG - Tracker SC',      channel_id: '933047593666236487'  },
  { id: 'twitter-rsi',           label: 'RSI Twitter',           channel_id: 'twitter-rsi'          },
  { id: 'sc-leaks',              label: 'SC Leaks - Pipeline',   channel_id: '1484315527416647802' },
  // RSI Spectrum official CIG-only forums — merged into one feed
  { id: 'spectrum-cig',          label: 'Spectrum',              channel_id: 'spectrum-cig'         },
  // RSI Status incident feed
  { id: 'rsi-status',            label: 'RSI Status',            channel_id: 'rsi-status'           },
  // YouTube
  { id: 'sc-youtube',            label: 'SC YouTube',            channel_id: 'sc-youtube'           },
  // SubliminalsTV branded feed — YouTube videos in PB + live Twitch card injected at GET time
  { id: 'subliminalstv',         label: 'SubliminalsTV',         channel_id: 'subliminalstv'        },
  // User-configured feeds (data lives client-side; server returns empty channels here)
  { id: 'sc-yt-creators',        label: 'SC YT Creators',        channel_id: 'sc-yt-creators'       },
  { id: 'sc-twitch-creators',    label: 'SC Twitch Creators',    channel_id: 'sc-twitch-creators'   },
  { id: 'sc-custom-rss',         label: 'Custom RSS',            channel_id: 'sc-custom-rss'        },
  // Per-user saved bookmarks (data lives in sc_feed_saved, filled client-side per signed-in user)
  { id: 'sc-saved',              label: 'Saved',                 channel_id: 'sc-saved'             },
  // Spectrum MOTDs — at end so news columns appear first
  { id: 'sc-motd',               label: 'SC MOTD',               channel_id: 'motd-sc'              },
  { id: 'evo-motd',              label: 'Evo MOTD',              channel_id: 'motd-evo'             },
]

// Fetch Discord guild IDs once per process — needed to build message jump links
let guildIdPromise: Promise<Map<string, string>> | null = null

function getGuildIds(): Promise<Map<string, string>> {
  if (guildIdPromise) return guildIdPromise
  guildIdPromise = (async () => {
    const map = new Map<string, string>()
    if (!DISCORD_TOKEN) return map
    await Promise.all(
      DISCORD_CHANNELS.map(async ({ channel_id }) => {
        try {
          const r = await fetch(`${DISCORD_BASE}/channels/${channel_id}`, {
            headers: { Authorization: DISCORD_TOKEN },
          })
          if (r.ok) {
            const d = await r.json()
            if (d.guild_id) map.set(channel_id, d.guild_id)
          }
        } catch { /* silently ignore — links just won't appear */ }
      })
    )
    return map
  })()
  return guildIdPromise
}

export async function GET() {
  try {
    const [rows, guildIds, rsiStatusJson, twitchStates] = await Promise.all([
      db.select().from(messagesTbl).orderBy(desc(messagesTbl.tsRaw)).limit(500),
      getGuildIds(),
      (() => {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 3000)
        return fetch('https://status.robertsspaceindustries.com/index.json', { signal: ctrl.signal, next: { revalidate: 0 } })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
          .finally(() => clearTimeout(timer))
      })(),
      isTwitchConfigured()
        ? getStreamStates([SUBLIMINALSTV_TWITCH_LOGIN]).catch(() => ({}))
        : Promise.resolve({}),
    ])

    const allRecords: {
      id: string; channel_id: string; channel_label: string
      msg_id: string; title: string; body?: string; url: string; source: string
      msg_timestamp: string; ts_raw: string; image: string
    }[] = rows.map(r => ({
      id: String(r.id), channel_id: r.channelId, channel_label: r.channelLabel,
      msg_id: r.msgId, title: r.title, body: r.body, url: r.url, source: r.source,
      msg_timestamp: r.msgTimestamp, ts_raw: r.tsRaw.toISOString(), image: r.image,
    }))

    // Group by channel_id (the stored PB value), keep top 25 per channel
    const byChannel = new Map<string, typeof allRecords>()
    for (const rec of allRecords) {
      const list = byChannel.get(rec.channel_id) ?? []
      if (list.length < 25) {
        list.push(rec)
        byChannel.set(rec.channel_id, list)
      }
    }

    // Merge Announcements + Patch Notes into single spectrum-cig virtual channel
    const specAnnounce = (byChannel.get('spectrum-announce') ?? []).map(r => ({ ...r, _tag: 'Announcements' }))
    const specPatch    = (byChannel.get('spectrum-patch-notes') ?? []).map(r => ({ ...r, _tag: 'Patch Notes' }))
    byChannel.set('spectrum-cig', ([...specAnnounce, ...specPatch]
      .sort((a, b) => (b.ts_raw ?? '').localeCompare(a.ts_raw ?? ''))
      .slice(0, 25)) as typeof specAnnounce)

    const channels: FeedChannel[] = CHANNEL_ORDER.filter(ch => !SKIP_CHANNELS.has(ch.id)).map(ch => {
      const recs      = byChannel.get(ch.channel_id) ?? []
      const isDiscord = DISCORD_CHANNEL_ID_SET.has(ch.channel_id)
      const guildId   = isDiscord ? (guildIds.get(ch.channel_id) ?? '') : ''

      const messages: FeedMessage[] = recs.map(r => {
        const discord_jump_url = isDiscord && guildId && r.msg_id
          ? `https://discord.com/channels/${guildId}/${ch.channel_id}/${r.msg_id}`
          : undefined
        const [cleanSource, devName] = (r.source ?? '').split('||')
        return {
          id:               r.msg_id,
          title:            r.title,
          body:             r.body || undefined,
          url:              r.url ?? '',
          source:           cleanSource,
          timestamp:        r.msg_timestamp,
          ts_raw:           r.ts_raw,
          image:            r.image || undefined,
          discord_jump_url,
          tag:              (r as typeof r & { _tag?: string })._tag,
          dev:              devName || undefined,
        }
      })

      const rsiStatus = ch.id === 'rsi-status' && rsiStatusJson?.summaryStatus
        ? {
            summaryStatus: String(rsiStatusJson.summaryStatus),
            systems: (rsiStatusJson.systems ?? []).map((s: { name: string; status: string }) => ({
              name:   String(s.name),
              status: String(s.status),
            })),
          }
        : undefined

      // Inject SubliminalsTV live Twitch card at the top of the subliminalstv feed when live
      if (ch.id === 'subliminalstv') {
        const live = (twitchStates as Record<string, { live: boolean; streamId?: string; title?: string; gameName?: string; viewerCount?: number; startedAt?: string; thumbnailUrl?: string; userName?: string; fetchedAt?: number }>)[SUBLIMINALSTV_TWITCH_LOGIN]
        if (live?.live) {
          const display = live.userName ?? 'SubliminalsTV'
          const ts = live.startedAt ?? new Date().toISOString()
          messages.unshift({
            id:        `twitch-live-${SUBLIMINALSTV_TWITCH_LOGIN}-${live.streamId ?? Date.now()}`,
            title:     live.title ?? `${display} is live`,
            body:      live.gameName ? `${live.gameName} · ${live.viewerCount?.toLocaleString() ?? 0} viewers` : undefined,
            url:       `https://www.twitch.tv/${SUBLIMINALSTV_TWITCH_LOGIN}`,
            source:    display,
            timestamp: ts,
            ts_raw:    ts,
            image:     live.thumbnailUrl,
            tag:       'LIVE',
          })
        }
      }

      return { id: ch.id, label: ch.label, file: ch.id, messages, updated_at: messages[0]?.ts_raw ?? recs[0]?.ts_raw ?? null, rsiStatus }
    })

    // Enrich Knowledge Base cards (TrackerSC / cig-news, Zendesk article URLs). When the
    // article changed, attach the change-diff summary. When it didn't (baseline/unchanged
    // sighting), attach an excerpt of the article body so the card isn't a bare title —
    // pulled from the rolling snapshot (never pruned), keyed by the diff row's article_id.
    const cig = channels.find(c => c.id === 'cig-news')
    const kbMsgs = cig?.messages.filter(m => /support\.robertsspaceindustries\.com\/hc\/[^/]+\/articles\/\d+/.test(m.url)) ?? []
    if (cig && kbMsgs.length) {
      type DiffRow = { msg_id: string; article_id?: string; summary: string; added: number; removed: number; preview_html?: string; state_sig?: string }
      const diffRows = kbMsgs.length
        ? await db.select().from(kbDiffs).where(inArray(kbDiffs.msgId, kbMsgs.map(m => m.id)))
        : []
      const byMsg = new Map<string, DiffRow>(diffRows.map(d => [d.msgId, {
        msg_id: d.msgId, article_id: d.articleId, summary: d.summary,
        added: d.added, removed: d.removed, preview_html: d.previewHtml, state_sig: d.stateSig,
      }]))

      // Group KB cards by (article_id, state_sig): cards sharing a signature are the same
      // article state — duplicate [Updated] pings to collapse into one card with a ×N pill.
      // Cards without a stored signature (legacy rows) stay solo (no collapse).
      const groups = new Map<string, FeedMessage[]>()
      for (const m of kbMsgs) {
        const d = byMsg.get(m.id)
        const key = d?.state_sig ? `${d.article_id}::${d.state_sig}` : `solo::${m.id}`
        const g = groups.get(key) ?? []
        g.push(m); groups.set(key, g)
      }

      // Batch-fetch snapshots for groups that have no real diff (need an excerpt instead).
      const artIds = [...new Set(
        [...groups.values()]
          .filter(g => !g.some(m => { const d = byMsg.get(m.id); return d && (d.added > 0 || d.removed > 0) }))
          .map(g => byMsg.get(g[0].id)?.article_id).filter((a): a is string => !!a)
      )]
      const bodyByArticle = new Map<string, string>()
      if (artIds.length) {
        const snaps = await db.select({ articleId: kbSnapshots.articleId, bodyNormalized: kbSnapshots.bodyNormalized })
          .from(kbSnapshots).where(inArray(kbSnapshots.articleId, artIds))
        for (const s of snaps) {
          if (s.bodyNormalized) bodyByArticle.set(s.articleId, s.bodyNormalized)
        }
      }

      const hidden = new Set<string>()
      for (const g of groups.values()) {
        // Survivor = newest card in the group; the rest are hidden duplicates.
        g.sort((a, b) => (b.ts_raw ?? '').localeCompare(a.ts_raw ?? ''))
        const survivor = g[0]
        for (let i = 1; i < g.length; i++) hidden.add(g[i].id)
        const dupeCount = g.length
        // Show the group's real diff (carried on every member) if any, else an excerpt.
        const real = g.map(m => byMsg.get(m.id)).find(d => d && (d.added > 0 || d.removed > 0))
        if (real) {
          survivor.kbDiff = { summary: real.summary, added: real.added, removed: real.removed, preview: real.preview_html, dupeCount }
        } else {
          const artId = byMsg.get(survivor.id)?.article_id
          const excerpt = artId ? kbExcerpt(bodyByArticle.get(artId) ?? '', survivor.title) : ''
          if (excerpt || dupeCount > 1) survivor.kbDiff = { summary: '', added: 0, removed: 0, excerpt, dupeCount }
        }
      }
      if (hidden.size) cig.messages = cig.messages.filter(m => !hidden.has(m.id))
    }

    return NextResponse.json(channels, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } })
  } catch (err) {
    return NextResponse.json(
      CHANNEL_ORDER.map(ch => ({
        id: ch.id, label: ch.label, file: ch.id,
        messages: [], updated_at: null, error: String(err),
      }))
    )
  }
}

export const revalidate = 0
