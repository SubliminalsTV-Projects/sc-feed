// Which sc-feed channels the public bot carries, and the feeds a server (and, with the ping
// menu, a member) can follow. Keyed on the DB `channel_id` value (NOT the public /api/sc-feed
// ids — that route remaps some of them, e.g. motd-sc → sc-motd).
//
// A feed is decided per ROW, not per channel (classify.ts): one TrackerSC channel carries
// Comm-Links, store changes, dev posts and Knowledge Base edits, and one YouTube channel
// carries both videos and Shorts.
//
// Deliberately NOT carried (Sub, 2026-09-15): sc-leaks (datamined leaks), motd-evo (scraped
// from an Evocati-only lobby — NDA risk), subliminalstv (Sub's own uploads).

export type CategoryId =
  | 'yt-video' | 'yt-short' | 'twitter' | 'commlink'
  | 'dev-spectrum' | 'dev-reddit' | 'kb'
  | 'patch' | 'status' | 'store' | 'motd'
  | 'news'

export interface Category {
  id: CategoryId
  label: string
  description: string   // shown in the pickers (max 100 chars)
  group: string         // heading in the ping menu
  color: number         // embed stripe — SC Feed's per-source colours (Tailwind 500s)
}

export const GROUPS = ['Official channels', 'Dev tracker', 'Game and store', 'Community'] as const

export const CATEGORIES: Category[] = [
  { id: 'yt-video',     group: 'Official channels', label: 'YouTube videos',          description: 'New videos on the official Star Citizen channel',          color: 0xff0033 },
  { id: 'yt-short',     group: 'Official channels', label: 'YouTube Shorts',          description: 'New Shorts on the official Star Citizen channel',          color: 0xff0033 },
  { id: 'twitter',      group: 'Official channels', label: 'RSI on X',                description: 'Posts from @RobertsSpaceInd',                              color: 0xd4d4d8 },
  { id: 'commlink',     group: 'Official channels', label: 'Comm-Links',              description: 'RSI articles, This Week in SC, Spectrum announcements',    color: 0x0ea5e9 },
  { id: 'dev-spectrum', group: 'Dev tracker',       label: 'Dev posts on Spectrum',   description: 'CIG staff posts and replies on Spectrum',                  color: 0xa855f7 },
  { id: 'dev-reddit',   group: 'Dev tracker',       label: 'Dev posts on Reddit',     description: 'CIG staff comments on r/starcitizen',                      color: 0xff4500 },
  { id: 'kb',           group: 'Dev tracker',       label: 'Knowledge Base edits',    description: 'What changed in RSI support articles',                     color: 0x8b5cf6 },
  { id: 'patch',        group: 'Game and store',    label: 'Patch notes',             description: 'LIVE and PTU patch notes',                                 color: 0x22c55e },
  { id: 'status',       group: 'Game and store',    label: 'Server status',           description: 'RSI Status incidents and maintenance',                     color: 0xef4444 },
  { id: 'store',        group: 'Game and store',    label: 'Store and ship upgrades', description: 'Pledge store, ship upgrade and merch changes',             color: 0xeab308 },
  { id: 'motd',         group: 'Game and store',    label: 'Testing chat MOTD',       description: 'PTU build status from the Spectrum testing chat',          color: 0xf59e0b },
  { id: 'news',         group: 'Community',         label: 'News roundup (Pipeline)', description: 'Teasers, offers and newsletters, relayed by Pipeline',     color: 0x38bdf8 },
]

export const CATEGORY_IDS = CATEGORIES.map(c => c.id)
export const categoryById = new Map(CATEGORIES.map(c => [c.id, c]))

// The categories servers followed before feeds were split per row (2026-11-16), and what each
// became. Used once per subscription by migrateCategories() in schema.ts. `dev` was the whole
// TrackerSC channel, so it maps to every kind TrackerSC posts.
export const LEGACY_CATEGORIES: Record<string, CategoryId[]> = {
  news:     ['news', 'commlink'],
  spectrum: ['commlink'],
  dev:      ['commlink', 'store', 'dev-spectrum', 'dev-reddit', 'kb', 'status'],
  youtube:  ['yt-video', 'yt-short'],
}

// How a carried channel is credited. The feed itself is decided per row in classify.ts.
export interface Source {
  label: string        // embed author line
  credit?: string      // footer credit for third-party curators
  spectrumAuthor?: boolean  // row.source is the Spectrum poster's handle
}

export const SOURCES: Record<string, Source> = {
  '1484315008216207450':  { label: 'Star Citizen News',        credit: 'via Pipeline' },
  '1484315784816627903':  { label: 'Patch News',               credit: 'via Pipeline' },
  'spectrum-patch-notes': { label: 'Spectrum · Patch Notes',   spectrumAuthor: true },
  '933047593666236487':   { label: 'Dev Tracker',              credit: 'via TrackerSC' },
  'spectrum-announce':    { label: 'Spectrum · Announcements', spectrumAuthor: true },
  'twitter-rsi':          { label: 'RSI on X' },
  'rsi-status':           { label: 'RSI Status' },
  'sc-youtube':           { label: 'Star Citizen on YouTube' },
  'motd-sc':              { label: 'Testing Chat MOTD' },
}

export const PIPELINE_NEWS = '1484315008216207450'
export const TRACKERSC = '933047593666236487'
