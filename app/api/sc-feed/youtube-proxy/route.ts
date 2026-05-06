import { NextResponse } from 'next/server'
import type { FeedMessage } from '@/app/api/sc-feed/route'

export const dynamic = 'force-dynamic'

const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'
const FETCH_TIMEOUT_MS = 8000
const MAX_VIDEOS = 10

const handleResolveCache = new Map<string, { channelId: string; name: string; ts: number }>()
const RESOLVE_TTL_MS = 60 * 60 * 1000 // 1 hour

async function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } })
  } finally {
    clearTimeout(timer)
  }
}

function parseYTInput(raw: string): { type: 'id' | 'handle'; value: string } | null {
  const v = raw.trim()
  if (!v) return null
  if (/^UC[A-Za-z0-9_-]{20,}$/.test(v)) return { type: 'id', value: v }
  const urlMatch = v.match(/youtube\.com\/(channel\/(UC[A-Za-z0-9_-]+)|@([A-Za-z0-9._-]+))/)
  if (urlMatch) {
    if (urlMatch[2]) return { type: 'id', value: urlMatch[2] }
    if (urlMatch[3]) return { type: 'handle', value: urlMatch[3] }
  }
  if (v.startsWith('@')) return { type: 'handle', value: v.slice(1) }
  return { type: 'handle', value: v }
}

async function resolveHandle(handle: string): Promise<{ channelId: string; name: string }> {
  const cacheKey = handle.toLowerCase()
  const cached = handleResolveCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < RESOLVE_TTL_MS) {
    return { channelId: cached.channelId, name: cached.name }
  }
  const res = await fetchWithTimeout(`https://www.youtube.com/@${encodeURIComponent(handle)}`)
  if (!res.ok) throw new Error(`Channel page HTTP ${res.status}`)
  const html = await res.text()
  const idMatch = html.match(/"channelId":"(UC[A-Za-z0-9_-]+)"/) ?? html.match(/<meta itemprop="identifier" content="(UC[A-Za-z0-9_-]+)"/)
  if (!idMatch) throw new Error('Could not find channelId on page')
  const channelId = idMatch[1]
  const nameMatch = html.match(/<meta property="og:title" content="([^"]+)"/) ?? html.match(/"title":"([^"]+)"/)
  const name = nameMatch ? nameMatch[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'") : `@${handle}`
  handleResolveCache.set(cacheKey, { channelId, name, ts: Date.now() })
  return { channelId, name }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
}

function getText(s: string, tag: string): string {
  const m = s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  return m?.[1]?.trim() ?? ''
}

async function fetchChannelVideos(channelId: string, channelName: string): Promise<FeedMessage[]> {
  const res = await fetchWithTimeout(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
  if (!res.ok) throw new Error(`YouTube RSS HTTP ${res.status}`)
  const xml = await res.text()

  const entries: FeedMessage[] = []
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  let m: RegExpExecArray | null
  while ((m = entryRe.exec(xml)) !== null && entries.length < MAX_VIDEOS) {
    const s = m[1]
    const videoId = getText(s, 'yt:videoId')
    if (!videoId) continue
    const title = decodeXmlEntities(getText(s, 'title'))
    const published = getText(s, 'published')
    const rawDesc = decodeXmlEntities(getText(s, 'media:description'))
    const body = rawDesc.split('------------------------------------------')[0].trim()
    const ts = published ? new Date(published).toISOString() : new Date().toISOString()
    entries.push({
      id: `youtube-${videoId}`,
      title: title || 'Star Citizen Video',
      body: body || undefined,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      source: channelName,
      timestamp: ts,
      ts_raw: ts,
      image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    })
  }
  return entries
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q') ?? searchParams.get('id') ?? searchParams.get('handle') ?? ''
  const parsed = parseYTInput(q)
  if (!parsed) return NextResponse.json({ error: 'Missing or invalid `q` param' }, { status: 400 })

  try {
    let channelId: string
    let channelName: string
    if (parsed.type === 'id') {
      channelId = parsed.value
      channelName = searchParams.get('name') ?? channelId
    } else {
      const r = await resolveHandle(parsed.value)
      channelId = r.channelId
      channelName = r.name
    }
    const messages = await fetchChannelVideos(channelId, channelName)
    return NextResponse.json({ channelId, name: channelName, messages }, { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 })
  }
}
