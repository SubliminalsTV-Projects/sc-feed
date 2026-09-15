// Turns one scfeed message row into the Discord message the bot posts.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js'
import type { messages } from '../../lib/db'
import { categoryById, type Source } from './sources'

export type MessageRow = typeof messages.$inferSelect

export interface KbInfo {
  articleId: string
  stateSig: string
  summary: string
  added: number
  removed: number
  previewHtml: string
}

export const SITE_URL = 'https://sc-feed.subliminal.gg'
const ICON_URL = `${SITE_URL}/icons/icon-192.png`
const DESCRIPTION_MAX = 400

const isHttp = (u: string) => /^https?:\/\//i.test(u)

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  let out = text.slice(0, max).replace(/\s+\S*$/, '') + '…'
  // A cut inside **bold** or ~~strike~~ would leave the marker showing as literal text.
  for (const m of ['**', '~~']) if (out.split(m).length % 2 === 0) out += m
  return out
}

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

export function buildPost(row: MessageRow, source: Source, kb: KbInfo | null) {
  const [rawSource, devName] = (row.source ?? '').split('||')
  const author = devName ? `${source.label} · ${devName}`
    : source.spectrumAuthor && rawSource ? `${source.label} · ${rawSource}`
    : source.label

  const embed = new EmbedBuilder()
    .setColor(categoryById.get(source.category)!.color)
    .setTimestamp(row.tsRaw)
    .setFooter({ text: source.credit ? `SC Feed · ${source.credit}` : 'SC Feed', iconURL: ICON_URL })
  // A MOTD is one block of text with no headline (its stored title is just the first 150
  // chars), so it gets no title: the author line names it and the body carries it whole.
  const untitled = source.category === 'motd'
  embed.setAuthor({ name: author.slice(0, 256), ...(untitled && isHttp(row.url) ? { url: row.url } : {}) })
  if (!untitled) {
    embed.setTitle(clip(row.title.trim() || source.label, 256))
    if (isHttp(row.url)) embed.setURL(row.url)
  }
  const desc = untitled ? clip((row.body || row.title).trim(), DESCRIPTION_MAX) : description(row, kb)
  if (desc) embed.setDescription(desc)
  if (isHttp(row.image)) embed.setImage(row.image)

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open in SC Feed').setURL(SITE_URL),
  )
  return { embeds: [embed.toJSON()], components: [buttons.toJSON()] }
}
