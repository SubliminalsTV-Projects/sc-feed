// Shared helpers and constants for the per-source sc-feed cron endpoints.
// Original monolithic logic lived in mission-control's app/api/cron/sc-feed/route.ts;
// extracted here so each per-source endpoint can fit Vercel Hobby's 10s function timeout.
//
// CRITICAL ARCHITECTURAL RULE (preserved from original):
// Per-channel Discord enrichment branches MUST stay separated by `ch.file_id`
// (NOT `ch.id`). Pipeline relays and TrackerSC dev-thread URLs share the same
// /spectrum/.../thread/{slug}/{number} shape — folding the branches together
// silently breaks one feed when the other's logic is touched. See discord/route.ts.

import { NextResponse } from 'next/server'
import TurndownService from 'turndown'

export const PB_URL        = process.env.POCKETBASE_URL ?? 'https://mc-db.subliminal.gg'
export const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN ?? ''
export const DISCORD_BASE  = 'https://discord.com/api/v10'
export const RSI_TOKEN     = process.env.RSI_TOKEN ?? ''

export const DISCORD_CHANNELS = [
  { id: '1484315008216207450', label: 'SC News',           file_id: 'sc-news'    },
  { id: '1484315784816627903', label: 'Patch News',        file_id: 'patch-news' },
  { id: '933047593666236487',  label: 'CIG News',          file_id: 'cig-news'   },
  { id: '1484315527416647802', label: 'SC Leaks',          file_id: 'sc-leaks'   },
] as const

export const SPECTRUM_FORUMS = [
  { forumId: '1',      label: 'Announcements', channelId: 'spectrum-announce'    },
  { forumId: '190048', label: 'Patch Notes',   channelId: 'spectrum-patch-notes' },
] as const

export const SPECTRUM_MOTDS = [
  { lobbyId: '38230',   channelId: 'motd-sc',  label: 'SC MOTD'  },
  { lobbyId: '1355241', channelId: 'motd-evo', label: 'Evo MOTD' },
] as const

export const SPECTRUM_HEADERS = {
  'Content-Type': 'application/json',
  'Accept':       'application/json',
  'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer':      'https://robertsspaceindustries.com/spectrum/',
  'Origin':       'https://robertsspaceindustries.com',
}

const LINK_RE = /\[((?:[^\[\]]|\[[^\]]*\])+?)\]\(<([^>]+)>|\[((?:[^\[\]]|\[[^\]]*\])+?)\]\(([^)]+)\)/

const MERGE_WINDOW_MS = 6 * 60 * 1000

export interface DiscordMsg {
  id: string
  content: string
  timestamp: string
  author?: { username?: string; global_name?: string }
  embeds?: {
    title?: string; url?: string; description?: string
    author?: { name?: string }
    image?: { url?: string }; thumbnail?: { url?: string }
  }[]
  attachments?: { url?: string; content_type?: string }[]
}

export interface SpectrumThread {
  id: string
  time_created: number
  time_modified: number
  channel_id: string
  slug: string
  subject: string
  content_reply_id: string
  annotation_plaintext?: string
  member?: { id?: string; displayname?: string }
  latest_activity?: number
  media_preview?: { type?: string; thumbnail?: { url?: string } }
}

export interface NewMsg { title: string; source: string; channelLabel: string; url: string }

// ---------- request helpers ----------

/** Returns NextResponse if unauthorized; null if OK. */
export function requireSecret(request: Request): NextResponse | null {
  const secret = new URL(request.url).searchParams.get('secret')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  return null
}

/** Push only for messages newer than 35 min (cron interval is 10 min — guards against backfill spam). */
export function freshCutoff(): string {
  return new Date(Date.now() - 35 * 60 * 1000).toISOString()
}

// ---------- discord parser ----------

export function mergePipelineContinuations(msgs: DiscordMsg[]): DiscordMsg[] {
  const ordered = [...msgs].reverse()
  const out: DiscordMsg[] = []
  let head: DiscordMsg | null = null
  let chainEnd = 0
  for (const m of ordered) {
    const content = (m.content ?? '').trim()
    const hasHeading = /^#{1,6}\s+/.test(content)
    const ts = new Date(m.timestamp).getTime()
    const sameAuthor = head?.author?.username && m.author?.username === head.author.username
    if (head && !hasHeading && content && sameAuthor && ts - chainEnd <= MERGE_WINDOW_MS) {
      head.content = (head.content ?? '') + '\n' + content
      chainEnd = ts
      continue
    }
    out.push(m)
    head = hasHeading ? m : null
    chainEnd = ts
  }
  return out.reverse()
}

// Caption-less image relays (a bare image drop, no text/embed) would otherwise
// render as a titleless, bodiless card. Derive a title from the attachment
// filename when it's descriptive (e.g. `may-2026-banner.webp` → "May 2026 Banner").
// Generic auto-names (source/image/screenshot/IMG_1234/numbers) yield nothing —
// better a bare image than a meaningless "Source" title.
export function captionFromImageUrl(url: string): string {
  try {
    const file = decodeURIComponent((new URL(url).pathname.split('/').pop() ?? ''))
    const base = file.replace(/\.[a-z0-9]+$/i, '')
    if (/^(source|image|images|unknown|untitled|screenshot|screen[\s_-]?shot|photo|file|spoiler_.*|img[-_]?\d*|dsc[-_]?\d*)$/i.test(base)) return ''
    const words = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (words.replace(/[^a-z]/gi, '').length < 3) return ''   // not enough letters to be a real caption
    return words.replace(/\b\w/g, c => c.toUpperCase())
  } catch {
    return ''
  }
}

export function parseDiscordMessage(m: DiscordMsg, channelLabel: string) {
  const embed      = m.embeds?.[0]
  const rawContent = m.content?.trim() ?? ''
  const mediaAttachments = (m.attachments ?? [])
    .filter(a => a.url && (!a.content_type || a.content_type.startsWith('image/') || a.content_type.startsWith('video/') || a.content_type.startsWith('audio/')))
    .map(a => a.url!)
  const image = mediaAttachments.length > 1
    ? JSON.stringify(mediaAttachments)
    : mediaAttachments[0] ?? embed?.image?.url ?? embed?.thumbnail?.url ?? ''
  const msg_timestamp = new Date(m.timestamp).toISOString()

  if (!rawContent && !embed?.title && !image) return null

  const source = embed?.author?.name ?? m.author?.global_name ?? m.author?.username ?? channelLabel

  if (!rawContent && embed?.title) {
    return {
      msg_id:        m.id,
      title:         embed.title,
      body:          embed.description ?? '',
      url:           embed.url ?? '',
      source,
      msg_timestamp,
      ts_raw:        m.timestamp,
      image,
    }
  }

  const headingMatch = rawContent.match(/^#{1,6}\s+(.+)/)
  if (headingMatch) {
    const firstLine = headingMatch[1].trim()
    const linkInHeading = firstLine.match(LINK_RE)
    let title: string, url: string, inlineBody = ''
    if (linkInHeading) {
      title = (linkInHeading[1] || linkInHeading[3] || '').replace(/\*\*/g, '').trim()
      url   = (linkInHeading[2] || linkInHeading[4] || '').trim()
      const afterLink = firstLine.slice((linkInHeading.index ?? 0) + linkInHeading[0].length)
        .replace(/^\)\s*/, '').replace(/^-#\s+/, '').trim()
      inlineBody = afterLink
    } else {
      title = firstLine.replace(/\*\*/g, '').trim()
      url   = ''
    }
    const subsequentLines = rawContent.split('\n').slice(1).join('\n').trim()
    const body = [inlineBody, subsequentLines].filter(Boolean).join('\n')
    return {
      msg_id:        m.id,
      title:         title || rawContent.slice(0, 120),
      body,
      url,
      source,
      msg_timestamp,
      ts_raw:        m.timestamp,
      image,
    }
  }

  const contentLinkMatch = rawContent.match(LINK_RE)
  if (contentLinkMatch) {
    const title = (contentLinkMatch[1] || contentLinkMatch[3] || '').replace(/\*\*/g, '').trim()
    const url   = (contentLinkMatch[2] || contentLinkMatch[4] || '').trim()
    const prose = rawContent.replace(LINK_RE, '').replace(/\s+/g, ' ').trim().replace(/^-#\s+/, '')
    return {
      msg_id:        m.id,
      title:         title || url,
      body:          prose || embed?.description || '',
      url:           (url || embed?.url) ?? '',
      source,
      msg_timestamp,
      ts_raw:        m.timestamp,
      image,
    }
  }

  const boldMatch = rawContent.match(/^\*\*(.+?)\*\*/)
  if (boldMatch) {
    const body = rawContent.replace(/^\*\*(.+?)\*\*\s*/, '').trim()
    return {
      msg_id:        m.id,
      title:         boldMatch[1].trim(),
      body:          body || embed?.description || '',
      url:           embed?.url ?? '',
      source,
      msg_timestamp,
      ts_raw:        m.timestamp,
      image,
    }
  }

  const lines = rawContent.split('\n')
  const textBody = lines.slice(1).join('\n').trim()
  const imageCaption = !rawContent && !embed?.title && mediaAttachments[0]
    ? captionFromImageUrl(mediaAttachments[0])
    : ''
  return {
    msg_id:        m.id,
    title:         lines[0].trim().slice(0, 150) || imageCaption || rawContent.slice(0, 120),
    body:          textBody || embed?.description || '',
    url:           embed?.url ?? '',
    source,
    msg_timestamp,
    ts_raw:        m.timestamp,
    image,
  }
}

// ---------- spectrum ----------

export async function fetchSpectrumThreadBody(threadId: string, slug?: string): Promise<{ body: string; image: string }> {
  try {
    const res = await fetch('https://robertsspaceindustries.com/api/spectrum/forum/thread/nested', {
      method: 'POST',
      headers: {
        ...SPECTRUM_HEADERS,
        'X-Rsi-Token': RSI_TOKEN,
        'Cookie':      `Rsi-Token=${RSI_TOKEN}`,
      },
      body: JSON.stringify({ thread_id: threadId, ...(slug ? { slug } : {}), page: 1, sort: 'oldest' }),
    })
    if (!res.ok) return { body: '', image: '' }
    const data = await res.json()
    if (!data.success) return { body: '', image: '' }
    const thread = data.data
    if (!thread) return { body: '', image: '' }

    let body = ''
    let image = ''
    if (thread.content_blocks?.length) {
      const { text, image: imgUrl } = extractSpectrumContentBlocks(thread.content_blocks)
      if (text) body = text
      if (imgUrl) image = imgUrl
    }
    if (!body && thread.annotation_plaintext) body = String(thread.annotation_plaintext).trim()
    return { body, image }
  } catch {
    return { body: '', image: '' }
  }
}

export async function fetchSpectrumThreadBodyByUrl(url: string): Promise<{ body: string; image: string; opMember: string }> {
  const match = url.match(/\/spectrum\/community\/[^/]+\/forum\/(\d+)\/thread\/([^/?#]+)/)
  if (!match || !RSI_TOKEN) return { body: '', image: '', opMember: '' }
  const [, forumId, slug] = match
  try {
    const res = await fetch('https://robertsspaceindustries.com/api/spectrum/forum/channel/threads', {
      method: 'POST',
      headers: {
        ...SPECTRUM_HEADERS,
        'X-Rsi-Token': RSI_TOKEN,
        'Cookie':      `Rsi-Token=${RSI_TOKEN}`,
      },
      body: JSON.stringify({ channel_id: forumId, sort: 'newest', page: 1 }),
    })
    if (!res.ok) return { body: '', image: '', opMember: '' }
    const data = await res.json()
    if (!data.success) return { body: '', image: '', opMember: '' }
    const threads: SpectrumThread[] = data.data?.threads ?? []
    const thread = threads.find(t => t.slug === slug)
    if (!thread) return { body: '', image: '', opMember: '' }
    const opMember = thread.member?.displayname ?? ''
    const result = await fetchSpectrumThreadBody(thread.id, thread.slug)
    return { ...result, opMember }
  } catch {
    return { body: '', image: '', opMember: '' }
  }
}

// Spectrum stores rich text as Draft.js raw content: each block has a `type`
// (unstyled / header-* / unordered-list-item / blockquote / …) and `inlineStyleRanges`
// (BOLD/ITALIC/CODE spans). Convert that to Markdown so the cards render headings,
// lists, and emphasis instead of one flattened paragraph.
type DraftStyleRange = { offset: number; length: number; style: string }
type DraftBlock = { text?: string; type?: string; inlineStyleRanges?: DraftStyleRange[] }
type DraftDoc  = { blocks?: DraftBlock[] }

function applyInlineStyles(text: string, ranges: DraftStyleRange[] = []): string {
  const marker = (s: string) => (s === 'BOLD' ? '**' : s === 'ITALIC' ? '_' : s === 'CODE' ? '`' : '')
  const marks: Array<{ pos: number; ins: string; open: boolean }> = []
  for (const r of ranges) {
    const m = marker(r.style)
    if (!m || r.length <= 0) continue
    marks.push({ pos: r.offset, ins: m, open: true })
    marks.push({ pos: r.offset + r.length, ins: m, open: false })
  }
  if (!marks.length) return text
  marks.sort((a, b) => a.pos - b.pos || (a.open === b.open ? 0 : a.open ? 1 : -1))
  let out = '', last = 0
  for (const mk of marks) { out += text.slice(last, mk.pos) + mk.ins; last = mk.pos }
  return out + text.slice(last)
}

function draftBlocksToMarkdown(blocks: DraftBlock[] = []): string {
  const lines = blocks.map(b => {
    const text = applyInlineStyles(b.text ?? '', b.inlineStyleRanges)
    switch (b.type) {
      case 'header-one':          return `# ${text}`
      case 'header-two':          return `## ${text}`
      case 'header-three':        return `### ${text}`
      case 'header-four':
      case 'header-five':
      case 'header-six':          return `#### ${text}`
      case 'unordered-list-item': return `- ${text}`
      case 'ordered-list-item':   return `1. ${text}`
      case 'blockquote':          return `> ${text}`
      default:                    return text
    }
  })
  // Blank Draft blocks already separate paragraphs; collapse runs of 3+ newlines.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function extractSpectrumContentBlocks(
  contentBlocks: Array<{ type: string; data: unknown }>
): { quote: string; text: string; image: string } {
  type TextInner = { type: string; data?: DraftDoc }
  const quoteParts: string[] = []
  const textParts:  string[] = []
  let imageUrl = ''

  for (const block of contentBlocks) {
    if (block.type === 'quote') {
      for (const inner of (block.data as TextInner[] ?? [])) {
        if (inner.type === 'text') {
          const md = draftBlocksToMarkdown(inner.data?.blocks)
          if (md) quoteParts.push(md)
        }
      }
    } else if (block.type === 'text') {
      const md = draftBlocksToMarkdown((block.data as DraftDoc).blocks)
      if (md) textParts.push(md)
    } else if (block.type === 'image' && !imageUrl) {
      type UploadItem = { data?: { url?: string; sizes?: { large?: { url?: string }; medium?: { url?: string } } } }
      const items = Array.isArray(block.data) ? (block.data as UploadItem[]) : []
      const item = items[0]
      if (item?.data) {
        imageUrl = item.data.url || item.data.sizes?.large?.url || item.data.sizes?.medium?.url || ''
      }
    }
  }

  return { quote: quoteParts.join('\n\n'), text: textParts.join('\n\n'), image: imageUrl }
}

// A nested Spectrum reply. The `thread/nested` endpoint returns replies as a
// tree (each reply may carry its own `replies` array), so any search must recurse.
// `parent_reply_reference` names the reply this one is answering: `null` means a
// top-level reply (answering the OP directly), otherwise `{ id, label }` where
// label is the parent author's display name.
interface SpectrumReply {
  id?: string | number
  content_blocks?: Array<{ type: string; data: unknown }>
  member?: { displayname?: string }
  time_created?: number
  parent_reply_reference?: { id?: string | number; label?: string } | null
  replies?: SpectrumReply[]
}

type ReplyHit = { node: SpectrumReply; parent: SpectrumReply | null }

// Depth-first search for a reply by id anywhere in the nested tree. Returns the
// matched node along with its parent node (the reply it's nested under), or null.
function findReplyById(replies: SpectrumReply[], id: string, parent: SpectrumReply | null = null): ReplyHit | null {
  for (const r of replies) {
    if (String(r.id) === id) return { node: r, parent }
    const hit = r.replies?.length ? findReplyById(r.replies, id, r) : null
    if (hit) return hit
  }
  return null
}

// Latest (most recent) reply authored by a given member anywhere in the tree,
// with its parent node. Fallback for when the exact linked reply is nested too
// deep to load.
function findLatestReplyByMember(replies: SpectrumReply[], name: string): ReplyHit | null {
  const wanted = name.trim().toLowerCase()
  let best: ReplyHit | null = null
  const walk = (rs: SpectrumReply[], parent: SpectrumReply | null) => {
    for (const r of rs) {
      if ((r.member?.displayname ?? '').trim().toLowerCase() === wanted) {
        if (!best || (r.time_created ?? 0) > (best.node.time_created ?? 0)) best = { node: r, parent }
      }
      if (r.replies?.length) walk(r.replies, r)
    }
  }
  walk(replies, null)
  return best
}

const PARENT_CTX_MAX = 280   // cap the "replying to" context so the dev reply stays the focus

// Flatten Markdown to a short plain-text snippet for the "replying to" blockquote.
function stripMarkdown(md: string): string {
  return md
    .replace(/^\s*#{1,6}\s+/gm, '')   // headings
    .replace(/^\s*[->]\s+/gm, '')     // list / quote markers
    .replace(/[*_`]/g, '')            // emphasis / code
    .replace(/\s+/g, ' ')
    .trim()
}

// Render a reply to a body string. Always prepend what the dev was answering — the
// parent reply's text (nested) or the explicit quote block the reply carried — as a
// short blockquote, then the dev's own answer (formatted Markdown). Without it the
// answer floats with no context.
function replyToBody(hit: ReplyHit): { body: string; image: string } {
  const { node, parent } = hit
  const { quote, text, image } = extractSpectrumContentBlocks(node.content_blocks ?? [])
  const parts: string[] = []

  const ref = node.parent_reply_reference
  // Prefer the parent reply's text (nested reply); else the explicit quote block.
  const parentMd = ref && parent ? extractSpectrumContentBlocks(parent.content_blocks ?? []).text : ''
  let ctx = stripMarkdown(parentMd || quote)
  if (ctx) {
    if (ctx.length > PARENT_CTX_MAX) ctx = ctx.slice(0, PARENT_CTX_MAX).replace(/\s+\S*$/, '') + '…'
    const author = (ref?.label || (ref && parent?.member?.displayname) || '').trim()
    parts.push(`> ${author ? `**${author}:** ` : ''}${ctx}`)
  }

  if (text) parts.push(text)
  return { body: parts.join('\n\n'), image }
}

// Fetch one nested-thread page in a given sort order. Returns the thread root
// (with its reply tree) or null on any failure.
async function fetchThreadTree(slug: string, replyId: string, sort: 'newest' | 'oldest'): Promise<SpectrumReply & { content_reply_id?: string | number } | null> {
  const res = await fetch('https://robertsspaceindustries.com/api/spectrum/forum/thread/nested', {
    method: 'POST',
    headers: {
      ...SPECTRUM_HEADERS,
      'X-Rsi-Token': RSI_TOKEN,
      'Cookie':      `Rsi-Token=${RSI_TOKEN}`,
    },
    body: JSON.stringify({ thread_id: replyId, slug, page: 1, sort }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data?.success && data.data ? data.data : null
}

// TrackerSC dev-tracker URLs point at a SPECIFIC dev reply deep inside a Spectrum
// thread (`.../thread/{slug}/{replyId}`). Three things matter:
//   1. Search the reply tree RECURSIVELY — replies nest under conversation chains,
//      so the target is almost never a top-level reply.
//   2. A single page doesn't load a big thread fully, and the linked reply may be
//      recent (loads under 'newest') OR early in a since-grown thread (loads under
//      'oldest'). So try both sort orders before giving up.
//   3. In very large threads the exact reply can still be nested deeper than any
//      page loads (it appears only as a `tracked_replies_references` stub). In that
//      case fall back to the named dev's most recent loaded reply in the same
//      thread — same author, same topic, meaningful context. `devName` comes from
//      the TrackerSC bot stub at the call site.
export async function fetchTrackerDevContent(url: string, devName = ''): Promise<{ body: string; image: string }> {
  const match = url.match(/\/spectrum\/community\/[^/]+\/forum\/\d+\/thread\/([^/]+)\/(\d+)/)
  if (!match || !RSI_TOKEN) return { body: '', image: '' }
  const [, slug, replyId] = match
  try {
    const trees: Array<SpectrumReply & { content_reply_id?: string | number }> = []
    // 'newest' first — covers fresh dev replies (the common case) without a second
    // round-trip. Only fetch 'oldest' if 'newest' didn't already resolve the body.
    for (const sort of ['newest', 'oldest'] as const) {
      const thread = await fetchThreadTree(slug, replyId, sort)
      if (!thread) continue
      trees.push(thread)

      // Dev is the original poster.
      if (String(thread.content_reply_id) === String(replyId)) {
        const { text, image } = extractSpectrumContentBlocks(thread.content_blocks ?? [])
        if (text || image) return { body: text, image }
      }

      // Exact linked reply, found anywhere in this tree.
      const target = findReplyById(thread.replies ?? [], String(replyId))
      if (target) {
        const result = replyToBody(target)
        if (result.body || result.image) return result
      }
    }

    // Fallback: exact reply was nested too deep to load on either page — use the
    // named dev's most recent reply across both trees instead of a blank card.
    if (devName) {
      let best: ReplyHit | null = null
      for (const t of trees) {
        const cand = findLatestReplyByMember(t.replies ?? [], devName)
        if (cand && (!best || (cand.node.time_created ?? 0) > (best.node.time_created ?? 0))) best = cand
      }
      if (best) return replyToBody(best)
    }

    return { body: '', image: '' }
  } catch {
    return { body: '', image: '' }
  }
}

export async function fetchSpectrumForumThreads(forumId: string, label: string, channelId: string, newMsgs: NewMsg[], cutoff: string) {
  const res = await fetch('https://robertsspaceindustries.com/api/spectrum/forum/channel/threads', {
    method: 'POST',
    headers: {
      ...SPECTRUM_HEADERS,
      'X-Rsi-Token': RSI_TOKEN,
      'Cookie':      `Rsi-Token=${RSI_TOKEN}`,
    },
    body: JSON.stringify({ channel_id: forumId, sort: 'newest', page: 1 }),
  })

  if (!res.ok) throw new Error(`Spectrum forum HTTP ${res.status} for forum ${forumId}`)
  const data = await res.json()
  if (!data.success) throw new Error(`Spectrum forum API error: ${data.msg}`)

  const threads: SpectrumThread[] = data.data?.threads ?? []
  let count = 0

  for (const thread of threads.slice(0, 25)) {
    const ts_raw = new Date(thread.time_created * 1000).toISOString()
    const url    = `https://robertsspaceindustries.com/spectrum/community/SC/forum/${forumId}/thread/${thread.slug}/${thread.content_reply_id}`

    const result = await fetchSpectrumThreadBody(thread.id, thread.slug)
    const body  = result.body || thread.annotation_plaintext?.trim() || ''
    const image = result.image || thread.media_preview?.thumbnail?.url || ''

    const msgData = {
      msg_id:        `spectrum-${forumId}-${thread.id}`,
      title:         thread.subject,
      body,
      url,
      source:        thread.member?.displayname ?? 'RSI',
      msg_timestamp: ts_raw,
      ts_raw,
      image,
    }
    const isNew = await upsertMessage(channelId, label, msgData)
    if (isNew && ts_raw >= cutoff) {
      newMsgs.push({ title: msgData.title, source: msgData.source, channelLabel: label, url })
    }
    count++
  }

  return count
}

export async function fetchSpectrumMotd(lobbyId: string, label: string) {
  const res = await fetch('https://robertsspaceindustries.com/api/spectrum/lobby/getMotd', {
    method: 'POST',
    headers: {
      ...SPECTRUM_HEADERS,
      'X-Rsi-Token': RSI_TOKEN,
      'Cookie':      `Rsi-Token=${RSI_TOKEN}`,
    },
    body: JSON.stringify({ lobby_id: lobbyId }),
  })

  if (!res.ok) throw new Error(`Spectrum MOTD HTTP ${res.status} for lobby ${lobbyId}`)
  const data = await res.json()
  if (!data.success || !data.data?.motd?.message)
    throw new Error(`No MOTD data for lobby ${lobbyId}`)

  const { message, last_modified } = data.data.motd as { message: string; last_modified: number }
  const ts_raw = new Date(last_modified * 1000).toISOString()

  const urlMatch = message.match(/\]\(([^)]+)\)/)
  const url      = urlMatch?.[1] ?? ''
  const title    = message
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150)

  return {
    msg_id:        `motd-${lobbyId}-${last_modified}`,
    title,
    body:          message,
    url,
    source:        'CIG',
    msg_timestamp: ts_raw,
    ts_raw,
    image:         '',
  }
}

// ---------- pocketbase upsert ----------

export async function upsertMessage(
  channelId: string,
  channelLabel: string,
  msg: { msg_id: string; title: string; body?: string; url: string; source: string; msg_timestamp: string; ts_raw: string; image: string }
): Promise<boolean> {
  const base    = `${PB_URL}/api/collections/sc_feed_messages/records`
  const headers = { 'Content-Type': 'application/json' }

  const existing = await fetch(
    `${base}?filter=msg_id%3D"${msg.msg_id}"`,
    { headers }
  ).then(r => r.json()).catch(() => null)

  const record  = existing?.items?.[0]
  const payload = { channel_id: channelId, channel_label: channelLabel, ...msg }

  if (record) {
    await fetch(`${base}/${record.id}`, {
      method: 'PATCH', headers, body: JSON.stringify(payload),
    })
    return false
  } else {
    await fetch(base, { method: 'POST', headers, body: JSON.stringify(payload) })
    return true
  }
}

// ---------- web push ----------

export async function sendPushNotifications(newMsgs: NewMsg[]) {
  const vapidPublic  = process.env.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  if (!vapidPublic || !vapidPrivate) return

  const webpush = (await import('web-push')).default
  webpush.setVapidDetails('mailto:sub@subliminal.gg', vapidPublic, vapidPrivate)

  const res = await fetch(
    `${PB_URL}/api/collections/sc_feed_push_subscriptions/records?perPage=500`
  ).then(r => r.json()).catch(() => null)

  const subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> = res?.items ?? []
  if (!subs.length) return

  const first = newMsgs[0]
  const payload = JSON.stringify(
    newMsgs.length === 1
      ? { title: first.title.slice(0, 100) || 'SC Feed Update', body: `${first.channelLabel} · ${first.source}`, url: first.url || '/' }
      : { title: `${newMsgs.length} new SC Feed updates`, body: [...new Set(newMsgs.map(m => m.channelLabel))].join(', '), url: '/' }
  )

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 3600 }
      )
    } catch (err: unknown) {
      if (typeof err === 'object' && err !== null && 'statusCode' in err && ([404, 410].includes((err as { statusCode: number }).statusCode))) {
        await fetch(`${PB_URL}/api/collections/sc_feed_push_subscriptions/records/${sub.id}`, {
          method: 'DELETE',
        }).catch(() => {})
      }
    }
  }
}

// ---------- rsi status rss ----------

export async function fetchRsiStatusRss(): Promise<number> {
  const res = await fetch('https://status.robertsspaceindustries.com/index.xml')
  if (!res.ok) throw new Error(`RSI Status RSS HTTP ${res.status}`)
  const xml = await res.text()

  const getText = (s: string, tag: string) =>
    s.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`))
     ?.[1]?.trim() ?? ''

  const itemRe = /<item>([\s\S]*?)<\/item>/g
  const items: { title: string; link: string; pubDate: string; guid: string; descRaw: string }[] = []
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null && items.length < 25) {
    const s     = m[1]
    const title = getText(s, 'title')
    if (!title) continue
    items.push({
      title,
      link:    getText(s, 'link'),
      pubDate: getText(s, 'pubDate'),
      guid:    getText(s, 'guid') || getText(s, 'link'),
      descRaw: getText(s, 'description'),
    })
  }

  const decodeAndStrip = (raw: string) => raw
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim()

  const decodeKeepBold = (raw: string) => raw
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(?:strong|b)>/gi, '**')
    .replace(/<\/p>\s*<p>/gi, '\n\n').replace(/<p>/gi, '').replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  const SEVERITY_LABEL: Record<string, string> = {
    down: 'Down', disrupted: 'Disrupted', notice: 'Notice',
    maintenance: 'Maintenance', ok: 'Operational',
  }
  const formatUtc = (raw: string) => {
    let s = raw.replace(/ UTC$/, '').replace(' +0000', 'Z').trim()
    const tzMatch = s.match(/ ([+-]\d{4})( [+-]\d{4})?$/)
    if (tzMatch) {
      s = s.slice(0, tzMatch.index).trim() + tzMatch[1].slice(0, 3) + ':' + tzMatch[1].slice(3)
    }
    s = s.replace(' ', 'T')
    if (!/Z|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z'
    const d = new Date(s)
    if (isNaN(d.getTime())) return raw
    return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`
  }

  type StatusJson = {
    severity?: string
    affected?: string[]
    resolved?: boolean
    resolvedAt?: string
    body?: string
  }

  const fetchStatusJson = async (link: string): Promise<StatusJson | null> => {
    if (!link) return null
    const jsonUrl = link.replace(/\/index\.html?$/, '/index.json').replace(/\/$/, '/index.json')
    try {
      const r = await fetch(jsonUrl)
      if (!r.ok) return null
      return await r.json() as StatusJson
    } catch { return null }
  }

  const enriched = await Promise.all(items.map(async it => {
    const json = await fetchStatusJson(it.link)
    let body: string
    if (json) {
      const meta: string[] = []
      if (json.severity) meta.push(`**Severity:** ${SEVERITY_LABEL[json.severity] ?? json.severity}`)
      if (json.affected?.length) meta.push(`**Affected systems:** ${json.affected.join(', ')}`)
      if (json.resolved && json.resolvedAt) meta.push(`**Resolved:** ${formatUtc(json.resolvedAt)}`)
      const prose = decodeKeepBold(json.body ?? it.descRaw)
      body = [meta.join('\n'), prose].filter(Boolean).join('\n\n')
    } else {
      body = decodeAndStrip(it.descRaw)
    }
    return { ...it, body }
  }))

  let count = 0
  for (const it of enriched) {
    const ts    = it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString()
    const msgId = `rsi-status-${it.guid}`.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 120)
    await upsertMessage('rsi-status', 'RSI Status', {
      msg_id:        msgId,
      title:         it.title,
      body:          it.body,
      url:           it.link,
      source:        'RSI Status',
      msg_timestamp: ts,
      ts_raw:        ts,
      image:         '',
    })
    count++
  }
  return count
}

// ---------- reddit (used inline for cig-news enrichment) ----------

export async function fetchRedditBody(url: string): Promise<string> {
  const match = url.match(/reddit\.com\/r\/\w+\/comments\/([a-zA-Z0-9]+)/)
  if (!match) return ''
  try {
    const res = await fetch(
      `https://www.reddit.com/comments/${match[1]}.json?limit=1&raw_json=1`,
      { headers: { 'User-Agent': 'sc-feed-bot/1.0 (subliminal.gg)' } }
    )
    if (!res.ok) return ''
    const data = await res.json()
    const selftext: string = data?.[0]?.data?.children?.[0]?.data?.selftext ?? ''
    if (!selftext || selftext === '[removed]' || selftext === '[deleted]') return ''
    return selftext.slice(0, 2000)
  } catch { return '' }
}

export async function fetchRedditDevComment(url: string): Promise<{ body: string; devName: string } | null> {
  const match = url.match(/reddit\.com\/r\/(\w+)\/comments\/([a-zA-Z0-9]+)\/[^/]*\/([a-zA-Z0-9]+)/)
  if (!match) return null
  const [, sub, postId, commentId] = match
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${sub}/comments/${postId}.json?comment=${commentId}&context=1&raw_json=1`,
      { headers: { 'User-Agent': 'sc-feed-bot/1.0 (subliminal.gg)' } }
    )
    if (!res.ok) return null
    const data = await res.json()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const thread: any[] = data?.[1]?.data?.children ?? []
    if (!thread.length) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parentData: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let devData: any = null

    const c0 = thread[0]?.data
    if (c0?.id === commentId) {
      devData = c0
      const op = data?.[0]?.data?.children?.[0]?.data
      const opText = (op?.selftext ?? '').replace(/\[removed\]|\[deleted\]/g, '').trim()
      parentData = op ? { author: op.author, body: opText || op.title } : null
    } else {
      parentData = c0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const replies: any[] = c0?.replies?.data?.children ?? []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      devData = replies.find((r: any) => r?.data?.id === commentId)?.data ?? null
    }

    if (!devData?.body) return null

    const devName = devData.author ?? 'Dev'
    const devBody = (devData.body as string).replace(/\[removed\]|\[deleted\]/g, '').trim()
    const parentName = parentData?.author ?? ''
    const parentBody = ((parentData?.body ?? '') as string).replace(/\[removed\]|\[deleted\]/g, '').trim().slice(0, 400)

    const quote = parentName && parentBody ? `> **u/${parentName}:** ${parentBody}\n\n` : ''
    return { body: `${quote}**u/${devName}:** ${devBody}`, devName }
  } catch { return null }
}

// ---------- youtube ----------

export const YT_FEEDS = [
  { channelId: 'UCTeLqJq1mXUX5WWoNXLmOIA', file_id: 'sc-youtube',    label: 'SC YouTube',    source: 'Star Citizen',  defaultTitle: 'Star Citizen Video' },
  { channelId: 'UCK2D42bb2isF77-lbNPCpXA', file_id: 'subliminalstv', label: 'SubliminalsTV', source: 'SubliminalsTV', defaultTitle: 'SubliminalsTV Video' },
] as const

export async function fetchYouTubeRssOne(feed: typeof YT_FEEDS[number], newMsgs: NewMsg[], cutoff: string): Promise<number> {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${feed.channelId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0' },
  })
  if (!res.ok) throw new Error(`YouTube RSS HTTP ${res.status} for ${feed.file_id}`)
  const xml = await res.text()

  const getText = (s: string, tag: string) =>
    s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
     ?.[1]?.trim() ?? ''
  const decode = (s: string) =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  let count = 0

  while ((m = entryRe.exec(xml)) !== null) {
    const s       = m[1]
    const videoId = getText(s, 'yt:videoId')
    if (!videoId) continue

    const title   = decode(getText(s, 'title'))
    const published = getText(s, 'published')
    const rawDesc = decode(getText(s, 'media:description'))
    const body    = rawDesc.split('------------------------------------------')[0].trim()

    const url   = `https://www.youtube.com/watch?v=${videoId}`
    const image = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    const ts    = published ? new Date(published).toISOString() : new Date().toISOString()

    const isNew = await upsertMessage(feed.file_id, feed.label, {
      msg_id:        `youtube-${videoId}`,
      title:         title || feed.defaultTitle,
      body,
      url,
      source:        feed.source,
      msg_timestamp: ts,
      ts_raw:        ts,
      image,
    })
    if (isNew && ts >= cutoff) {
      newMsgs.push({ title: title || feed.defaultTitle, source: feed.source, channelLabel: feed.label, url })
    }
    count++
  }
  return count
}

export async function fetchYouTubeRss(newMsgs: NewMsg[], cutoff: string): Promise<number> {
  let total = 0
  for (const feed of YT_FEEDS) {
    try { total += await fetchYouTubeRssOne(feed, newMsgs, cutoff) }
    catch (err) { console.warn('[cron sc-feed] YT fetch failed', feed.file_id, err) }
  }
  return total
}

// ---------- prune ----------

export async function pruneOldMessages() {
  const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
  const ytExclusions = YT_FEEDS.map(f => `channel_id!="${f.file_id}"`).join('&&')
  const res = await fetch(
    `${PB_URL}/api/collections/sc_feed_messages/records?filter=${encodeURIComponent(`ts_raw<"${cutoff}"&&${ytExclusions}`)}&perPage=200`,
    { headers: { 'Content-Type': 'application/json' } }
  ).then(r => r.json()).catch(() => null)

  let count = 0
  for (const rec of res?.items ?? []) {
    await fetch(`${PB_URL}/api/collections/sc_feed_messages/records/${rec.id}`, {
      method: 'DELETE',
    }).catch(() => {})
    count++
  }
  return count
}

// ---------- knowledge base diffs (Zendesk help center) ----------
// TrackerSC posts an [Updated] card whenever an RSI Knowledge Base article changes,
// but never says WHAT changed. We re-fetch the article from Zendesk's public Help
// Center API, normalize it to stable text, diff it against the last snapshot we
// stored, and persist a per-message diff so the card can show the actual change.
//
// Storage (latest-only): sc_feed_kb_snapshots holds ONE rolling normalized body per
// article_id (the baseline for the NEXT edit). sc_feed_kb_diffs holds the frozen diff
// keyed by msg_id (one row per [Updated] card). Snapshots must be exempt from prune.

// Captures locale (group 1) + numeric article id (group 2)
export const KB_ARTICLE_RE = /support\.robertsspaceindustries\.com\/hc\/([^/]+)\/articles\/(\d+)/

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
}
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => HTML_ENTITIES[name] ?? m)
}

/** Strip Zendesk article HTML to stable plaintext so markup churn (auto-generated
 *  heading ids, wysiwyg-* classes, attribute reordering) never shows up as a change. */
export function normalizeKbHtml(html: string): string {
  let t = html
  t = t.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
  t = t.replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer|ul|ol|blockquote|figure|figcaption|table)>/gi, '\n')
  t = t.replace(/<br\s*\/?>/gi, '\n')
  t = t.replace(/<li[^>]*>/gi, '• ')
  t = t.replace(/<[^>]+>/g, '')
  t = decodeEntities(t)
  t = t.replace(/\r/g, '')
  t = t.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
  t = t.replace(/\n{3,}/g, '\n\n').trim()
  return t
}

function tokenizeKb(text: string): string[] {
  const out: string[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const w of lines[i].split(/\s+/)) if (w) out.push(w)
    if (i < lines.length - 1) out.push('\n')
  }
  return out
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const INS_STYLE = 'background-color:rgb(34 197 94 / 0.20);text-decoration:none;border-radius:3px;padding:0 2px'
const DEL_STYLE = 'background-color:rgb(239 68 68 / 0.18);text-decoration:line-through;border-radius:3px;padding:0 2px'

function renderRun(tag: 'ins' | 'del' | null, toks: string[]): string {
  const html = toks.map(t => (t === '\n' ? '<br>' : esc(t))).join(' ').replace(/ <br> /g, '<br>')
  if (!tag) return html
  const style = tag === 'ins' ? INS_STYLE : DEL_STYLE
  return `<${tag} style="${style}">${html}</${tag}>`
}

type DiffRun = { tag: 'ins' | 'del' | null; toks: string[] }

/** Compact one-line preview centered on the changed region (a few words of context
 *  each side, capped), for the card face. Newlines collapsed — this is a teaser. */
function buildKbPreview(runs: DiffRun[]): string {
  const words = (toks: string[]) => toks.filter(t => t !== '\n')
  const changed = runs.map((r, i) => (r.tag ? i : -1)).filter(i => i >= 0)
  if (!changed.length) return ''
  const first = changed[0], last = changed[changed.length - 1]
  const slice: DiffRun[] = []
  if (first > 0) {
    const ctx = words(runs[first - 1].toks)
    slice.push({ tag: null, toks: ctx.length > 6 ? ['…', ...ctx.slice(-6)] : ctx })
  }
  let budget = 44
  for (let k = first; k <= last && budget > 0; k++) {
    const w = words(runs[k].toks).slice(0, budget)
    budget -= w.length
    slice.push({ tag: runs[k].tag, toks: w })
  }
  if (last < runs.length - 1) {
    const ctx = words(runs[last + 1].toks)
    slice.push({ tag: null, toks: ctx.length > 6 ? [...ctx.slice(0, 6), '…'] : ctx })
  }
  return slice.map(r => renderRun(r.tag, r.toks)).join(' ')
}

/** Word-level LCS diff of two normalized texts → rendered HTML, add/remove counts, and a
 *  compact preview. Falls back to a coarse whole-block replace if too large to DP. */
export function wordDiff(oldText: string, newText: string): { html: string; added: number; removed: number; preview: string } {
  const a = tokenizeKb(oldText)
  const b = tokenizeKb(newText)
  const countWords = (toks: string[]) => toks.filter(t => t !== '\n').length

  if (a.length * b.length > 6_000_000) {
    const noNl = (t: string) => t !== '\n'
    return {
      html: renderRun('del', a) + '<br><br>' + renderRun('ins', b),
      added: countWords(b), removed: countWords(a),
      preview: renderRun('del', a.filter(noNl).slice(0, 18)) + ' … ' + renderRun('ins', b.filter(noNl).slice(0, 18)),
    }
  }

  const n = a.length, m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])

  type Op = { t: 'eq' | 'add' | 'del'; tok: string }
  const ops: Op[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: 'eq', tok: a[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', tok: a[i] }); i++ }
    else { ops.push({ t: 'add', tok: b[j] }); j++ }
  }
  while (i < n) ops.push({ t: 'del', tok: a[i++] })
  while (j < m) ops.push({ t: 'add', tok: b[j++] })

  const runs: DiffRun[] = []
  let cur: { t: 'eq' | 'add' | 'del'; toks: string[] } | null = null
  const tagOf = (t: 'eq' | 'add' | 'del') => (t === 'eq' ? null : t === 'add' ? 'ins' : 'del')
  for (const op of ops) {
    if (!cur || cur.t !== op.t) {
      if (cur) runs.push({ tag: tagOf(cur.t), toks: cur.toks })
      cur = { t: op.t, toks: [] }
    }
    cur.toks.push(op.tok)
  }
  if (cur) runs.push({ tag: tagOf(cur.t), toks: cur.toks })

  let added = 0, removed = 0
  for (const r of runs) {
    if (r.tag === 'ins') added += countWords(r.toks)
    if (r.tag === 'del') removed += countWords(r.toks)
  }
  const html = runs.map(r => renderRun(r.tag, r.toks)).join(' ').replace(/ <br> /g, '<br>')
  return { html, added, removed, preview: buildKbPreview(runs) }
}

async function fetchZendeskArticle(id: string, locale: string): Promise<{ body: string; title: string; edited_at: string } | null> {
  try {
    const res = await fetch(
      `https://support.robertsspaceindustries.com/api/v2/help_center/${locale}/articles/${id}.json`,
      { headers: { 'Accept': 'application/json', 'User-Agent': SPECTRUM_HEADERS['User-Agent'] } }
    )
    if (!res.ok) return null
    const j = await res.json()
    const a = j.article
    if (!a) return null
    return { body: a.body ?? '', title: a.title ?? '', edited_at: a.edited_at ?? a.updated_at ?? '' }
  } catch { return null }
}

// TrackerSC Comm-Link cards (This Week in Star Citizen, Behind the Ships, etc.) point at
// an RSI comm-link whose body is client-rendered (no API), and the bot stub carries a
// dead share-image URL. The article page does expose a real per-article hero via og:image
// though — a meta tag present in the static HTML. We grab it and upgrade the tiny
// `heap_thumb` rendition to the full-size `post` rendition on RSI's media CDN.
export async function fetchCommLinkImage(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': SPECTRUM_HEADERS['User-Agent'], 'Accept': 'text/html' } })
    if (!res.ok) return ''
    const html = await res.text()
    const m = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)
    if (!m) return ''
    let img = m[1].trim()
    // RSI media CDN serves several renditions per asset; og:image is a 61px thumb.
    if (/media\.robertsspaceindustries\.com\/[^/]+\//.test(img)) {
      img = img.replace(/\/[^/]+\.(jpg|jpeg|png|webp)(\?.*)?$/i, '/post.jpg')
    }
    return img
  } catch {
    return ''
  }
}

// Comm-Link article bodies are rendered client-side (the server returns an unfilled
// template to plain HTTP fetches), so we render the page in a headless browser and read
// the article text out of `.alexandria-content-body`. Playwright is a devDependency and
// is listed in next.config `serverExternalPackages`, so it is NEVER bundled into the
// Vercel build — the dynamic import simply throws there and we return ''. The local
// Monitarr cron (which has chromium installed) is the only place this actually runs.
export async function fetchCommLinkBody(url: string, titleHint = ''): Promise<string> {
  let browser: import('playwright').Browser | undefined
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ userAgent: SPECTRUM_HEADERS['User-Agent'] })
    // networkidle never settles (RSI holds persistent connections) — wait for the content node.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    // The content node ships in the template but is filled by JS afterwards — wait for it
    // to actually carry text (not just exist), then a short settle for the rest to land.
    await page.waitForFunction(() => {
      const el = document.querySelector('.alexandria-content-body')
      return !!el && (el as HTMLElement).innerText.trim().length > 40
    }, { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(800)
    // Pull the article HTML (not innerText) so structure — headings, lists, bold, links —
    // survives. We convert it to Markdown below; the cards already render Markdown.
    const html: string = await page.evaluate(() => {
      const el = document.querySelector('.alexandria-content-body')
      return el ? el.innerHTML : ''
    })
    if (!html) return ''

    const turndown = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', emDelimiter: '*' })
    turndown.remove('img')        // hero image is shown separately; keep the body text-focused
    turndown.remove('figure')
    let md = turndown.turndown(html)

    // Drop leading heading/paragraph lines that just echo the card title.
    const titleLc = titleHint.toLowerCase().replace(/\s+/g, ' ').trim()
    let lines = md.split('\n')
    const bare = (l: string) => l.replace(/^#+\s*/, '').replace(/[*_>`]/g, '').trim().toLowerCase()
    while (lines.length && (!lines[0].trim() || (titleLc && bare(lines[0]) && titleLc.includes(bare(lines[0]))))) lines.shift()
    md = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    return md.slice(0, 4000)
  } catch {
    return ''
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

/** Current stored body for a message (by unique msg_id), or '' if none. Lets the cron
 *  reuse an already-rendered body instead of re-rendering, and avoids wiping it when the
 *  renderer is unavailable. */
export async function fetchStoredMessageBody(msgId: string): Promise<string> {
  try {
    const res = await fetch(`${PB_URL}/api/collections/sc_feed_messages/records?filter=msg_id%3D"${msgId}"&perPage=1`)
    const j = await res.json()
    return j?.items?.[0]?.body ?? ''
  } catch {
    return ''
  }
}

/** Idempotent per-message. On the first sighting of an article we only set the baseline
 *  snapshot (no diff to show). From the 2nd update on we store a real diff row. */
export async function processKbDiff(parsed: { msg_id: string; title: string; url: string }): Promise<void> {
  const match = parsed.url.match(KB_ARTICLE_RE)
  if (!match) return
  const [, locale, articleId] = match
  const base    = `${PB_URL}/api/collections`
  const headers = { 'Content-Type': 'application/json' }

  // Idempotency: if we've already produced a diff row for this card, stop.
  const seen = await fetch(`${base}/sc_feed_kb_diffs/records?filter=msg_id%3D"${parsed.msg_id}"&perPage=1`, { headers })
    .then(r => r.json()).catch(() => null)
  if (seen?.items?.[0]) return

  const art = await fetchZendeskArticle(articleId, locale)
  if (!art) return
  const current = normalizeKbHtml(art.body)

  const snapRes = await fetch(`${base}/sc_feed_kb_snapshots/records?filter=article_id%3D"${articleId}"&perPage=1`, { headers })
    .then(r => r.json()).catch(() => null)
  const snap = snapRes?.items?.[0]

  let added = 0, removed = 0, html = '', summary = '', preview = ''
  if (snap?.body_normalized && snap.body_normalized !== current) {
    const d = wordDiff(snap.body_normalized, current)
    added = d.added; removed = d.removed; html = d.html; preview = d.preview
    summary = `+${added} / −${removed}`
  }

  // Always write the diff row (even baseline/no-change) so re-runs short-circuit above.
  await fetch(`${base}/sc_feed_kb_diffs/records`, {
    method: 'POST', headers,
    body: JSON.stringify({
      msg_id: parsed.msg_id, article_id: articleId, summary, added, removed,
      diff_html: html, preview_html: preview, title: art.title || parsed.title, url: parsed.url,
    }),
  }).catch(() => {})

  // Roll the snapshot forward to the current body for the next edit.
  const snapBody = JSON.stringify({
    article_id: articleId, body_normalized: current,
    edited_at: art.edited_at, title: art.title, url: parsed.url,
  })
  if (snap) {
    await fetch(`${base}/sc_feed_kb_snapshots/records/${snap.id}`, { method: 'PATCH', headers, body: snapBody }).catch(() => {})
  } else {
    await fetch(`${base}/sc_feed_kb_snapshots/records`, { method: 'POST', headers, body: snapBody }).catch(() => {})
  }
}

/** Prune KB diff rows older than 15 days (they're orphaned once their message is pruned).
 *  Snapshots are NEVER pruned — they're the baseline for diffing future edits. */
export async function pruneOldKbDiffs(): Promise<number> {
  const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
  const res = await fetch(
    `${PB_URL}/api/collections/sc_feed_kb_diffs/records?filter=${encodeURIComponent(`created<"${cutoff}"`)}&perPage=200`,
    { headers: { 'Content-Type': 'application/json' } }
  ).then(r => r.json()).catch(() => null)

  let count = 0
  for (const rec of res?.items ?? []) {
    await fetch(`${PB_URL}/api/collections/sc_feed_kb_diffs/records/${rec.id}`, { method: 'DELETE' }).catch(() => {})
    count++
  }
  return count
}
