// Decides, per row, which feed an item belongs to and which card it gets.
//
// Measured 2026-11-16 on the 174 TrackerSC rows in the DB (30 days): the `source` field names
// the kind — "Dev Tracker" 81, "Knowledge Base" 34, "Comm-Link" 28, "Store" 16,
// "Ship Upgrade" 8, "Status" 4, "Merchandise" 3 (each followed by " - TrackerSC.com", and dev
// posts by "||<dev handle>"). All 81 dev posts in that window were Spectrum; Reddit is split
// by URL for when TrackerSC carries one.

import { PIPELINE_NEWS, SOURCES, TRACKERSC, type CategoryId, type Source } from './sources'
import { isShort, youtubeId } from './lookups'
import type { MessageRow } from './embed'

export type CardKind = 'dev' | 'commlink' | 'video' | 'store' | 'kb' | 'motd' | 'generic'

export interface Classified {
  feed: CategoryId
  card: CardKind
  source: Source
  videoId?: string
  devName?: string
  storeLabel?: string
}

const KB_ARTICLE_RE = /support\.robertsspaceindustries\.com\/hc\/[^/]+\/articles\/\d+/
const REDDIT_RE = /(^|\/\/)(www\.|old\.)?reddit\.com\//
const COMM_LINK_RE = /robertsspaceindustries\.com\/(?:[a-z]{2}\/)?comm-link\//

const STORE_LABELS: Record<string, string> = { 'Store': 'RSI Store', 'Ship Upgrade': 'Ship upgrades', 'Merchandise': 'Merch store' }

// "Comm-Link - TrackerSC.com||Name" → { kind: 'Comm-Link', devName: 'Name' }
function trackerKind(row: MessageRow) {
  const [raw, devName] = (row.source ?? '').split('||')
  return { kind: raw.replace(/\s*-\s*TrackerSC\.com\s*$/i, '').trim(), devName: devName?.trim() || undefined }
}

async function video(source: Source, videoId: string): Promise<Classified> {
  return { feed: await isShort(videoId) ? 'yt-short' : 'yt-video', card: 'video', source, videoId }
}

/** null = this channel isn't carried. */
export async function classify(row: MessageRow): Promise<Classified | null> {
  const base = SOURCES[row.channelId]
  if (!base) return null

  switch (row.channelId) {
    case 'sc-youtube': {
      const id = row.msgId.replace(/^youtube-/, '') || youtubeId(row.url)
      return id ? video(base, id) : { feed: 'yt-video', card: 'video', source: base }
    }
    case PIPELINE_NEWS: {
      // Pipeline relays official uploads and Comm-Links too. Send those to their own feeds
      // so they ping the right role (and dedupe against the direct copy by URL).
      const id = youtubeId(row.url)
      if (id) return video(base, id)
      if (COMM_LINK_RE.test(row.url)) return { feed: 'commlink', card: 'generic', source: base }
      return { feed: 'roundup', card: 'generic', source: base }
    }
    case TRACKERSC: {
      const { kind, devName } = trackerKind(row)
      const src = (label: string): Source => ({ ...base, label })
      if (kind === 'Comm-Link') return { feed: 'commlink', card: 'commlink', source: src('Comm-Link') }
      if (STORE_LABELS[kind]) return { feed: 'store', card: 'store', source: src(STORE_LABELS[kind]), storeLabel: STORE_LABELS[kind] }
      if (kind === 'Status') return { feed: 'status', card: 'generic', source: src('RSI Status') }
      if (kind === 'Knowledge Base' || KB_ARTICLE_RE.test(row.url)) return { feed: 'kb', card: 'kb', source: src('Knowledge Base') }
      if (REDDIT_RE.test(row.url)) return { feed: 'dev-reddit', card: 'dev', source: src('Dev post on Reddit'), devName }
      if (kind === 'Dev Tracker' || /\/spectrum\//.test(row.url)) return { feed: 'dev-spectrum', card: 'dev', source: src('Dev post on Spectrum'), devName }
      // A kind TrackerSC hasn't used before: still post it, as news, rather than drop it.
      return { feed: 'commlink', card: 'generic', source: src(kind || base.label) }
    }
    case '1484315784816627903':
    case 'spectrum-patch-notes': return { feed: 'patch', card: 'generic', source: base }
    case 'spectrum-announce':    return { feed: 'commlink', card: 'generic', source: base }
    case 'twitter-rsi':          return { feed: 'twitter', card: 'generic', source: base }
    case 'rsi-status':           return { feed: 'status', card: 'generic', source: base }
    case 'motd-sc':              return { feed: 'motd', card: 'motd', source: base }
  }
  return null
}

/** Every carried channel that can produce a row in one of these feeds (for test posts). */
export function channelsFor(feeds: CategoryId[]): string[] {
  const out = new Set<string>()
  const want = (f: CategoryId[]) => f.some(x => feeds.includes(x))
  if (want(['yt-video', 'yt-short'])) out.add('sc-youtube')
  if (want(['roundup', 'commlink', 'yt-video', 'yt-short'])) out.add(PIPELINE_NEWS)
  if (want(['commlink', 'store', 'status', 'kb', 'dev-spectrum', 'dev-reddit'])) out.add(TRACKERSC)
  if (want(['patch'])) { out.add('1484315784816627903'); out.add('spectrum-patch-notes') }
  if (want(['commlink'])) out.add('spectrum-announce')
  if (want(['twitter'])) out.add('twitter-rsi')
  if (want(['status'])) out.add('rsi-status')
  if (want(['motd'])) out.add('motd-sc')
  return [...out]
}
