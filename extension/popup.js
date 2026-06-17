const api = globalThis.browser ?? globalThis.chrome
const $ = id => document.getElementById(id)
const DEFAULT_FEED = 'https://sc-feed.subliminal.gg'

function feedUrl() { return ($('feedUrl').value.trim() || DEFAULT_FEED).replace(/\/$/, '') }

function timeAgo(ts) {
  if (!ts) return ''
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function renderToken(st) {
  const el = $('tok')
  if (!st) { el.innerHTML = '<span class="dot idle"></span>token: unknown'; return }
  el.innerHTML = `<span class="dot ${st.ok ? 'ok' : 'err'}"></span>${st.msg}`
}

function renderFeed(items) {
  const f = $('feed')
  if (!items || !items.length) { f.innerHTML = '<div class="empty">No items yet.</div>'; return }
  f.innerHTML = ''
  for (const it of items) {
    const a = document.createElement('a')
    a.className = 'item'
    a.href = it.url || feedUrl()
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    const t = document.createElement('div'); t.className = 't'; t.textContent = it.title
    const m = document.createElement('div'); m.className = 'm'; m.textContent = `${it.source}${it.ts ? ' · ' + timeAgo(it.ts) : ''}`
    a.append(t, m)
    f.appendChild(a)
  }
}

async function load() {
  const c = await api.storage.local.get(['endpoint', 'secret', 'feedUrl', 'notify', 'latestItems', 'lastStatus'])
  $('feedUrl').value = c.feedUrl || ''
  $('endpoint').value = c.endpoint || ''
  $('secret').value = c.secret || ''
  $('notify').checked = c.notify !== false
  renderToken(c.lastStatus)
  renderFeed(c.latestItems)
  // Opening the popup counts as "seen" — clear the badge — and refresh in the background.
  api.runtime.sendMessage({ type: 'mark-seen' }).catch(() => {})
  api.runtime.sendMessage({ type: 'poll-now' }).catch(() => {})
}

$('save').addEventListener('click', async () => {
  await api.storage.local.set({
    feedUrl: $('feedUrl').value.trim(),
    endpoint: $('endpoint').value.trim(),
    secret: $('secret').value.trim(),
    notify: $('notify').checked,
  })
  $('msg').textContent = 'Saved.'
})

$('push').addEventListener('click', async () => {
  await api.storage.local.set({ endpoint: $('endpoint').value.trim(), secret: $('secret').value.trim() })
  $('msg').textContent = 'Pushing token…'
  await api.runtime.sendMessage({ type: 'push-now' }).catch(() => {})
  const { lastStatus } = await api.storage.local.get(['lastStatus'])
  renderToken(lastStatus)
  $('msg').textContent = lastStatus?.ok ? 'Token synced.' : `Failed: ${lastStatus?.msg ?? '?'}`
})

$('open').addEventListener('click', () => api.tabs.create({ url: feedUrl() }))

$('capture').addEventListener('click', () => {
  // A clean 16:9 window for stream capture (browser source / window capture).
  api.windows.create({ url: feedUrl(), type: 'popup', width: 1280, height: 720 })
})

load()
