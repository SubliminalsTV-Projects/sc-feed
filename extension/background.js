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

const IDENTIFY_URL = 'https://robertsspaceindustries.com/api/spectrum/auth/identify'

// Is this Rsi-Token authenticated as a logged-in member? RSI sets an Rsi-Token cookie even when
// logged OUT, and an anonymous token passes public forum reads but is DENIED MOTD on every lobby.
// So we must push an AUTHENTICATED token, not just the first Rsi-Token we find.
// Returns: true (logged in) / false (positively anonymous) / null (couldn't tell — network error).
async function isAuthed(token) {
  try {
    const res = await fetch(IDENTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Rsi-Token': token },
      body: '{}',
    })
    const d = await res.json().catch(() => null)
    if (!d || !d.success) return null
    return !!(d.data && d.data.member && d.data.member.id)
  } catch { return null }
}

// Search EVERY cookie store (Zen/Firefox containers + workspaces each have their own store,
// and the RSI login often lives in one of those, not the default). Match the name
// case-insensitively. Among all Rsi-Token candidates, PREFER the one that's actually logged in.
// Stash what we saw so a miss can report a useful diagnostic.
let lastScan = { stores: 0, names: [], candidates: 0, anonymous: 0 }
async function readCookie() {
  let stores = [{ id: undefined }]
  try { const s = await api.cookies.getAllCookieStores(); if (s && s.length) stores = s } catch { /* fall back to default */ }
  const names = new Set()
  const candidates = new Set()
  for (const st of stores) {
    const opts = { domain: 'robertsspaceindustries.com' }
    if (st.id) opts.storeId = st.id
    let cs = []
    try { cs = await api.cookies.getAll(opts) } catch { /* store unreadable */ }
    for (const c of cs) {
      names.add(c.name)
      if (c.name.toLowerCase() === COOKIE.toLowerCase() && c.value) candidates.add(c.value)
    }
  }

  let anonymous = 0, unknown = 0, firstSeen = ''
  for (const v of candidates) {
    if (!firstSeen) firstSeen = v
    const authed = await isAuthed(v)
    if (authed === true) {
      lastScan = { stores: stores.length, names: [...names], candidates: candidates.size, anonymous }
      return { value: v, authed: true }
    }
    if (authed === false) anonymous++; else unknown++
  }
  lastScan = { stores: stores.length, names: [...names], candidates: candidates.size, anonymous }

  // No authenticated token. If `identify` was unreachable for a candidate (unknown), don't
  // suppress it — push the first one (old behavior) rather than block a possibly-good token
  // during an RSI hiccup. Only refuse when every candidate is POSITIVELY anonymous.
  if (unknown > 0 && firstSeen) return { value: firstSeen, authed: null }
  return { value: '', authed: false, sawAnonymous: anonymous > 0 }
}

async function pushToken(reason) {
  const r = await readCookie()
  const token = r.value
  const stamp = at => ({ at, reason })
  if (!token) {
    let msg
    if (r.sawAnonymous) msg = `Rsi-Token is logged OUT (anonymous) — sign into RSI on your Evocati account, then retry`
    else if (lastScan.names.length) msg = `Rsi-Token not found — saw: ${lastScan.names.slice(0, 8).join(', ')}`
    else msg = `no RSI cookies visible across ${lastScan.stores} store(s) — grant host access + log into RSI`
    await api.storage.local.set({ lastStatus: { ok: false, msg, ...stamp(now()) } })
    return
  }
  const { endpoint, secret } = await getConfig()
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
    const okMsg = r.authed === true ? 'token synced (authenticated)' : 'token synced (unverified)'
    await api.storage.local.set({ lastStatus: { ok: res.ok, msg: res.ok ? okMsg : `endpoint ${res.status}`, ...stamp(now()) } })
  } catch (e) {
    await api.storage.local.set({ lastStatus: { ok: false, msg: String(e), ...stamp(now()) } })
  }
}

// ---------- "Send to SC Feed" (right-click → save) ----------

const SAVE_MENU_ID = 'scfeed-save'

// Fires on link, page, and selection contexts. Recreate (removeAll first) on install/startup
// so re-installs don't throw "duplicate id".
function setupContextMenus() {
  if (!api.contextMenus) return
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: SAVE_MENU_ID,
      title: 'Send to SC Feed',
      contexts: ['page', 'link', 'selection'],
    })
  })
}

async function saveToFeed(info, tab) {
  const { feedUrl, secret, notify } = await getConfig()
  // Link context → save the link target; otherwise the page. Title prefers a text selection,
  // then the page title, falling back to the URL (the backend also defaults title→url).
  const url = info.linkUrl || info.pageUrl || tab?.url || ''
  let title = (info.selectionText || tab?.title || '').trim().slice(0, 300)
  if (!url) return
  if (!title) title = url
  try {
    const res = await fetch(`${feedUrl}/api/sc-feed/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ url, title }),
    })
    await api.storage.local.set({ lastSave: { ok: res.ok, msg: res.ok ? 'saved' : `endpoint ${res.status}`, at: now(), title } })
    if (notify) api.notifications?.create?.(`scfeed-save-${Date.now()}`, {
      type: 'basic',
      iconUrl: `${feedUrl}/icons/icon-512.png`,
      title: res.ok ? 'Saved to SC Feed' : `Save failed (${res.status})`,
      message: title,
    })
  } catch (e) {
    await api.storage.local.set({ lastSave: { ok: false, msg: String(e), at: now(), title } })
    if (notify) api.notifications?.create?.(`scfeed-save-${Date.now()}`, {
      type: 'basic', iconUrl: `${feedUrl}/icons/icon-512.png`, title: 'Save failed', message: String(e),
    })
  }
}

api.contextMenus?.onClicked.addListener((info, tab) => {
  if (info.menuItemId === SAVE_MENU_ID) saveToFeed(info, tab)
})

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

// Prime on install/startup so the badge + popup have data immediately, and (re)create the
// right-click "Send to SC Feed" menu.
api.runtime.onInstalled?.addListener?.(() => { pollFeed('seed'); setupContextMenus() })
api.runtime.onStartup?.addListener?.(() => { pollFeed('seed'); setupContextMenus() })
