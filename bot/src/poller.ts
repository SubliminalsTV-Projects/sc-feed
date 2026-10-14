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
import { deliveries, state, subscriptions } from './schema'
import { SOURCES, type CategoryId, type Source } from './sources'
import { buildPost, type KbInfo, type MessageRow } from './embed'

const POLL_MS = 60_000
const FRESH_MS = 12 * 60 * 60 * 1000
const DEDUPE_WINDOW = dsql`now() - interval '48 hours'`
const DELIVERY_RETENTION = dsql`now() - interval '45 days'`
const MAX_PERMANENT_ERRORS = 3
const SEND_CONCURRENCY = 10
const KB_ARTICLE_RE = /support\.robertsspaceindustries\.com\/hc\/[^/]+\/articles\/\d+/
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
    return (url.host.replace(/^www\./, '') + url.pathname.replace(/\/+$/, '') + url.search).toLowerCase()
  } catch { return u.toLowerCase() }
}

export function dedupeKey(row: MessageRow, source: Source, kb: KbInfo | null): string {
  if (kb) return `kb:${kb.articleId}:${kb.stateSig}`
  // MOTD cards link to the patch-notes thread, so their URL would collide with the notes.
  if (source.category === 'motd') return `title:${normTitle(row.title)}`
  // Several dev replies share one Spectrum thread URL — each reply is its own item.
  if (source.category === 'dev' && SPECTRUM_THREAD_RE.test(row.url)) return `msg:${row.msgId}`
  if (/^https?:\/\//i.test(row.url)) return `url:${normUrl(row.url)}`
  return `title:${normTitle(row.title)}`
}

async function kbInfoFor(row: MessageRow, source: Source): Promise<KbInfo | null> {
  if (source.category !== 'dev' || !KB_ARTICLE_RE.test(row.url)) return null
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

// The category's own role if set ('' = muted), else the channel's default role.
export function pingRole(sub: Pick<Subscription, 'roleId' | 'categoryRoles'>, category: CategoryId): string | null {
  const own = sub.categoryRoles[category]
  return (own !== undefined ? own : sub.roleId) || null
}

function roleMention(sub: Subscription, category: CategoryId) {
  const role = pingRole(sub, category)
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

async function deliver(rest: REST, row: MessageRow, allowlist: string[]): Promise<'stale' | void> {
  const source = SOURCES[row.channelId]
  if (!source) return
  if (Date.now() - row.tsRaw.getTime() > FRESH_MS) return 'stale'

  const kb = await kbInfoFor(row, source)
  const key = dedupeKey(row, source, kb)
  const conds = [eq(subscriptions.paused, false), arrayContains(subscriptions.categories, [source.category])]
  if (allowlist.length) conds.push(inArray(subscriptions.guildId, allowlist))
  const subs = await db.select().from(subscriptions).where(and(...conds))
  if (!subs.length) return

  const alreadyHave = new Set((await db.select({ id: deliveries.subscriptionId }).from(deliveries)
    .where(and(eq(deliveries.dedupeKey, key), gt(deliveries.created, DEDUPE_WINDOW),
      inArray(deliveries.subscriptionId, subs.map(s => s.id))))).map(r => r.id))

  const payload = buildPost(row, source, kb)
  let sent = 0
  await pool(subs.filter(s => !alreadyHave.has(s.id)), SEND_CONCURRENCY, async sub => {
    const claim = await db.insert(deliveries)
      .values({ subscriptionId: sub.id, msgId: row.msgId, dedupeKey: key })
      .onConflictDoNothing().returning({ id: deliveries.id })
    if (!claim.length) return
    try {
      const res = await rest.post(Routes.channelMessages(sub.channelId), { body: { ...payload, ...roleMention(sub, source.category) } }) as { id: string }
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
  log(`${row.channelId}/${row.msgId} "${row.title.slice(0, 60)}" → ${sent}/${subs.length} channels (${alreadyHave.size} already had it)`)
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
      if (await deliver(rest, row, allowlist) === 'stale') stale++
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
export async function latestRowFor(categories: CategoryId[]): Promise<MessageRow | null> {
  const channels = Object.entries(SOURCES).filter(([, s]) => categories.includes(s.category)).map(([id]) => id)
  if (!channels.length) return null
  const r = await db.select().from(messages).where(inArray(messages.channelId, channels))
    .orderBy(desc(messages.tsRaw)).limit(1)
  return r[0] ?? null
}

export async function sendTestPost(rest: REST, channelId: string, categories: CategoryId[]) {
  const row = await latestRowFor(categories)
  if (!row) throw new Error('No items in the selected categories yet.')
  const source = SOURCES[row.channelId]
  const payload = buildPost(row, source, await kbInfoFor(row, source))
  await rest.post(Routes.channelMessages(channelId), {
    body: { ...payload, content: '-# Test post from SC Feed: new items will look like this.', allowed_mentions: { parse: [] } },
  })
}
