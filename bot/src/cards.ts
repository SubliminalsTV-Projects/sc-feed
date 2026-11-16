// One builder per kind of item that needs its own card, plus the frame they share.
// embed.ts picks the builder; anything without one gets the generic card there.

import { EmbedBuilder } from 'discord.js'
import { categoryById } from './sources'
import type { Classified } from './classify'
import type { MessageRow } from './embed'

export const SITE_URL = 'https://sc-feed.subliminal.gg'
export const ICON_URL = `${SITE_URL}/icons/icon-192.png`
const STORE_URL = 'https://robertsspaceindustries.com/pledge'

export const isHttp = (u: string) => /^https?:\/\//i.test(u)

export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  let out = text.slice(0, max).replace(/\s+\S*$/, '') + '…'
  // A cut inside **bold** or ~~strike~~ would leave the marker showing as literal text.
  for (const m of ['**', '~~']) if (out.split(m).length % 2 === 0) out += m
  return out
}

/** The shared frame every card starts from: colour, timestamp, footer credit. */
export function baseEmbed(row: MessageRow, cls: Classified) {
  return new EmbedBuilder()
    .setColor(categoryById.get(cls.feed)!.color)
    .setTimestamp(row.tsRaw)
    .setFooter({ text: cls.source.credit ? `SC Feed · ${cls.source.credit}` : 'SC Feed', iconURL: ICON_URL })
}

// TrackerSC's own stubs carry RSI's generic share image, which says nothing about the item.
const GENERIC_IMAGE_RE = /\/rsi\/static\/images\/RSI-fb\.|tavern\/opengraph\.png|zdassets\.com\/theme_assets\//

function setImage(embed: EmbedBuilder, url: string) {
  if (isHttp(url) && !GENERIC_IMAGE_RE.test(url)) embed.setImage(url)
}

// ---------- dev post ----------

// sc-feed stores a dev reply as "> **Who:** what they replied to\n\n<the dev's words>"
// (Spectrum), or "...\n\n**u/dev:** <words>" (Reddit). Split those back apart.
export function splitDevBody(body: string, devName?: string) {
  let text = body.trim()
  let replyTo: { who: string; text: string } | null = null
  if (text.startsWith('>')) {
    const end = text.indexOf('\n\n')
    const quote = (end === -1 ? text : text.slice(0, end)).replace(/^>\s?/gm, '').trim()
    text = end === -1 ? '' : text.slice(end + 2).trim()
    const m = /^\*\*(.+?):\*\*\s*([\s\S]*)$/.exec(quote)
    replyTo = m ? { who: m[1], text: m[2] } : { who: '', text: quote }
  }
  if (devName) text = text.replace(new RegExp(`^\\*\\*u/${devName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\*\\*\\s*`), '')
  return { replyTo, words: text }
}

export function devCard(row: MessageRow, cls: Classified) {
  const embed = baseEmbed(row, cls)
  embed.setAuthor({ name: (cls.devName ? `${cls.source.label} · ${cls.devName}` : cls.source.label).slice(0, 256) })
  embed.setTitle(clip(row.title.trim() || cls.source.label, 256))
  if (isHttp(row.url)) embed.setURL(row.url)

  const { replyTo, words } = splitDevBody(row.body ?? '', cls.devName)
  const parts: string[] = []
  if (replyTo?.text) {
    const quote = clip(replyTo.text.replace(/\s*\n+\s*/g, ' '), 220)
    parts.push(`${replyTo.who ? `Replying to **${replyTo.who}**:\n` : ''}> ${quote}`)
  }
  if (words) parts.push(clip(words, 1200))
  if (parts.length) embed.setDescription(parts.join('\n\n'))
  setImage(embed, row.image)
  return embed
}

// ---------- Comm-Link ----------

export function commLinkCard(row: MessageRow, cls: Classified, summary: string) {
  const embed = baseEmbed(row, cls)
  embed.setAuthor({ name: cls.source.label })
  embed.setTitle(clip(row.title.trim() || 'New Comm-Link', 256))
  if (isHttp(row.url)) embed.setURL(row.url)
  // sc-feed's own body (when it rendered one) beats the fetched summary.
  const text = (row.body ?? '').trim() || summary
  if (text) embed.setDescription(clip(text, 400))
  setImage(embed, row.image)
  return embed
}

// ---------- video ----------

export function videoCard(row: MessageRow, cls: Classified) {
  const short = cls.feed === 'yt-short'
  const embed = baseEmbed(row, cls)
  embed.setAuthor({ name: cls.source.label })
  embed.setTitle(clip(`${short ? '▶ Short · ' : ''}${row.title.trim() || 'New video'}`, 256))
  if (cls.videoId) embed.setURL(`https://www.youtube.com/${short ? 'shorts/' : 'watch?v='}${cls.videoId}`)
  else if (isHttp(row.url)) embed.setURL(row.url)
  // The cron cuts YouTube's description at its first divider, so this is the video's own blurb.
  // Trailing hashtag-only lines (#StarCitizen #WhatToPlay …) say nothing on a card.
  const body = (row.body ?? '').split('\n').filter(l => !/^\s*(#\w+\s*)+$/.test(l)).join('\n').trim()
  if (body && body !== row.title.trim()) embed.setDescription(clip(body, 300))
  const image = isHttp(row.image) ? row.image : cls.videoId ? `https://i.ytimg.com/vi/${cls.videoId}/hqdefault.jpg` : ''
  setImage(embed, image)
  return embed
}

// ---------- store ----------

// TrackerSC store posts are lists under **Added** / **Updated** / **Deleted** headings, and
// carry no prices (checked 2026-11-16: names and pledge links only; Ship Upgrade lines end in
// a bare number in brackets that is not a price). One long change arrives as several posts,
// so a list can also start without a heading.
export function summarizeStore(body: string) {
  const counts: Record<string, number> = {}
  let section = 'item'   // a continuation post starts with no heading
  for (const line of body.split('\n')) {
    const h = /^\*\*(.+?)\*\*\s*$/.exec(line.trim())
    if (h) { section = h[1]; continue }
    if (/^\s*[-*]\s+/.test(line)) counts[section] = (counts[section] ?? 0) + 1
  }
  return Object.entries(counts).map(([s, n]) => s === 'item' ? `${n} item${n === 1 ? '' : 's'}` : `${n} ${s.toLowerCase()}`).join(', ')
}

export function storeCard(row: MessageRow, cls: Classified) {
  const embed = baseEmbed(row, cls)
  const label = cls.storeLabel ?? cls.source.label
  const body = (row.body ?? '').trim()
  const counts = summarizeStore(body)
  embed.setAuthor({ name: label })
  embed.setTitle(clip(row.title.trim() || (counts ? `${label}: ${counts}` : label), 256))
  embed.setURL(isHttp(row.url) ? row.url : STORE_URL)
  if (body) {
    const lines = body.split('\n')
    let out = ''
    let shown = 0
    for (const line of lines) {
      if (out.length + line.length + 1 > 1500) break
      out += (out ? '\n' : '') + line
      shown++
    }
    const more = lines.slice(shown).filter(l => /^\s*[-*]\s+/.test(l)).length
    embed.setDescription(more ? `${out}\n…and ${more} more` : out)
  }
  setImage(embed, row.image)
  return embed
}

// A store burst (poller.ts): several store / ship upgrade / merch posts within a minute, as one
// card. One section per kind, in the order they arrived, then one list budget for all of them.
const BURST_DESCRIPTION_MAX = 3500

export function storeBurstCard(items: { row: MessageRow, cls: Classified }[]) {
  const sections = new Map<string, string[]>()
  for (const { row, cls } of items) {
    const label = cls.storeLabel ?? cls.source.label
    sections.set(label, [...(sections.get(label) ?? []), ...(row.body ?? '').trim().split('\n').filter(l => l.trim())])
  }
  const isItem = (l: string) => /^\s*[-*]\s+/.test(l)
  const total = [...sections.values()].reduce((n, ls) => n + ls.filter(isItem).length, 0)

  const lead = items[0]
  const embed = baseEmbed(lead.row, lead.cls)
  const labels = [...sections.keys()]
  embed.setAuthor({ name: labels.join(' · ').slice(0, 256) })
  embed.setTitle(clip(`${labels.join(' and ')}: ${total} change${total === 1 ? '' : 's'}`, 256))
  embed.setURL(STORE_URL)

  let out = ''
  let hidden = 0
  for (const [label, lines] of sections) {
    const head = `${out ? '\n\n' : ''}__**${label}**__ · ${summarizeStore(lines.join('\n'))}`
    if (out.length + head.length > BURST_DESCRIPTION_MAX) { hidden += lines.filter(isItem).length; continue }
    out += head
    for (const line of lines) {
      if (out.length + line.length + 1 > BURST_DESCRIPTION_MAX) { if (isItem(line)) hidden++; continue }
      out += '\n' + line
    }
  }
  embed.setDescription(hidden ? `${out}\n…and ${hidden} more` : out)
  return embed
}
