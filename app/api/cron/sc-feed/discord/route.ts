import { NextResponse } from 'next/server'
import {
  DISCORD_BASE,
  DISCORD_CHANNELS,
  DISCORD_TOKEN,
  RSI_TOKEN,
  fetchCommLinkImage,
  fetchCommLinkBody,
  fetchRedditBody,
  fetchRedditDevComment,
  fetchStoredMessageBody,
  fetchSpectrumThreadBodyByUrl,
  fetchTrackerDevContent,
  freshCutoff,
  KB_ARTICLE_RE,
  mergePipelineContinuations,
  parseDiscordMessage,
  processKbDiff,
  requireSecret,
  sendPushNotifications,
  upsertMessage,
  type DiscordMsg,
  type NewMsg,
} from '../_shared'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const unauth = requireSecret(request)
  if (unauth) return unauth

  if (!DISCORD_TOKEN) {
    return NextResponse.json({ error: 'DISCORD_BOT_TOKEN not set' }, { status: 500 })
  }

  const results: Record<string, unknown> = {}
  const newMsgs: NewMsg[] = []
  const cutoff = freshCutoff()

  for (const ch of DISCORD_CHANNELS) {
    try {
      const res = await fetch(
        `${DISCORD_BASE}/channels/${ch.id}/messages?limit=50`,
        { headers: { Authorization: DISCORD_TOKEN } }
      )
      if (!res.ok) throw new Error(`Discord ${res.status} for channel ${ch.id}`)

      const rawMsgs: DiscordMsg[] = await res.json()
      // Pipeline channels split long posts across multiple Discord messages — merge them
      // before parsing. cig-news bot stubs are independent and must NOT be merged.
      const msgs = ch.file_id === 'cig-news' ? rawMsgs : mergePipelineContinuations(rawMsgs)
      let count = 0
      for (const msg of msgs) {
        const parsed = parseDiscordMessage(msg, ch.label)
        if (parsed) {
          // ─── Per-channel enrichment ───
          // Each channel kind owns its own enrichment branch. Duplication between
          // branches is intentional — fixing one feed's logic must never alter
          // another's. DO NOT factor common code back out.
          // Gate on ch.file_id (slug), NOT ch.id (Discord snowflake).
          if (ch.file_id === 'cig-news') {
            // TrackerSC channel: bot stubs link to Spectrum threads (dev posts/replies)
            // or Reddit dev comments. We always replace the bot stub body with the
            // actual dev content fetched from the source.
            const hasRedditCommentId = /reddit\.com\/r\/\w+\/comments\/[a-zA-Z0-9]+\/[^/]*\/[a-zA-Z0-9]+$/.test(parsed.url ?? '')
            if (hasRedditCommentId) {
              const result = await fetchRedditDevComment(parsed.url!)
              if (result) {
                parsed.body = result.body
                if (result.devName) parsed.source = `${parsed.source}||${result.devName}`
              }
            } else if (!parsed.body && parsed.url?.includes('reddit.com/r/')) {
              parsed.body = await fetchRedditBody(parsed.url)
            }
            if (RSI_TOKEN && /robertsspaceindustries\.com\/spectrum\/.*\/thread\/[^/]+\/\d+$/.test(parsed.url ?? '')) {
              const devName = (parsed.body ?? '').replace(/\s*\[Reply\]\s*$/, '').trim()
              const result = await fetchTrackerDevContent(parsed.url!, devName)
              parsed.body = result.body || ''
              if (devName) parsed.source = `${parsed.source}||${devName}`
              // TrackerSC bot embeds always carry the generic Spectrum OG image
              // (tavern/opengraph.png) — always replace with the actual thread image,
              // even if that means clearing it when the thread has none.
              parsed.image = result.image
            } else if (!parsed.body && RSI_TOKEN && parsed.url?.includes('robertsspaceindustries.com/spectrum/community/')) {
              const result = await fetchSpectrumThreadBodyByUrl(parsed.url)
              parsed.body  = result.body
              if (result.image && !parsed.image) parsed.image = result.image
            }
            // Comm-Link cards: body is client-rendered (unfetchable) and the bot stub's
            // share image 404s. Pull the article's real hero image from the page's og:image
            // so the card has visual context. Best-effort — leave the stub image on failure.
            if (/\/comm-link\/transmission\//.test(parsed.url ?? '')) {
              const heroImg = await fetchCommLinkImage(parsed.url!)
              if (heroImg) parsed.image = heroImg
              // Body is client-rendered: render once with a headless browser, then reuse the
              // stored copy on later cycles (also avoids wiping it where the renderer is absent).
              const stored = await fetchStoredMessageBody(parsed.msg_id)
              parsed.body = stored || await fetchCommLinkBody(parsed.url!, parsed.title)
            }
            // Knowledge Base [Updated] cards link to Zendesk articles — generate a
            // change diff against our last snapshot (idempotent per msg_id). Best-effort:
            // never let a KB fetch failure break the channel ingest.
            if (parsed.url && KB_ARTICLE_RE.test(parsed.url)) {
              await processKbDiff({ msg_id: parsed.msg_id, title: parsed.title, url: parsed.url }).catch(() => {})
            }
          } else {
            // Pipeline channels (sc-news / patch-news / sc-leaks): humans relay news
            // and the Discord message content already carries the title + body
            // (parseDiscordMessage Case 2). Only enrich when body is genuinely missing.
            // Never wipe a parsed body here, and never write to source — the display
            // route reads source||... as a "dev" pill.
            if (!parsed.body && parsed.url?.includes('reddit.com/r/')) {
              parsed.body = await fetchRedditBody(parsed.url)
            } else if (!parsed.body && RSI_TOKEN && parsed.url?.includes('robertsspaceindustries.com/spectrum/community/')) {
              const result = await fetchSpectrumThreadBodyByUrl(parsed.url)
              parsed.body  = result.body
              if (result.image && !parsed.image) parsed.image = result.image
            }
          }
          // Strip bare forms.gle / docs.google.com/forms URLs from body before storing.
          // Chrome speculatively preconnects to forms.gle when those URLs appear in <a> tags,
          // causing 5-10s UI freezes. Strip https:// so GFM autolink doesn't fire on the client.
          if (parsed.body) {
            parsed.body = parsed.body
              .replace(/(?<!\()https:\/\/(forms\.gle\/[^\s)>\]]+)/g, '$1')
              .replace(/(?<!\()https:\/\/(docs\.google\.com\/forms\/[^\s)>\]]+)/g, '$1')
          }
          const isNew = await upsertMessage(ch.id, ch.label, parsed)
          if (isNew && parsed.ts_raw >= cutoff) {
            newMsgs.push({ title: parsed.title, source: parsed.source, channelLabel: ch.label, url: parsed.url })
          }
          count++
        }
      }
      results[ch.file_id] = { ok: true, count }
    } catch (err) {
      results[ch.file_id] = { ok: false, error: String(err) }
    }
  }

  if (newMsgs.length > 0) {
    await sendPushNotifications(newMsgs).catch(() => {})
  }

  return NextResponse.json({ ok: true, channels: results, pushed: newMsgs.length })
}
