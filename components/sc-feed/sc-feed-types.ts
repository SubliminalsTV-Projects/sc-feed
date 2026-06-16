'use client'

import { createContext, useContext, type ElementType } from 'react'
import { Activity, BookOpen, DollarSign, Gift, Globe, Hash, Megaphone, Rocket, Terminal } from 'lucide-react'

export const REFRESH_INTERVAL_MS = 2 * 60 * 1000
export const GROUP_WINDOW_MS = 5 * 60 * 1000
export const LEAKS_CHANNEL_ID = 'sc-leaks'
export const MOTD_CHANNEL_IDS = new Set(['sc-motd', 'evo-motd'])
export const PIPELINE_CHANNEL_IDS = new Set(['sc-news', 'patch-news', 'sc-leaks'])
export const MOTD_UNIFIED_ID = '__motd_unified'
export const MOTD_LOBBY_URLS: Record<string, string> = {
  'sc-motd': 'https://robertsspaceindustries.com/spectrum/community/SC/lobby/38230',
  'evo-motd': 'https://robertsspaceindustries.com/spectrum/community/SC/lobby/1355241',
}
export const OMNI_FEED_ID = '__omni_feed'

export const YT_CREATORS_ID     = 'sc-yt-creators'
export const TWITCH_CREATORS_ID = 'sc-twitch-creators'
export const CUSTOM_RSS_ID      = 'sc-custom-rss'

export const MAX_YT_CHANNELS     = 5
export const MAX_TWITCH_STREAMERS = 3
export const MAX_RSS_FEEDS        = 5

export const USER_YT_KEY     = 'sc-feed-user-yt-channels'
export const USER_TWITCH_KEY = 'sc-feed-user-twitch-streamers'
export const USER_RSS_KEY    = 'sc-feed-user-rss-feeds'

export interface UserYTChannel { channelId: string; name: string }
export interface UserTwitchStreamer { login: string; displayName?: string }
export interface UserRSSFeed { url: string; label: string }

export const FeedPrefsContext = createContext<{ dateFormat: 'short' | 'long'; hideAllRead: boolean }>({ dateFormat: 'short', hideAllRead: false })
export function useFeedPrefs() { return useContext(FeedPrefsContext) }

export const COLUMN_WIDTHS = { narrow: 340, medium: 420, wide: 560 } as const
export type ColumnWidth = keyof typeof COLUMN_WIDTHS
export type ColumnHeight = 'full' | 'half' | 'third' | 'quarter'

export const PILL = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] font-label font-black uppercase tracking-widest shrink-0 transition-colors'

export const NOTIF_READ_KEY = 'notifications-read-ids'
export const NOTIF_COLORS: Record<string, string> = {
  'sc-news': 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  'patch-news': 'bg-green-500/20 text-green-300 border-green-500/30',
  'cig-news': 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'sc-leaks': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  'sc-motd': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'evo-motd': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'spectrum-cig': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'spectrum-announce': 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'spectrum-patch-notes': 'bg-green-500/20 text-green-300 border-green-500/30',
  'rsi-status': 'bg-red-500/20 text-red-300 border-red-500/30',
}

export interface NotifItem {
  id: string
  channelId: string
  channelLabel: string
  title: string
  body?: string
  url?: string
  timestamp: string
  ts_raw: string
  discord_jump_url?: string
  source?: string
  dev?: string
  motdLabels?: string[]
}

export interface LayoutPreset {
  id: string
  name: string
  columnOrder: string[]
  columnWidths: Record<string, ColumnWidth>
  columnHeights: Record<string, ColumnHeight>
  hiddenChannels: string[]
  isDefault?: boolean
}

// `twitter-rsi` (RSI's official @RobertsSpaceInd, written by Sub's Minion) is a MERGE-ONLY
// source by default: it flows into the OmniFeed (omniSourceToggles, independent of panels)
// but ships hidden as a standalone panel in every default preset, so it doesn't sit as its
// own column next to the OmniFeed. It's still in columnOrder so a user can unhide it.
export const DEFAULT_PRESETS: LayoutPreset[] = [
  {
    id: 'default-16-9-all',
    name: '16:9 All',
    isDefault: true,
    columnOrder: ['__omni_feed', '__motd_unified', 'rsi-status', 'spectrum-cig', 'twitter-rsi', 'sc-youtube', 'sc-news', 'patch-news', 'cig-news', 'sc-leaks', 'subliminalstv', 'sc-yt-creators', 'sc-twitch-creators', 'sc-custom-rss'],
    columnWidths: { '__omni_feed': 'medium', '__motd_unified': 'medium', 'rsi-status': 'medium', 'spectrum-cig': 'medium', 'twitter-rsi': 'medium', 'sc-youtube': 'medium', 'sc-news': 'medium', 'patch-news': 'medium', 'cig-news': 'narrow', 'sc-leaks': 'medium', 'subliminalstv': 'medium', 'sc-yt-creators': 'medium', 'sc-twitch-creators': 'medium', 'sc-custom-rss': 'medium' },
    columnHeights: { '__omni_feed': 'full', '__motd_unified': 'quarter', 'rsi-status': 'third', 'spectrum-cig': 'third', 'twitter-rsi': 'half', 'sc-youtube': 'third', 'sc-news': 'half', 'patch-news': 'half', 'cig-news': 'full', 'sc-leaks': 'half', 'subliminalstv': 'half', 'sc-yt-creators': 'half', 'sc-twitch-creators': 'quarter', 'sc-custom-rss': 'quarter' },
    hiddenChannels: ['__motd_unified', 'twitter-rsi'],
  },
  {
    id: 'default-9-16-omni',
    name: '9:16 OmniFeed',
    isDefault: true,
    columnOrder: ['__omni_feed', '__motd_unified', 'spectrum-cig', 'twitter-rsi', 'rsi-status', 'sc-youtube', 'subliminalstv', 'sc-news', 'patch-news', 'cig-news', 'sc-leaks', 'sc-yt-creators', 'sc-twitch-creators', 'sc-custom-rss'],
    columnWidths: { '__omni_feed': 'wide' },
    columnHeights: { '__omni_feed': 'full' },
    hiddenChannels: ['__motd_unified', 'spectrum-cig', 'twitter-rsi', 'rsi-status', 'sc-youtube', 'subliminalstv', 'sc-news', 'patch-news', 'cig-news', 'sc-leaks', 'sc-yt-creators', 'sc-twitch-creators', 'sc-custom-rss'],
  },
  {
    id: 'default-reset',
    name: 'Reset',
    isDefault: true,
    columnOrder: ['__omni_feed', '__motd_unified', 'spectrum-cig', 'twitter-rsi', 'rsi-status', 'sc-youtube', 'subliminalstv', 'sc-news', 'patch-news', 'cig-news', 'sc-leaks', 'sc-yt-creators', 'sc-twitch-creators', 'sc-custom-rss'],
    columnWidths: { '__omni_feed': 'medium', '__motd_unified': 'medium', 'spectrum-cig': 'medium', 'twitter-rsi': 'medium', 'rsi-status': 'medium', 'sc-youtube': 'medium', 'subliminalstv': 'medium', 'sc-news': 'medium', 'patch-news': 'medium', 'cig-news': 'medium', 'sc-leaks': 'medium', 'sc-yt-creators': 'medium', 'sc-twitch-creators': 'medium', 'sc-custom-rss': 'medium' },
    columnHeights: { '__omni_feed': 'full', '__motd_unified': 'full', 'spectrum-cig': 'full', 'twitter-rsi': 'full', 'rsi-status': 'full', 'sc-youtube': 'full', 'subliminalstv': 'full', 'sc-news': 'full', 'patch-news': 'full', 'cig-news': 'full', 'sc-leaks': 'full', 'sc-yt-creators': 'full', 'sc-twitch-creators': 'full', 'sc-custom-rss': 'full' },
    hiddenChannels: ['twitter-rsi', 'sc-yt-creators', 'sc-twitch-creators', 'sc-custom-rss'],
  },
]

export const TRACKER_CATS: Record<string, { label: string; icon: ElementType; cls: string }> = {
  'Comm-Link': { label: 'Comm-Link', icon: Megaphone, cls: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
  'Dev Tracker': { label: 'Dev Tracker', icon: Terminal, cls: 'border-teal-500/40 bg-teal-500/10 text-teal-400' },
  'Store': { label: 'Store', icon: DollarSign, cls: 'border-green-500/40 bg-green-500/10 text-green-400' },
  'Ship Upgrades': { label: 'Ship Upgrades', icon: Rocket, cls: 'border-sky-500/40 bg-sky-500/10 text-sky-400' },
  'Merchandise': { label: 'Merch', icon: Gift, cls: 'border-pink-500/40 bg-pink-500/10 text-pink-400' },
  'Knowledge Base': { label: 'Knowledge', icon: BookOpen, cls: 'border-violet-500/40 bg-violet-500/10 text-violet-400' },
  'Galactapedia': { label: 'Galactapedia', icon: Globe, cls: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400' },
  'Reddit': { label: 'Reddit', icon: Hash, cls: 'border-orange-500/40 bg-orange-500/10 text-orange-400' },
  'Status': { label: 'Status', icon: Activity, cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
}
export const ALL_TRACKER_KEYS = Object.keys(TRACKER_CATS)
// Categories disabled by default. 'Status' is redundant with the dedicated rsi-status feed
// (TrackerSC's bot relays the same incidents); we keep the option to re-enable.
export const DEFAULT_DISABLED_TRACKER_KEYS = new Set(['Status'])
export const DEFAULT_ENABLED_TRACKER_KEYS = ALL_TRACKER_KEYS.filter(k => !DEFAULT_DISABLED_TRACKER_KEYS.has(k))

export const FEED_DESCRIPTIONS: Record<string, string> = {
  '__omni_feed':    'A unified real-time stream of everything — Spectrum posts, Discord pipeline news, MOTD, and leaks merged into one scroll.',
  '__motd_unified': 'Live Messages of the Day from the SC Testing and ETF Testing lobbies on Spectrum. Requires an Evocati RSI account.',
  'spectrum-cig':   'Official CIG posts on the Star Citizen Spectrum forums — Announcements and Patch Notes from the dev team, tagged by type.',
  'rsi-status':     'Incident reports from the RSI status page. Tracks platform outages, patch deployments, and service disruptions. Pruned after 15 days.',
  'sc-news':        'SC News Pipeline — Star Citizen news curated and relayed by the community from the Discord pipeline channel.',
  'patch-news':     'Patch News Pipeline — patch builds, PTU updates, and release notes relayed from the Discord pipeline channel.',
  'cig-news':       'TrackerSC — official CIG developer posts across Spectrum: Dev Tracker replies, Comm-Links, store launches, and ship sales.',
  'sc-leaks':       'SC Leaks Pipeline — community-sourced leaks relayed from the Discord pipeline channel. Blurred by default; toggle reveal in Settings.',
  'sc-youtube':     'Official Star Citizen YouTube channel — new videos, dev updates, ship showcases, and live streams from Roberts Space Industries.',
  'subliminalstv':  'SubliminalsTV — Sub\'s YouTube videos and live Twitch streams. Goes live red-hot when Sub is on Twitch.',
  'sc-yt-creators':     'YouTube channels you follow — add up to 5 SC creators in Settings. Stored in your browser only, never on the server.',
  'sc-twitch-creators': 'Twitch streamers you follow — add up to 3 streamers in Settings. Cards appear here when they go live. Stored in your browser only.',
  'sc-custom-rss':      'Any RSS or Atom feed you want — add up to 5 in Settings (Reddit, blogs, news sites). Stored in your browser only.',
}
