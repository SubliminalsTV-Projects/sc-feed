// News loop: every minute, read scfeed rows inserted since the cursor and fan each one out to
// the channels that follow its category.
//
// Why each guard exists:
// - Cursor on the identity `id`: rows are only ever inserted with a higher id. Updates to an
//   existing row (sc-feed re-upserts every cycle) keep their id, so they are never re-posted.
// - SETTLE: only read rows older than 30s, so an insert that took its id but hasn't committed
//   yet can't be skipped by the cursor moving past it.
// - FRESH: sc-feed can insert rows for OLD news (a new source's first sync, or the cron
//   re-inserting messages prune deleted). Only items whose own timestamp is recent are news.
//   This also bounds catch-up after downtime.
// - Delivery log: claim (subscription, msg_id) before sending → at most one post per item.
// - dedupe_key: the same story arrives from several sources (Pipeline + Spectrum patch notes,
//   Pipeline MOTD relays + the scraped MOTD). One post per channel per story per 48h.

import { Routes, DiscordAPIError, type REST } from 'discord.js'
import { and, arrayContains, asc, desc, eq, gt, inArray, lt, max, sql as dsql } from 'drizzle-orm'
import { db, messages, kbDiffs } from '../../lib/db'
import { blindHash, decryptRow } from '../../lib/feed-crypt'
import { deliveries, menus, state, subscriptions } from './schema'
import { type CategoryId } from './sources'
import { buildPost, type Extras, type KbInfo, type MessageRow } from './embed'
import { channelsFor, classify, type Classified } from './classify'
import { commLinkSummary } from './lookups'

const POLL_MS = 60_000
const FRESH_MS = 12 * 60 * 60 * 1000
const DEDUPE_WINDOW = dsql`now() - interval '48 hours'`
const DELIVERY_RETENTION = dsql`now() - interval '45 days'`
const MAX_PERMANENT_ERRORS = 3
const SEND_CONCURRENCY = 10
const SPECTRUM_THREAD_RE = /robertsspaceindustries\.com\/spectrum\/.*\/thread\//

// Discord error codes meaning "this channel will never accept our posts as configured".
const PERMANENT_CODES = new Set([10003 /* unknown channel */, 10004 /* unknown guild */, 50001 /* missing access */, 50013 /* missing permissions */])

type Subscription = typeof subscriptions.$inferSelect

const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[poller]', ...a)

// ---------- cursor / state ----------

async function getState(key: string): Promise<string | null> {
  const r = await db.select({ value: state.value }).from(state).where(eq(state.key, key)).limit(1)
  return r[0]?.value ?? null
}

async function setState(key: string, value: string) {
  await db.insert(state).values({ key, value, updated: new Date() })
    .onConflictDoUpdate({ target: state.key, set: { value, updated: new Date() } })
}

async function loadCursor(): Promise<number> {
  const v = await getState('cursor')
  if (v !== null) return Number(v)
  // First run: start at the newest row so a fresh install doesn't replay history.
  const r = await db.select({ m: max(messages.id) }).from(messages)
  const start = r[0]?.m ?? 0
  await setState('cursor', String(start))
  log(`no cursor — starting at id ${start}`)
  return start
}

// ---------- dedupe ----------

function normTitle(t: string) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 60)
}

function normUrl(u: string) {
  try {
    const url = new URL(u)
    for (const k of [...url.searchParams.keys()]) if (k.startsWith('utm_')) url.searchParams.delete(k)
    // Pipeline links RSI pages with a /en/ locale and RSI Status with /index.html; the
    // direct sources don't. Strip both so the same story dedupes across sources.
    const path = url.pathname.replace(/^\/[a-z]{2}(?=\/comm-link\/)/i, '').replace(/\/index\.html$/i, '').replace(/\/+$/, '')
    return (url.host.replace(/^www\./, '') + path + url.search).toLowerCase()
  } catch { return u.toLowerCase() }
}

export function dedupeKey(row: MessageRow, cls: Classified, kb: KbInfo | null): string {
  if (kb) return `kb:${kb.articleId}:${kb.stateSig}`
  // MOTD cards link to the patch-notes thread, so their URL would collide with the notes.
  if (cls.card === 'motd') return `title:${normTitle(row.title)}`
  // Several dev replies share one Spectrum thread URL — each reply is its own item.
  if (cls.card === 'dev' && SPECTRUM_THREAD_RE.test(row.url)) return `msg:${row.msgId}`
  // youtu.be/x, watch?v=x and shorts/x are one video.
  if (cls.videoId) return `yt:${cls.videoId}`
  if (/^https?:\/\//i.test(row.url)) return `url:${normUrl(row.url)}`
  // TrackerSC store posts have neither a title nor a link; one shared key would let only
  // the first of them through in any 48h.
  const t = normTitle(row.title)
  return t ? `title:${t}` : `msg:${row.msgId}`
}

async function kbInfoFor(row: MessageRow, cls: Classified): Promise<KbInfo | null> {
  if (cls.card !== 'kb') return null
  const r = await db.select().from(kbDiffs).where(eq(kbDiffs.msgId, row.msgId)).limit(1)
  const d = r[0]
  if (!d) return null
  return { articleId: d.articleId, stateSig: d.stateSig, summary: d.summary, added: d.added, removed: d.removed, previewHtml: d.previewHtml }
}

// ---------- sending ----------

function describeError(err: unknown): string {
  if (err instanceof DiscordAPIError) return `${err.code} ${err.message}`
  return String(err).slice(0, 300)
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item)
  }))
}

// With a ping menu, the feed's menu role. Otherwise the /feed role mapping: the category's
// own role if set ('' = muted), else the channel's default role.
export function pingRole(sub: Pick<Subscription, 'roleId' | 'categoryRoles'>, category: CategoryId, menuRoles?: Record<string, string>): string | null {
  if (menuRoles) return menuRoles[category] || null
  const own = sub.categoryRoles[category]
  return (own !== undefined ? own : sub.roleId) || null
}

function roleMention(sub: Subscription, category: CategoryId, menuRoles?: Record<string, string>) {
  const role = pingRole(sub, category, menuRoles)
  return role
    ? { content: `<@&${role}>`, allowed_mentions: { parse: [], roles: [role] } }
    : { allowed_mentions: { parse: [] } }
}

async function recordFailure(sub: Subscription, err: unknown) {
  const msg = describeError(err)
  if (!(err instanceof DiscordAPIError) || typeof err.code !== 'number' || !PERMANENT_CODES.has(err.code)) {
    log(`transient send failure to ${sub.channelId}: ${msg}`)
    return
  }
  const count = sub.errorCount + 1
  const paused = count >= MAX_PERMANENT_ERRORS
  await db.update(subscriptions)
    .set({ errorCount: count, lastError: msg, paused, updated: new Date() })
    .where(eq(subscriptions.id, sub.id))
  log(`permanent failure ${count}/${MAX_PERMANENT_ERRORS} for channel ${sub.channelId}${paused ? ' — PAUSED' : ''}: ${msg}`)
}

async function extrasFor(row: MessageRow, cls: Classified): Promise<Extras> {
  const kb = await kbInfoFor(row, cls)
  const summary = cls.card === 'commlink' && !(row.body ?? '').trim() && /^https?:\/\//.test(row.url) ? await commLinkSummary(row.url) : ''
  return { kb, summary }
}

async function deliver(rest: REST, row: MessageRow, allowlist: string[]): Promise<'stale' | void> {
  if (Date.now() - row.tsRaw.getTime() > FRESH_MS) return 'stale'
  const cls = await classify(row)
  if (!cls) return

  const extras = await extrasFor(row, cls)
  const rawKey = dedupeKey(row, cls, extras.kb)
  // Dedupe keys hold urls and titles, so they are stored as a keyed hash (lib/feed-crypt.ts).
  // The lookup also matches the raw form so rows written before encryption still dedupe;
  // they age out of the 48h window on their own.
  const key = blindHash(rawKey) ?? rawKey
  const keys = key === rawKey ? [key] : [key, rawKey]
  const conds = [eq(subscriptions.paused, false), arrayContains(subscriptions.categories, [cls.feed])]
  if (allowlist.length) conds.push(inArray(subscriptions.guildId, allowlist))
  const subs = await db.select().from(subscriptions).where(and(...conds))
  if (!subs.length) return

  const alreadyHave = new Set((await db.select({ id: deliveries.subscriptionId }).from(deliveries)
    .where(and(inArray(deliveries.dedupeKey, keys), gt(deliveries.created, DEDUPE_WINDOW),
      inArray(deliveries.subscriptionId, subs.map(s => s.id))))).map(r => r.id))

  const payload = buildPost(row, cls, extras)
  const guildMenus = new Map((await db.select({ guildId: menus.guildId, roles: menus.roles }).from(menus)
    .where(inArray(menus.guildId, [...new Set(subs.map(s => s.guildId))]))).map(m => [m.guildId, m.roles]))
  let sent = 0
  await pool(subs.filter(s => !alreadyHave.has(s.id)), SEND_CONCURRENCY, async sub => {
    const claim = await db.insert(deliveries)
      .values({ subscriptionId: sub.id, msgId: row.msgId, dedupeKey: key })
      .onConflictDoNothing().returning({ id: deliveries.id })
    if (!claim.length) return
    try {
      const res = await rest.post(Routes.channelMessages(sub.channelId), { body: { ...payload, ...roleMention(sub, cls.feed, guildMenus.get(sub.guildId)) } }) as { id: string }
      await db.update(deliveries).set({ discordMessageId: res.id }).where(eq(deliveries.id, claim[0].id))
      if (sub.errorCount) {
        await db.update(subscriptions).set({ errorCount: 0, lastError: '', updated: new Date() }).where(eq(subscriptions.id, sub.id))
      }
      sent++
    } catch (err) {
      await db.update(deliveries).set({ error: describeError(err) }).where(eq(deliveries.id, claim[0].id))
      await recordFailure(sub, err)
    }
  })
  // No title here: container logs sit on the same unencrypted disk as the database.
  log(`${row.channelId}/${row.msgId} [${cls.feed}] → ${sent}/${subs.length} channels (${alreadyHave.size} already had it)`)
}

// ---------- loop ----------

let lastPrune = 0

async function tick(rest: REST, allowlist: string[]) {
  let cursor = await loadCursor()
  const rows = await db.select().from(messages)
    .where(and(gt(messages.id, cursor), lt(messages.created, dsql`now() - interval '30 seconds'`)))
    .orderBy(asc(messages.id)).limit(500)
  let stale = 0
  for (const row of rows) {
    try {
      // A row that will not decrypt (wrong or missing key) throws here and holds the cursor,
      // so nothing is skipped: fix SCFEED_ENC_KEYS and the next tick carries on.
      if (await deliver(rest, decryptRow(row, row.msgId), allowlist) === 'stale') stale++
    } catch (err) {
      // A DB error mid-item: stop here and retry this row next tick (claims make it safe).
      log(`deliver failed for id ${row.id}, retrying next tick:`, err)
      break
    }
    cursor = row.id
  }
  if (rows.length) await setState('cursor', String(cursor))
  if (stale) log(`skipped ${stale} stale row(s) (older than ${FRESH_MS / 3_600_000}h)`)
  await setState('heartbeat', JSON.stringify({ at: new Date().toISOString(), cursor }))

  if (Date.now() - lastPrune > 24 * 60 * 60 * 1000) {
    const gone = await db.delete(deliveries).where(lt(deliveries.created, DELIVERY_RETENTION)).returning({ id: deliveries.id })
    if (gone.length) log(`pruned ${gone.length} old deliveries`)
    lastPrune = Date.now()
  }
}

export function startPoller(rest: REST, allowlist: string[]) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try { await tick(rest, allowlist) } catch (err) { log('tick failed:', err) } finally { running = false }
  }
  void run()
  const timer = setInterval(run, POLL_MS)
  return () => clearInterval(timer)
}

// ---------- test posts (/feed test) ----------

// The newest carried item in any of these categories, for a "this is what it looks like" post.
// Feeds are decided per row, so read a window of recent rows and take the first that fits.
export async function latestRowFor(categories: CategoryId[]): Promise<{ row: MessageRow, cls: Classified } | null> {
  const channels = channelsFor(categories)
  if (!channels.length) return null
  const rows = await db.select().from(messages).where(inArray(messages.channelId, channels))
    .orderBy(desc(messages.tsRaw)).limit(60)
  for (const raw of rows) {
    const row = decryptRow(raw, raw.msgId)
    const cls = await classify(row)
    if (cls && categories.includes(cls.feed)) return { row, cls }
  }
  return null
}

export async function sendTestPost(rest: REST, channelId: string, categories: CategoryId[]) {
  const hit = await latestRowFor(categories)
  if (!hit) throw new Error('No items in the selected categories yet.')
  const payload = buildPost(hit.row, hit.cls, await extrasFor(hit.row, hit.cls))
  await rest.post(Routes.channelMessages(channelId), {
    body: { ...payload, content: '-# Test post from SC Feed: new items will look like this.', allowed_mentions: { parse: [] } },
  })
}
