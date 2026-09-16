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

// Last active MOTD scan — one line per lobby, so a lobby that stopped rendering is visible here
// rather than only showing up as a stale row on the owner dashboard days later.
function renderMotdScan(scan) {
  const el = $('motd')
  if (!scan) { el.textContent = 'MOTD scan: never run'; return }
  if (scan.skipped) { el.textContent = `MOTD scan ${timeAgo(scan.at)} ago — skipped (${scan.skipped})`; return }
  const parts = (scan.results || []).map(r => `${r.channelId.replace('motd-', '')} ${r.ok ? (r.changed ? '✓ new' : '✓') : `✗ ${r.msg || ''}`}`)
  el.textContent = `MOTD scan ${timeAgo(scan.at)} ago — ${parts.join(' · ') || 'no lobbies'}`
}

async function load() {
  const c = await api.storage.local.get(['endpoint', 'secret', 'feedUrl', 'notify', 'latestItems', 'lastStatus', 'lastMotdScan'])
  $('feedUrl').value = c.feedUrl || ''
  $('endpoint').value = c.endpoint || ''
  $('secret').value = c.secret || ''
  $('notify').checked = c.notify !== false
  renderToken(c.lastStatus)
  renderMotdScan(c.lastMotdScan)
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

$('scan').addEventListener('click', async () => {
  $('msg').textContent = 'Scanning lobbies… (up to ~40s)'
  await api.runtime.sendMessage({ type: 'scan-motd-now' }).catch(() => {})
  const { lastMotdScan } = await api.storage.local.get(['lastMotdScan'])
  renderMotdScan(lastMotdScan)
  $('msg').textContent = 'Scan done.'
})

// Renders the discriminator plainly: cookie visibility per store, then whether this extension can
// see any RSI tab at all. Zero tabs while RSI is open elsewhere = wrong Chrome profile.
$('diag').addEventListener('click', async () => {
  $('msg').textContent = 'Diagnosing…'
  const res = await api.runtime.sendMessage({ type: 'diagnose' }).catch(() => null)
  const d = res?.diag || (await api.storage.local.get(['lastDiag'])).lastDiag
  const el = $('diagout')
  if (!d) { $('msg').textContent = 'Diagnose failed.'; return }
  const lines = []
  for (const s of d.stores) {
    lines.push(`store ${s.id}: ${s.count} cookies, ${s.httpOnly} httpOnly`)
    lines.push(`  ${s.names.join(', ') || '(none)'}`)
  }
  lines.push(`RSI tabs visible: ${d.tabs.length}`)
  for (const t of d.tabs) lines.push(`  ${t.title || '(no title)'}`)
  el.textContent = lines.join('\n')
  el.style.display = 'block'
  $('msg').textContent = 'Diagnose done — copy the box above.'
})

$('open').addEventListener('click', () => api.tabs.create({ url: feedUrl() }))

$('capture').addEventListener('click', () => {
  // A clean 16:9 window for stream capture (browser source / window capture).
  api.windows.create({ url: feedUrl(), type: 'popup', width: 1280, height: 720 })
})

load()
