import { NextResponse } from 'next/server'
import type { FeedMessage } from '@/app/api/sc-feed/route'

export const dynamic = 'force-dynamic'

const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'
const FETCH_TIMEOUT_MS = 8000
const MAX_ITEMS = 15
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // 5 MB

async function fetchWithTimeout(url: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    })
  } finally {
    clearTimeout(timer)
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
}

function getTag(s: string, tag: string): string {
  const m = s.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return m?.[1]?.trim() ?? ''
}

function getAttr(s: string, tag: string, attr: string): string {
  const m = s.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}=['"]([^'"]+)['"][^>]*>`))
  return m?.[1] ?? ''
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function findFirstImageUrl(html: string): string | undefined {
  const m = html.match(/<img[^>]+src=['"]([^'"]+)['"]/i)
  return m?.[1]
}

function parseFeed(xml: string, sourceLabel: string): { feedTitle: string; messages: FeedMessage[] } {
  const isAtom = /<feed\b[^>]*xmlns=['"]http:\/\/www\.w3\.org\/2005\/Atom['"]/i.test(xml) || /<feed\b/i.test(xml.slice(0, 500))
  const channelHeader = xml.match(/<channel\b[^>]*>([\s\S]*?)<item\b/i)?.[1] ?? xml.slice(0, 2000)
  const feedTitle = decodeXmlEntities(getTag(channelHeader, 'title')) || sourceLabel
  const messages: FeedMessage[] = []

  if (isAtom) {
    const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g
    let m: RegExpExecArray | null
    while ((m = entryRe.exec(xml)) !== null && messages.length < MAX_ITEMS) {
      const s = m[1]
      const title = decodeXmlEntities(getTag(s, 'title'))
      const linkHref = getAttr(s, 'link', 'href')
      const id = getTag(s, 'id') || linkHref || `${feedTitle}-${messages.length}`
      const published = getTag(s, 'published') || getTag(s, 'updated')
      const summary = decodeXmlEntities(getTag(s, 'summary') || getTag(s, 'content'))
      const ts = published ? new Date(published).toISOString() : new Date().toISOString()
      messages.push({
        id,
        title: title || '(untitled)',
        body: stripHtml(summary).slice(0, 600) || undefined,
        url: linkHref,
        source: feedTitle,
        timestamp: ts,
        ts_raw: ts,
        image: findFirstImageUrl(summary),
      })
    }
  } else {
    const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/g
    let m: RegExpExecArray | null
    while ((m = itemRe.exec(xml)) !== null && messages.length < MAX_ITEMS) {
      const s = m[1]
      const title = decodeXmlEntities(getTag(s, 'title'))
      const link = decodeXmlEntities(getTag(s, 'link'))
      const guid = decodeXmlEntities(getTag(s, 'guid')) || link
      const pubDate = getTag(s, 'pubDate') || getTag(s, 'dc:date')
      const description = decodeXmlEntities(getTag(s, 'description') || getTag(s, 'content:encoded'))
      const enclosureImg = getAttr(s, 'enclosure', 'url')
      const ts = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString()
      messages.push({
        id: guid || `${feedTitle}-${messages.length}`,
        title: title || '(untitled)',
        body: stripHtml(description).slice(0, 600) || undefined,
        url: link,
        source: feedTitle,
        timestamp: ts,
        ts_raw: ts,
        image: enclosureImg || findFirstImageUrl(description),
      })
    }
  }

  return { feedTitle, messages }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const url = searchParams.get('url') ?? ''
  let parsedUrl: URL
  try { parsedUrl = new URL(url) } catch { return NextResponse.json({ error: 'Invalid url' }, { status: 400 }) }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return NextResponse.json({ error: 'Only http(s) URLs allowed' }, { status: 400 })
  }

  try {
    const res = await fetchWithTimeout(parsedUrl.toString())
    if (!res.ok) return NextResponse.json({ error: `Upstream HTTP ${res.status}` }, { status: 502 })

    const ct = res.headers.get('content-type') ?? ''
    if (!/(xml|rss|atom|text\/plain)/i.test(ct)) {
      return NextResponse.json({ error: `Unexpected content-type: ${ct}` }, { status: 415 })
    }

    const lenHeader = Number(res.headers.get('content-length') ?? '0')
    if (lenHeader && lenHeader > MAX_RESPONSE_BYTES) {
      return NextResponse.json({ error: 'Feed too large' }, { status: 413 })
    }

    const xml = await res.text()
    if (xml.length > MAX_RESPONSE_BYTES) {
      return NextResponse.json({ error: 'Feed too large' }, { status: 413 })
    }

    const sourceLabel = searchParams.get('label') ?? parsedUrl.hostname
    const { feedTitle, messages } = parseFeed(xml, sourceLabel)
    return NextResponse.json({ feedTitle, messages }, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
