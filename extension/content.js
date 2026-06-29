// SC Feed Companion — Spectrum MOTD scraper (content script)
//
// RSI made the getMotd API moderator-only, so neither our server nor even a logged-in Evocati
// member can fetch the MOTD programmatically. But it IS rendered in the lobby page. This script
// reads it off the DOM whenever a testing-chat lobby is open and hands it to the background,
// which de-dupes and pushes it to SC Feed. Works on a natural visit OR a pinned lobby tab.
const api = globalThis.browser ?? globalThis.chrome

// Spectrum lobby id (from the URL) → SC Feed channel id. Mirrors SPECTRUM_MOTDS on the backend.
const LOBBY_CHANNEL = { '38230': 'motd-sc', '1355241': 'motd-evo' }

function channelForUrl() {
  const m = location.pathname.match(/\/lobby\/(\d+)/)
  return m ? LOBBY_CHANNEL[m[1]] : null
}

// Pull the MOTD body (and any link) out of the rendered banner, dropping the "Message of the
// day" header + relative timestamp so only the actual content is sent.
function extractMotd(root) {
  const wrap = root.querySelector('.lobby-message__wrapper') || root
  const clone = wrap.cloneNode(true)
  clone.querySelector('.lobby-message__header')?.remove()
  clone.querySelector('.lobby-message__dismiss')?.remove()
  const body = (clone.innerText || '').trim()
  const link = wrap.querySelector('a[href]')
  return { body, url: link ? link.href : '' }
}

let lastBody = ''
function scan() {
  const channelId = channelForUrl()
  if (!channelId) return
  const el = document.querySelector('.lobby-message--motd')
  if (!el) return
  const { body, url } = extractMotd(el)
  if (!body || body === lastBody) return
  lastBody = body
  try { api.runtime.sendMessage({ type: 'motd', channelId, body, url }) } catch { /* bg asleep */ }
}

// Spectrum is an SPA and the MOTD renders async — observe the DOM and debounce.
let t = null
new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 1200) }).observe(
  document.documentElement, { childList: true, subtree: true },
)
setTimeout(scan, 1500)
