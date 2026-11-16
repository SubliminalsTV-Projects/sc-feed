// Two small web lookups the bot makes once per new item, before it posts. Both fail soft:
// on any error the item still posts, as a plain video or without a summary.

import https from 'node:https'

const UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0'
const TIMEOUT_MS = 8_000
const CACHE_MAX = 500

function cached<T>(fn: (key: string) => Promise<T>) {
  const cache = new Map<string, Promise<T>>()
  return (key: string) => {
    let p = cache.get(key)
    if (!p) {
      p = fn(key)
      cache.set(key, p)
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!)
    }
    return p
  }
}

// ---------- YouTube Shorts ----------

// youtube.com/shorts/<id> answers 200 for a Short and redirects (303) to /watch for any other
// video. Measured 2026-11-16 on the official channel's own lists: it agreed with the Shorts
// playlist (UUSH…) on 15 of 15 and the long-form playlist (UULF…) on 14 of 15. The one
// disagreement was a 23-second vertical clip the playlist had not reclassified yet. Those
// playlists can't be used directly: their feeds only list the newest 15, and lag.
// Not fetch(): YouTube's response headers run past undici's 16 KB limit
// (UND_ERR_HEADERS_OVERFLOW), and node:https lets one request raise it.
export const isShort = cached((videoId: string) => new Promise<boolean>(resolve => {
  const req = https.request(`https://www.youtube.com/shorts/${encodeURIComponent(videoId)}`, {
    method: 'HEAD', headers: { 'User-Agent': UA }, maxHeaderSize: 128 * 1024, timeout: TIMEOUT_MS,
  }, res => { res.resume(); resolve(res.statusCode === 200) })
  req.on('timeout', () => req.destroy(new Error('timeout')))
  req.on('error', () => resolve(false))
  req.end()
}))

const YT_ID_RE = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/

export function youtubeId(url: string): string | null {
  return YT_ID_RE.exec(url)?.[1] ?? null
}

// ---------- Comm-Link summary ----------

// A Comm-Link page is an empty shell filled in by JavaScript, so a plain fetch has no article
// text (sc-feed only gets it from a headless browser, which the VPS cron doesn't run). The
// shell does carry `data-platform-client-props`, whose content.htmlUrl is a static HTML file
// holding the article. Its first real paragraphs make the summary.
// Measured 2026-11-16 on 9 recent Comm-Links: articles (This Week in SC, Monthly Report, Q&A,
// Twitch Drops, Behind the Ships) gave a clean opening. Pages that redirect elsewhere (the IAE
// manufacturer days), ship sale pages and lorem-ipsum template text are skipped, so those
// post with the title and image only.
const JUNK_RE = /lorem ipsum|dolor sit amet|duis aute|customize your pledge|also available in these packs|only available to members/i
const SUMMARY_MAX = 350

const decode = (s: string) => s
  .replace(/&(amp|lt|gt|quot|#39|apos|nbsp|rsquo|lsquo|rdquo|ldquo|hellip|mdash|ndash);/g, (_, e) => (
    { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–' } as Record<string, string>)[e])
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export function summaryFromArticleHtml(html: string): string {
  const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 40 && !JUNK_RE.test(p))
  let out = ''
  for (const p of paras) {
    if (out && out.length + p.length > SUMMARY_MAX) break
    out = out ? `${out}\n\n${p}` : p
  }
  if (out.length <= SUMMARY_MAX) return out
  const cut = out.slice(0, SUMMARY_MAX)
  const sentence = cut.lastIndexOf('. ')
  return sentence > 120 ? cut.slice(0, sentence + 1) : cut.replace(/\s+\S*$/, '') + '…'
}

export const commLinkSummary = cached(async (url: string): Promise<string> => {
  try {
    const page = await getText(url)
    const m = /data-platform-client-props="([^"]+)"/.exec(page)
    if (!m) return ''
    const props = JSON.parse(decode(m[1]))
    const content = props?.routerParams?.props?.content
    if (!content?.htmlUrl || /location\.replace/.test(content.js ?? '')) return ''
    return summaryFromArticleHtml(await getText(content.htmlUrl))
  } catch {
    return ''
  }
})
