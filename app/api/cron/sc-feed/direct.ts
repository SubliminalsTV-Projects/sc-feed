// First-party replacements for what TrackerSC relays into cig-news. Each source here is read
// straight from RSI, anonymously: none of these requests carries Sub's RSI token, so they can
// never touch his session. (Dev-post bodies are still enriched with fetchTrackerDevContent,
// which uses the token for the same read the TrackerSC branch already does.)
//
// SHADOW MODE: the channels below are deliberately NOT in /api/sc-feed's CHANNEL_ORDER, not in
// the bot's SOURCES allowlist, and the route sends no push. Rows are stored so they can be
// compared with TrackerSC's before anything switches over. See dev-sc-feed
// references/first-party-sources.md.
//
// Kept out of _shared.ts on purpose: that file is already 1,300+ lines, and these sources change
// for a different reason (RSI's site) than the Discord relays.

import { eq } from 'drizzle-orm'
import { db, messages as messagesTbl } from '@/lib/db'
import { aadFor, decryptValue } from '@/lib/feed-crypt'
import { SPECTRUM_HEADERS } from './_shared'

export const DIRECT_CHANNELS = {
  commlink: { id: 'rsi-commlink',     label: 'Comm-Links (direct)'  },
  devpost:  { id: 'spectrum-devpost', label: 'Dev Tracker (direct)' },
} as const

const RSI = 'https://robertsspaceindustries.com'

export interface DirectRow {
  msg_id: string
  title: string
  body: string
  url: string
  source: string
  msg_timestamp: string
  ts_raw: string
  image: string
}

// ---------- stored-row lookup ----------

/** The stored body / image / time for a msg_id, so a re-run keeps what an earlier one found.
 *  These channels are never encrypted; decryptValue passes plain text straight through. */
export async function storedRow(msgId: string): Promise<{ body: string; image: string; tsRaw: Date } | null> {
  const r = (await db.select({ body: messagesTbl.body, image: messagesTbl.image, tsRaw: messagesTbl.tsRaw })
    .from(messagesTbl).where(eq(messagesTbl.msgId, msgId)).limit(1))[0]
  if (!r) return null
  return {
    body:  r.body  ? decryptValue(r.body,  aadFor(msgId, 'body'))  : '',
    image: r.image ? decryptValue(r.image, aadFor(msgId, 'image')) : '',
    tsRaw: r.tsRaw,
  }
}

// ---------- Comm-Links ----------

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

/** "Posted: 5 hours ago" → a Date. RSI gives no exact publish time anywhere, so this is only
 *  used the first time an item is seen; after that the stored time is kept. */
export function parseTimeAgo(text: string, now = Date.now()): Date {
  const m = text.trim().toLowerCase().match(/^(\d+|an?|a few)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/)
  if (!m) return new Date(now)
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1] === 'a few' ? 3 : 1
  const unit: Record<string, number> = {
    second: 1e3, minute: 60e3, hour: 3600e3, day: 86400e3, week: 7 * 86400e3, month: 30 * 86400e3, year: 365 * 86400e3,
  }
  return new Date(now - n * unit[m[2]])
}

export interface CommLinkItem { id: string; url: string; title: string; image: string; excerpt: string; postedAgo: string }

/** Parses one page of RSI's comm-link listing (getCommlinkItems returns HTML in `data`). */
export function parseCommLinkListing(html: string): CommLinkItem[] {
  const items: CommLinkItem[] = []
  for (const chunk of html.split('<a class="content-block2').slice(1)) {
    const href = chunk.match(/href="(\/comm-link\/[^"]+)"/)?.[1]
    const id = href?.match(/\/(\d+)-/)?.[1]
    if (!href || !id) continue
    items.push({
      id,
      url: `${RSI}${href}`,
      title: stripTags(chunk.match(/<div class="title[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? ''),
      image: chunk.match(/background-image:url\('([^']+)'\)/)?.[1] ?? '',
      excerpt: stripTags(chunk.match(/<div class="body">([\s\S]*?)<\/div>/)?.[1] ?? ''),
      postedAgo: stripTags(chunk.match(/class="time_ago">[\s\S]*?class="value">([^<]*)</)?.[1] ?? ''),
    })
  }
  return items
}

/** Newest comm-links, page 1 (10 items). One anonymous request. */
export async function fetchCommLinkListing(): Promise<CommLinkItem[]> {
  const res = await fetch(`${RSI}/api/hub/getCommlinkItems`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': SPECTRUM_HEADERS['User-Agent'] },
    body: JSON.stringify({ channel: '', series: '', type: '', text: '', sort: 'publish_new', page: 1 }),
  })
  if (!res.ok) throw new Error(`comm-link listing HTTP ${res.status}`)
  const j = await res.json()
  if (!j.success || typeof j.data !== 'string') throw new Error(`comm-link listing: ${j.msg ?? 'no data'}`)
  const items = parseCommLinkListing(j.data)
  if (items.length === 0) throw new Error('comm-link listing parsed to 0 items (markup changed?)')
  return items
}

// ---------- Spectrum dev posts ----------

/** CIG staff role in the SC community. Replies carry it as highlight_role_id; it is the same set
 *  TrackerSC calls its Dev Tracker (47 of 47 staff replies matched, 2026-11-16). */
export const SPECTRUM_STAFF_ROLE = '2'

export interface StaffHit {
  _index: string
  _id: string
  _source: { body?: string; subject?: string; time_created: string; time_modified?: string; channel_id: string; thread_id: string }
  details?: {
    community?: { slug?: string }
    thread?: { id: string; slug: string; subject: string; channel_id: string; content_reply_id: string }
    channel?: { name?: string }
    member?: { displayname?: string; nickname?: string }
  }
}

/** Staff posts from the last day, newest first. Spectrum's own search, filtered to the staff
 *  role; each hit carries the thread slug/subject and the member, so no follow-up request is
 *  needed to build the card. Anonymous. */
export async function fetchStaffPosts(page = 1): Promise<StaffHit[]> {
  const res = await fetch(`${RSI}/api/spectrum/search/content/extended`, {
    method: 'POST',
    headers: SPECTRUM_HEADERS,
    body: JSON.stringify({
      community_id: '1', type: ['op', 'reply'], text: '', page, sort: 'latest', range: 'day',
      highlight_role_id: SPECTRUM_STAFF_ROLE, visibility: 'nonerased',
    }),
  })
  if (!res.ok) throw new Error(`Spectrum search HTTP ${res.status}`)
  const j = await res.json()
  if (!j.success) throw new Error(`Spectrum search: ${j.msg}`)
  return j.data?.hits?.hits ?? []
}

/** A staff hit as a card, minus the rich body (the route decides whether to enrich). */
export function staffHitToRow(h: StaffHit): DirectRow | null {
  const t = h.details?.thread
  if (!t?.slug) return null
  const isOp = h._index.endsWith('_op')
  // TrackerSC links an OP by its content_reply_id, a reply by its own id. Use the same so the
  // two feeds can be matched post for post.
  const postId = isOp ? t.content_reply_id : h._id
  const community = h.details?.community?.slug ?? 'SC'
  const dev = h.details?.member?.displayname ?? h.details?.member?.nickname ?? ''
  const ts = new Date(h._source.time_created).toISOString()
  return {
    msg_id: `devpost-spectrum-${postId}`,
    title: t.subject,
    body: (h._source.body ?? '').trim(),
    url: `${RSI}/spectrum/community/${community}/forum/${t.channel_id}/thread/${t.slug}/${postId}`,
    source: dev ? `Dev Tracker||${dev}` : 'Dev Tracker',
    msg_timestamp: ts,
    ts_raw: ts,
    image: '',
  }
}
