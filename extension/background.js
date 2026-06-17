// SC Feed companion (owner tool, Chrome + Firefox/Zen)
//
// 1. RSI token sync — reads the HttpOnly `Rsi-Token` cookie from robertsspaceindustries.com
//    and pushes it to SC Feed's owner endpoint when it changes (kills the manual DevTools
//    copy-paste; Reddit/Spectrum/MOTD stay fresh).
// 2. Feed awareness — polls /api/sc-feed, shows the unread count on the toolbar badge, and
//    fires a desktop notification when new items land (even with SC Feed closed).
//
// Cross-browser, no build step: Firefox exposes promise-based `browser.*`, Chrome MV3 the
// same on `chrome.*` for the APIs used here (cookies, storage, alarms, notifications, etc.).
const api = globalThis.browser ?? globalThis.chrome

const RSI_URL = 'https://robertsspaceindustries.com'
const COOKIE = 'Rsi-Token'
const DEFAULT_ENDPOINT = 'https://sc-feed.subliminal.gg/api/owner/rsi-token'
const DEFAULT_FEED = 'https://sc-feed.subliminal.gg'
const TOKEN_ALARM = 'rsi-token-resync'
const FEED_ALARM = 'feed-poll'
let debounce = null

async function getConfig() {
  const c = await api.storage.local.get(['endpoint', 'secret', 'feedUrl', 'notify'])
  return {
    endpoint: c.endpoint || DEFAULT_ENDPOINT,
    secret: c.secret || '',
    feedUrl: (c.feedUrl || DEFAULT_FEED).replace(/\/$/, ''),
    notify: c.notify !== false,
  }
}

// ---------- RSI token sync ----------

async function readCookie() {
  const c = await api.cookies.get({ url: RSI_URL, name: COOKIE })
  return c?.value || ''
}

async function pushToken(reason) {
  const token = await readCookie()
  const stamp = at => ({ at, reason })
  if (!token) { await api.storage.local.set({ lastStatus: { ok: false, msg: 'no Rsi-Token cookie (log into RSI?)', ...stamp(now()) } }); return }
  const { endpoint, secret } = await getConfig()
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
    await api.storage.local.set({ lastStatus: { ok: res.ok, msg: res.ok ? 'token synced' : `endpoint ${res.status}`, ...stamp(now()) } })
  } catch (e) {
    await api.storage.local.set({ lastStatus: { ok: false, msg: String(e), ...stamp(now()) } })
  }
}

// ---------- feed awareness (badge + notifications + popup data) ----------

function now() { return new Date().toISOString() }

async function pollFeed(reason) {
  const { feedUrl, notify } = await getConfig()
  let channels
  try {
    const res = await fetch(`${feedUrl}/api/sc-feed`, { cache: 'no-store' })
    if (!res.ok) return
    channels = await res.json()
  } catch { return }

  // Flatten every channel's messages, newest first.
  const items = []
  for (const ch of channels || []) {
    for (const m of ch.messages || []) {
      items.push({ title: m.title || '(untitled)', source: m.source || ch.label || '', url: m.url || '', ts: m.ts_raw || m.timestamp || '' })
    }
  }
  items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
  const latest = items.slice(0, 20)

  const store = await api.storage.local.get(['lastSeenTs'])
  // First run: seed lastSeenTs to newest so we don't notify the whole backlog.
  const lastSeenTs = store.lastSeenTs || latest[0]?.ts || now()
  const unread = items.filter(i => i.ts && i.ts > lastSeenTs)

  await api.storage.local.set({ latestItems: latest, lastSeenTs, feedCheckedAt: now() })
  await setBadge(unread.length)

  if (notify && unread.length > 0 && reason !== 'seed') {
    const top = unread[0]
    api.notifications?.create?.(`scfeed-${Date.now()}`, {
      type: 'basic',
      iconUrl: `${feedUrl}/icons/icon-512.png`,
      title: unread.length === 1 ? top.source || 'SC Feed' : `SC Feed — ${unread.length} new`,
      message: top.title,
    })
  }
}

async function setBadge(count) {
  const text = count > 99 ? '99+' : count > 0 ? String(count) : ''
  try {
    await api.action.setBadgeText({ text })
    await api.action.setBadgeBackgroundColor?.({ color: '#ffb231' })
  } catch { /* badge unsupported */ }
}

// Clear the unread badge by advancing the seen marker to now (popup open / "open feed").
async function markSeen() {
  await api.storage.local.set({ lastSeenTs: now() })
  await setBadge(0)
}

// ---------- listeners ----------

api.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (cookie.name !== COOKIE || removed) return
  if (!/(^|\.)robertsspaceindustries\.com$/.test(cookie.domain)) return
  clearTimeout(debounce)
  debounce = setTimeout(() => pushToken('cookie-changed'), 1500)
})

api.alarms.create(TOKEN_ALARM, { periodInMinutes: 360 })
api.alarms.create(FEED_ALARM, { periodInMinutes: 5 })
api.alarms.onAlarm.addListener(a => {
  if (a.name === TOKEN_ALARM) pushToken('alarm')
  if (a.name === FEED_ALARM) pollFeed('alarm')
})

api.notifications?.onClicked?.addListener(async () => {
  const { feedUrl } = await getConfig()
  api.tabs.create({ url: feedUrl })
})

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'push-now') { pushToken('manual').then(() => sendResponse({ done: true })); return true }
  if (msg?.type === 'poll-now') { pollFeed('manual').then(() => sendResponse({ done: true })); return true }
  if (msg?.type === 'mark-seen') { markSeen().then(() => sendResponse({ done: true })); return true }
})

// Prime on install/startup so the badge + popup have data immediately.
api.runtime.onInstalled?.addListener?.(() => pollFeed('seed'))
api.runtime.onStartup?.addListener?.(() => pollFeed('seed'))
