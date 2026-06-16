// SC Feed — RSI Token Sync (owner tool, Chrome + Firefox/Zen)
//
// Reads the `Rsi-Token` session cookie from robertsspaceindustries.com (the extension can
// read it even though it's HttpOnly — that's the whole point vs. a page script) and pushes
// it to SC Feed's owner endpoint whenever it changes. Kills the manual DevTools copy-paste.
//
// Cross-browser without a build step: Firefox exposes promise-based `browser.*`, Chrome MV3
// exposes promise-based `chrome.*` for the APIs we use (cookies, storage, alarms, runtime).
const api = globalThis.browser ?? globalThis.chrome

const RSI_URL = 'https://robertsspaceindustries.com'
const COOKIE = 'Rsi-Token'
const DEFAULT_ENDPOINT = 'https://sc-feed.subliminal.gg/api/owner/rsi-token'
const ALARM = 'rsi-token-resync'
let debounce = null

async function getConfig() {
  const c = await api.storage.local.get(['endpoint', 'secret'])
  return { endpoint: c.endpoint || DEFAULT_ENDPOINT, secret: c.secret || '' }
}

async function setStatus(status) {
  await api.storage.local.set({ lastStatus: { ...status, at: new Date().toISOString() } })
}

async function readCookie() {
  const c = await api.cookies.get({ url: RSI_URL, name: COOKIE })
  return c?.value || ''
}

async function pushToken(reason) {
  const token = await readCookie()
  if (!token) { await setStatus({ ok: false, reason, msg: 'no Rsi-Token cookie (log into RSI?)' }); return }
  const { endpoint, secret } = await getConfig()
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      // credentials:'include' rides an owner NextAuth session if you're signed into SC Feed;
      // the bearer secret is the headless/logged-out fallback. Either authorizes the push.
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
    if (res.ok) await setStatus({ ok: true, reason, msg: 'token synced' })
    else await setStatus({ ok: false, reason, msg: `endpoint ${res.status}` })
  } catch (e) {
    await setStatus({ ok: false, reason, msg: String(e) })
  }
}

// React to the cookie changing (login / refresh / rotation), debounced so a burst of
// Set-Cookie events collapses into one push.
api.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (cookie.name !== COOKIE || removed) return
  if (!/(^|\.)robertsspaceindustries\.com$/.test(cookie.domain)) return
  clearTimeout(debounce)
  debounce = setTimeout(() => pushToken('cookie-changed'), 1500)
})

// Safety-net re-push (catches anything onChanged missed, e.g. browser asleep at rotation).
api.alarms.create(ALARM, { periodInMinutes: 360 })
api.alarms.onAlarm.addListener(a => { if (a.name === ALARM) pushToken('alarm') })

// Manual "Push now" from the popup.
api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'push-now') { pushToken('manual').then(() => sendResponse({ done: true })); return true }
})
