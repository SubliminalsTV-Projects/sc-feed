'use client'

import type { FeedChannel, FeedMessage } from '@/app/api/sc-feed/route'
import { ALL_TRACKER_KEYS, GROUP_WINDOW_MS, MOTD_UNIFIED_ID, OMNI_FEED_ID, TRACKER_CATS } from './sc-feed-types'

/** Strip Discord/Markdown syntax from a title string before rendering as plain text. */
export function stripDiscordMarkdown(text: string): string {
  // Fast path: skip the link-stripping regexes entirely if the title has no `](`.
  // The previous nested-quantifier patterns hit catastrophic backtracking on titles
  // like `[Bugfix and Issue Discussion] 4.8.0 ...` — bracketed text without a
  // following `(url)` made the regex try every decomposition of the bracket contents
  // (~2^N) before failing, which compounded across many cards × many re-renders.
  let out = text
  if (out.includes('](')) {
    out = out
      // [text](<url>) — flat character class, no nested quantifier
      .replace(/\[([^\]]*)\]\(<[^>]*>\)/g, '$1')
      // [text](url)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  }
  return out
    .replace(/^-#{1,3}\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .trim()
}

/** Convert Discord-specific markdown to standard markdown for ReactMarkdown rendering. */
export function normalizeBodyMarkdown(text: string): string {
  return text
    .replace(/^-### /gm, '##### ')
    .replace(/^-## /gm, '#### ')
    .replace(/^-# /gm, '### ')
    // Strip the https:// protocol from bare Google Form/survey URLs so GFM autolink
    // detection doesn't fire and Chrome doesn't speculatively preconnect to forms.gle.
    // (forms.gle redirects cause Chrome to hang the UI while waiting for the connection.)
    // Negative lookbehind (?<!\() excludes URLs already inside markdown link syntax [text](url).
    .replace(/(?<!\()https:\/\/(forms\.gle\/[^\s)>\]]+)/g, '$1')
    .replace(/(?<!\()https:\/\/(docs\.google\.com\/forms\/[^\s)>\]]+)/g, '$1')
}

export function getRsiStatusTheme(status: string) {
  switch (status.toLowerCase()) {
    case 'operational': return {
      sectionBg: 'border-green-400/20 bg-green-500/[0.04]',
      pill: 'border-green-400/60 bg-green-400/10 text-green-300',
      dot: 'bg-green-400',
      chevron: 'text-green-400/60 hover:text-green-400',
      label: 'Operational',
    }
    case 'degraded': return {
      sectionBg: 'border-yellow-400/20 bg-yellow-500/[0.04]',
      pill: 'border-yellow-400/60 bg-yellow-400/10 text-yellow-300',
      dot: 'bg-yellow-400',
      chevron: 'text-yellow-400/60 hover:text-yellow-400',
      label: 'Degraded',
    }
    case 'partial': return {
      sectionBg: 'border-orange-400/20 bg-orange-500/[0.04]',
      pill: 'border-orange-400/60 bg-orange-400/10 text-orange-300',
      dot: 'bg-orange-400',
      chevron: 'text-orange-400/60 hover:text-orange-400',
      label: 'Partial Outage',
    }
    case 'maintenance': return {
      sectionBg: 'border-sky-400/20 bg-sky-500/[0.04]',
      pill: 'border-sky-400/60 bg-sky-400/10 text-sky-300',
      dot: 'bg-sky-400',
      chevron: 'text-sky-400/60 hover:text-sky-400',
      label: 'Maintenance',
    }
    case 'major':
    case 'down': return {
      sectionBg: 'border-red-400/20 bg-red-500/[0.04]',
      pill: 'border-red-400/60 bg-red-400/10 text-red-300',
      dot: 'bg-red-400',
      chevron: 'text-red-400/60 hover:text-red-400',
      label: 'Major Outage',
    }
    default: return {
      sectionBg: 'border-outline-variant/20 bg-surface-container/20',
      pill: 'border-outline-variant/40 bg-surface-container text-on-surface-variant/60',
      dot: 'bg-on-surface-variant/40',
      chevron: 'text-on-surface-variant/40 hover:text-on-surface',
      label: status.charAt(0).toUpperCase() + status.slice(1),
    }
  }
}

export function getTrackerCatKey(source: string): string | undefined {
  if (TRACKER_CATS[source]) return source
  const lower = source.toLowerCase()
  return ALL_TRACKER_KEYS.find(k => lower.includes(k.toLowerCase()))
}

/** Knowledge Base cards (TrackerSC → Zendesk article) get their own display path (KbCard).
 *  Keyed on source so it works in any channel context (regular column + OmniFeed). */
export function isKbMessage(m: { source?: string }): boolean {
  return getTrackerCatKey(m.source ?? '') === 'Knowledge Base'
}

export function getFeedLabel(id: string, channels: FeedChannel[]): string {
  if (id === OMNI_FEED_ID) return 'Omni Feed'
  if (id === MOTD_UNIFIED_ID) return 'MOTD'
  return channels.find(c => c.id === id)?.label ?? id
}

export function timeAgo(isoOrFormatted: string | null, fmt: 'short' | 'long' = 'short'): string {
  if (!isoOrFormatted) return ''
  const ms = Date.now() - new Date(isoOrFormatted).getTime()
  if (isNaN(ms)) return isoOrFormatted
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  const remHrs = hrs % 24
  if (fmt === 'long' && remHrs > 0) return `${days}d ${remHrs}h ago`
  return `${days}d ago`
}

export function formatLocalTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function getSourceInfo(url: string | undefined): { label: string; cls: string } | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host.startsWith('status.') && host.includes('robertsspaceindustries.com'))
      return { label: 'RSI Status', cls: 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300' }
    if (host.includes('robertsspaceindustries.com') || host.includes('spectrum.sc'))
      return { label: 'Spectrum', cls: 'border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 hover:text-blue-300' }
    if (host.includes('reddit.com') || host.includes('redd.it'))
      return { label: 'Reddit', cls: 'border-orange-500/40 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 hover:text-orange-300' }
    if (host.includes('discord.com') || host.includes('discord.gg'))
      return { label: 'Discord', cls: 'border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:text-purple-300' }
    if (host.includes('youtube.com') || host.includes('youtu.be'))
      return { label: 'YouTube', cls: 'border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300' }
    if (host.includes('twitch.tv'))
      return { label: 'Twitch', cls: 'border-[#9146FF]/50 bg-[#9146FF]/15 text-[#bb91ff] hover:bg-[#9146FF]/25 hover:text-[#d4b8ff]' }
    if (host.includes('trackersc.com') || host.includes('tracker.sc') || host.includes('sc2-tracker.com'))
      return { label: 'Tracker SC', cls: 'border-outline-variant/40 bg-surface-container text-on-surface-variant/60 hover:text-on-surface hover:border-outline-variant' }
    const seg = host.split('.')[0]
    return { label: seg.charAt(0).toUpperCase() + seg.slice(1), cls: 'border-outline-variant/40 bg-surface-container text-on-surface-variant/60 hover:text-on-surface hover:border-outline-variant' }
  } catch {
    return { label: 'Source', cls: 'border-outline-variant/40 bg-surface-container text-on-surface-variant/60 hover:text-on-surface' }
  }
}

export function groupByWindow(
  messages: FeedMessage[]
): Array<FeedMessage | { type: 'group'; messages: FeedMessage[] }> {
  const out: Array<FeedMessage | { type: 'group'; messages: FeedMessage[] }> = []
  let i = 0
  const hasLongBody = (m: FeedMessage) => (m.body?.trim().length ?? 0) > 150
  while (i < messages.length) {
    // Messages with images or substantial body, and KB cards (their own card type), are always
    // standalone — never collapse into a CompactRow group.
    if (messages[i].image || hasLongBody(messages[i]) || isKbMessage(messages[i])) { out.push(messages[i]); i++; continue }
    const base = messages[i].ts_raw ? new Date(messages[i].ts_raw!).getTime() : null
    if (!base) { out.push(messages[i]); i++; continue }
    let j = i + 1
    while (j < messages.length) {
      if (messages[j].image) break  // image message breaks the window
      if (hasLongBody(messages[j])) break  // body-heavy message breaks the window
      if (isKbMessage(messages[j])) break  // KB cards never join a group
      const t = messages[j].ts_raw ? new Date(messages[j].ts_raw!).getTime() : null
      if (!t || (base - t) > GROUP_WINDOW_MS) break
      j++
    }
    const chunk = messages.slice(i, j)
    out.push(chunk.length >= 2 ? { type: 'group', messages: [...chunk].reverse() } : messages[i])
    i = j
  }
  return out
}
