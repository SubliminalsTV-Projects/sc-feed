import { NextResponse } from 'next/server'
import { getStreamStates, isTwitchConfigured } from '@/lib/twitch'

const PB_URL          = process.env.POCKETBASE_URL    ?? 'https://mc-db.subliminal.gg'
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
  kbDiff?: { summary: string; added: number; removed: number; preview?: string; excerpt?: string }
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

// Build a short preview from a Knowledge Base article's normalized body (already
// newline-delimited plaintext from the snapshot). Drops a leading line that just
// repeats the title, then trims to a sentence-ish length so the card stays compact.
function kbExcerpt(bodyNormalized: string, title: string): string {
  let lines = bodyNormalized.split('\n').map(l => l.trim()).filter(Boolean)
  const t = title.replace(/^\[Updated\]\s*/i, '').trim().toLowerCase()
  if (lines[0]?.toLowerCase() === t) lines = lines.slice(1)
  let text = lines.join(' ').replace(/\s+/g, ' ').trim()
  if (text.length > 260) text = text.slice(0, 260).replace(/\s+\S*$/, '') + '…'
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
    const [pbRes, guildIds, rsiStatusJson, twitchStates] = await Promise.all([
      fetch(
        `${PB_URL}/api/collections/sc_feed_messages/records?sort=-ts_raw&perPage=500`,
        { headers: { 'Content-Type': 'application/json' }, next: { revalidate: 0 } }
      ),
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

    if (!pbRes.ok) throw new Error(`PB ${pbRes.status}`)
    const data = await pbRes.json()
    const allRecords: {
      id: string; channel_id: string; channel_label: string
      msg_id: string; title: string; body?: string; url: string; source: string
      msg_timestamp: string; ts_raw: string; image: string
    }[] = data.items ?? []

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
      type DiffRow = { msg_id: string; article_id?: string; summary: string; added: number; removed: number; preview_html?: string }
      const filter = encodeURIComponent('(' + kbMsgs.map(m => `msg_id="${m.id}"`).join(' || ') + ')')
      const diffs = await fetch(
        `${PB_URL}/api/collections/sc_feed_kb_diffs/records?perPage=100&filter=${filter}`,
        { headers: { 'Content-Type': 'application/json' }, next: { revalidate: 0 } }
      ).then(r => r.ok ? r.json() : null).catch(() => null)
      const byMsg = new Map<string, DiffRow>((diffs?.items ?? []).map((d: DiffRow) => [d.msg_id, d]))

      // Batch-fetch snapshots for cards that have no real diff (need an excerpt instead).
      const artIds = [...new Set(
        kbMsgs.map(m => byMsg.get(m.id)).filter((d): d is DiffRow => !!d && d.added === 0 && d.removed === 0)
          .map(d => d.article_id).filter((a): a is string => !!a)
      )]
      const bodyByArticle = new Map<string, string>()
      if (artIds.length) {
        const sf = encodeURIComponent('(' + artIds.map(a => `article_id="${a}"`).join(' || ') + ')')
        const snaps = await fetch(
          `${PB_URL}/api/collections/sc_feed_kb_snapshots/records?perPage=100&filter=${sf}`,
          { headers: { 'Content-Type': 'application/json' }, next: { revalidate: 0 } }
        ).then(r => r.ok ? r.json() : null).catch(() => null)
        for (const s of (snaps?.items ?? []) as { article_id: string; body_normalized?: string }[]) {
          if (s.body_normalized) bodyByArticle.set(s.article_id, s.body_normalized)
        }
      }

      for (const m of kbMsgs) {
        const d = byMsg.get(m.id)
        if (d && (d.added > 0 || d.removed > 0)) {
          m.kbDiff = { summary: d.summary, added: d.added, removed: d.removed, preview: d.preview_html }
        } else {
          const excerpt = d?.article_id ? kbExcerpt(bodyByArticle.get(d.article_id) ?? '', m.title) : ''
          if (excerpt) m.kbDiff = { summary: '', added: 0, removed: 0, excerpt }
        }
      }
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
