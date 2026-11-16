// "TrackerSC has it and we don't" check, for the side-by-side month (Sub, 2026-11-16).
//
// Every direct run compares TrackerSC's recent cig-news rows of the kinds we now read ourselves
// against our own rows, matched by key (both sides build the same msg_id from the same RSI/Reddit
// id). Anything TrackerSC relayed that we still lack after a grace period is posted ONCE to the
// watchdog's Discord channel (#SC-Feed Alerts, WATCHDOG_DISCORD_WEBHOOK). Remove this file at
// cutover, when cig-news stops being read.

import { and, eq, gte, inArray } from 'drizzle-orm'
import { db, messages as messagesTbl } from '@/lib/db'
import { decryptRow } from '@/lib/feed-crypt'
import { getConfigValue, setConfigValue } from '@/lib/sc-config'
import { DIRECT_CHANNELS } from './direct'

const TRACKERSC_CHANNEL = '933047593666236487'   // cig-news
const WINDOW_MS = 3 * 24 * 3600e3
const ALERTED_KEY = 'direct_gap_alerted'
const STARTED_KEY = 'direct_started_at'

// How long TrackerSC's row may wait for ours before it counts as a miss. Reddit comes through an
// archive that lags ~20–40 min; RSI sources show up within one 10-min run.
const GRACE_MS: Record<string, number> = { commlink: 30 * 60e3, spectrum: 30 * 60e3, reddit: 120 * 60e3 }

/** TrackerSC row → the msg_id our direct channels use for the same item, or null if it is a kind
 *  we don't read ourselves yet (Store, KB, Ship Upgrade…). */
export function trackerKey(source: string, url: string): { key: string; kind: string } | null {
  if (/comm-link/i.test(source)) {
    const id = url.match(/\/comm-link\/[^/]+\/(\d+)-/)?.[1]
    return id ? { key: `commlink-${id}`, kind: 'commlink' } : null
  }
  if (/dev tracker/i.test(source)) {
    const id = url.match(/\/spectrum\/community\/[^/]+\/forum\/\d+\/thread\/[^/]+\/(\d+)$/)?.[1]
    return id ? { key: `devpost-spectrum-${id}`, kind: 'spectrum' } : null
  }
  if (/reddit/i.test(source)) {
    const id = url.match(/reddit\.com\/r\/\w+\/comments\/[a-z0-9]+\/[^/]*\/([a-z0-9]+)\/?$/i)?.[1]
      ?? url.match(/reddit\.com\/r\/\w+\/comments\/([a-z0-9]+)\/[^/]*\/?$/i)?.[1]
    return id ? { key: `devpost-reddit-${id}`, kind: 'reddit' } : null
  }
  return null
}

async function sendAlert(embed: Record<string, unknown>): Promise<string> {
  const url = process.env.WATCHDOG_DISCORD_WEBHOOK
  if (!url) return 'no webhook configured'
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'SC Feed Watchdog', embeds: [embed] }),
    })
    return res.ok ? 'sent' : `discord ${res.status}`
  } catch (e) {
    return String(e)
  }
}

export async function checkTrackerGaps(now = Date.now()) {
  // Only compare from the first direct run on; earlier TrackerSC rows had nothing to match.
  let startedAt = Date.parse(await getConfigValue(STARTED_KEY).catch(() => '') || '')
  if (!startedAt) {
    startedAt = now
    await setConfigValue(STARTED_KEY, new Date(now).toISOString(), { updated_via: 'cron' })
  }
  const since = new Date(Math.max(startedAt, now - WINDOW_MS))

  const theirs = await db.select({
    msgId: messagesTbl.msgId, title: messagesTbl.title, url: messagesTbl.url, source: messagesTbl.source,
    body: messagesTbl.body, image: messagesTbl.image, tsRaw: messagesTbl.tsRaw,
  }).from(messagesTbl).where(and(eq(messagesTbl.channelId, TRACKERSC_CHANNEL), gte(messagesTbl.tsRaw, since)))

  const ours = new Set((await db.select({ msgId: messagesTbl.msgId }).from(messagesTbl)
    .where(inArray(messagesTbl.channelId, Object.values(DIRECT_CHANNELS).map(c => c.id))))
    .map(r => r.msgId))

  const gaps: { key: string; kind: string; title: string; url: string }[] = []
  let compared = 0
  for (const raw of theirs) {
    const r = decryptRow(raw, raw.msgId)
    const k = trackerKey(r.source ?? '', r.url ?? '')
    if (!k) continue
    if (now - r.tsRaw.getTime() < GRACE_MS[k.kind]) continue
    compared++
    if (!ours.has(k.key)) gaps.push({ ...k, title: r.title ?? '', url: r.url ?? '' })
  }

  let alerted: string[] = []
  try { alerted = JSON.parse(await getConfigValue(ALERTED_KEY) || '[]') } catch { /* start fresh */ }
  const fresh = gaps.filter(g => !alerted.includes(g.key))
  let delivery = ''
  if (fresh.length) {
    const label: Record<string, string> = { commlink: 'Comm-Link', spectrum: 'Spectrum dev post', reddit: 'Reddit dev post' }
    delivery = await sendAlert({
      title: `🔍 TrackerSC had ${fresh.length} post${fresh.length > 1 ? 's' : ''} SC Feed's own check missed`,
      description: fresh.slice(0, 10).map(g => `• **${label[g.kind]}**: [${g.title.slice(0, 90) || g.key}](${g.url})`).join('\n')
        + (fresh.length > 10 ? `\n…and ${fresh.length - 10} more` : '')
        + '\n\nSide-by-side test of the first-party sources. Each miss is reported once.',
      color: 0xffb231,
      footer: { text: 'SC Feed · /api/cron/sc-feed/direct' },
    })
    // Remember a key only once Discord took the message, so a failed send retries next run.
    if (delivery === 'sent') {
      alerted = [...alerted, ...fresh.map(g => g.key)].slice(-500)
      await setConfigValue(ALERTED_KEY, JSON.stringify(alerted), { updated_via: 'cron' })
    }
  }
  return { compared, gaps: gaps.length, newlyAlerted: fresh.length, delivery, gapKeys: gaps.map(g => g.key).slice(0, 20) }
}
