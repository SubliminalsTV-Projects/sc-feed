// Which sc-feed channels the public bot carries, and how they group into the categories a
// server can follow. Keyed on the DB `channel_id` value (NOT the public /api/sc-feed ids —
// that route remaps some of them, e.g. motd-sc → sc-motd).
//
// Deliberately NOT carried (Sub, 2026-09-15): sc-leaks (datamined leaks), motd-evo (scraped
// from an Evocati-only lobby — NDA risk), subliminalstv (Sub's own uploads).

export type CategoryId = 'news' | 'patch' | 'dev' | 'spectrum' | 'twitter' | 'status' | 'youtube' | 'motd'

export interface Category {
  id: CategoryId
  label: string
  description: string   // shown in the category picker (max 100 chars)
  color: number         // embed stripe — SC Feed's per-source colours (Tailwind 500s)
}

export const CATEGORIES: Category[] = [
  { id: 'news',     label: 'Star Citizen news',      description: 'Comm-Links, This Week in SC, newsletters, launcher notes', color: 0x0ea5e9 },
  { id: 'patch',    label: 'Patch notes',            description: 'LIVE and PTU patch notes',                                 color: 0x22c55e },
  { id: 'dev',      label: 'Dev tracker',            description: 'CIG staff posts on Spectrum and Reddit, Knowledge Base edits', color: 0xa855f7 },
  { id: 'spectrum', label: 'Spectrum announcements', description: 'Official announcements forum',                             color: 0x3b82f6 },
  { id: 'twitter',  label: 'RSI on X',               description: 'Posts from @RobertsSpaceInd',                              color: 0xd4d4d8 },
  { id: 'status',   label: 'Server status',          description: 'RSI Status incidents and maintenance',                     color: 0xef4444 },
  { id: 'youtube',  label: 'Star Citizen YouTube',   description: 'New videos on the official channel',                       color: 0xff0033 },
  { id: 'motd',     label: 'Testing chat MOTD',      description: 'PTU build status from the Spectrum testing chat',          color: 0xf59e0b },
]

export const CATEGORY_IDS = CATEGORIES.map(c => c.id)
export const categoryById = new Map(CATEGORIES.map(c => [c.id, c]))

export interface Source {
  category: CategoryId
  label: string        // embed author line
  credit?: string      // footer credit for third-party curators
  spectrumAuthor?: boolean  // row.source is the Spectrum poster's handle
}

export const SOURCES: Record<string, Source> = {
  '1484315008216207450':  { category: 'news',     label: 'Star Citizen News',        credit: 'via Pipeline' },
  '1484315784816627903':  { category: 'patch',    label: 'Patch News',               credit: 'via Pipeline' },
  'spectrum-patch-notes': { category: 'patch',    label: 'Spectrum · Patch Notes',   spectrumAuthor: true },
  '933047593666236487':   { category: 'dev',      label: 'Dev Tracker',              credit: 'via TrackerSC' },
  'spectrum-announce':    { category: 'spectrum', label: 'Spectrum · Announcements', spectrumAuthor: true },
  'twitter-rsi':          { category: 'twitter',  label: 'RSI on X' },
  'rsi-status':           { category: 'status',   label: 'RSI Status' },
  'sc-youtube':           { category: 'youtube',  label: 'Star Citizen on YouTube' },
  'motd-sc':              { category: 'motd',     label: 'Testing Chat MOTD' },
}
