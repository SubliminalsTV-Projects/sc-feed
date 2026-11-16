// Turns one scfeed message row into the Discord message the bot posts.
//
// Each kind of item that needs its own layout gets its own builder in cards.ts (the same rule
// as sc-feed's display isolation: fixing one card must never change another). buildPost only
// dispatches; the generic card below is the fallback for everything else.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js'
import type { messages } from '../../lib/db'
import type { Classified } from './classify'
import { SITE_URL, baseEmbed, clip, commLinkCard, devCard, isHttp, storeBurstCard, storeCard, videoCard } from './cards'

export type MessageRow = typeof messages.$inferSelect

export interface KbInfo {
  articleId: string
  stateSig: string
  summary: string
  added: number
  removed: number
  previewHtml: string
}

export interface Extras {
  kb: KbInfo | null
  summary: string   // Comm-Link summary (lookups.ts), '' when none
}

export { SITE_URL } from './cards'
const DESCRIPTION_MAX = 400

function unescapeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' } as Record<string, string>)[e])
}

// KB preview_html marks changes with styled <del>/<ins>; Discord markdown has ~~ and **.
function kbPreviewToMarkdown(html: string): string {
  return unescapeHtml(html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<del[^>]*>([\s\S]*?)<\/del>/gi, '~~$1~~')
    .replace(/<ins[^>]*>([\s\S]*?)<\/ins>/gi, '**$1**')
    .replace(/<[^>]+>/g, ''))
}

function description(row: MessageRow, kb: KbInfo | null): string {
  if (kb && (kb.added > 0 || kb.removed > 0)) {
    return clip(`**What changed** (${kb.summary} words)\n${kbPreviewToMarkdown(kb.previewHtml)}`, DESCRIPTION_MAX)
  }
  let body = (row.body ?? '').trim()
  // Tweets and some relays repeat the title as the body's first line. Only drop it when the
  // title is the whole first phrase — a title that is a truncated prefix (MOTD titles are the
  // first 150 chars) would otherwise cut the body mid-word.
  const title = row.title.trim()
  if (title && body.startsWith(title) && /^(\s|$)/.test(body.slice(title.length))) body = body.slice(title.length).trim()
  return clip(body, DESCRIPTION_MAX)
}

function genericCard(row: MessageRow, cls: Classified, kb: KbInfo | null) {
  const { source } = cls
  const [rawSource, devName] = (row.source ?? '').split('||')
  const author = devName ? `${source.label} · ${devName}`
    : source.spectrumAuthor && rawSource ? `${source.label} · ${rawSource}`
    : source.label

  const embed = baseEmbed(row, cls)
  // A MOTD is one block of text with no headline (its stored title is just the first 150
  // chars), so it gets no title: the author line names it and the body carries it whole.
  const untitled = cls.card === 'motd'
  embed.setAuthor({ name: author.slice(0, 256), ...(untitled && isHttp(row.url) ? { url: row.url } : {}) })
  if (!untitled) {
    embed.setTitle(clip(row.title.trim() || source.label, 256))
    if (isHttp(row.url)) embed.setURL(row.url)
  }
  const desc = untitled ? clip((row.body || row.title).trim(), DESCRIPTION_MAX) : description(row, kb)
  if (desc) embed.setDescription(desc)
  if (isHttp(row.image)) embed.setImage(row.image)
  return embed
}

export function buildPost(row: MessageRow, cls: Classified, extras: Extras) {
  const embed =
    cls.card === 'dev' ? devCard(row, cls)
    : cls.card === 'commlink' ? commLinkCard(row, cls, extras.summary)
    : cls.card === 'video' ? videoCard(row, cls)
    : cls.card === 'store' ? storeCard(row, cls)
    : genericCard(row, cls, extras.kb)

  return withButton(embed)
}

/** One post for a store burst (several store rows within a minute; see poller.ts). */
export function buildBurstPost(items: { row: MessageRow, cls: Classified }[]) {
  return withButton(storeBurstCard(items))
}

function withButton(embed: ReturnType<typeof baseEmbed>) {
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open in SC Feed').setURL(SITE_URL),
  )
  return { embeds: [embed.toJSON()], components: [buttons.toJSON()] }
}
