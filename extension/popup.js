const api = globalThis.browser ?? globalThis.chrome
const $ = id => document.getElementById(id)

function renderStatus(s) {
  const el = $('status')
  if (!s) { el.className = 'muted'; el.textContent = 'No sync yet.'; return }
  const when = s.at ? new Date(s.at).toLocaleString() : ''
  el.className = s.ok ? 'ok' : 'err'
  el.textContent = `${s.ok ? '✓' : '✗'} ${s.msg}${when ? ` · ${when}` : ''}`
}

async function load() {
  const c = await api.storage.local.get(['endpoint', 'secret', 'lastStatus'])
  $('endpoint').value = c.endpoint || ''
  $('secret').value = c.secret || ''
  renderStatus(c.lastStatus)
}

$('save').addEventListener('click', async () => {
  await api.storage.local.set({ endpoint: $('endpoint').value.trim(), secret: $('secret').value.trim() })
  const el = $('status'); el.className = 'muted'; el.textContent = 'Saved.'
})

$('push').addEventListener('click', async () => {
  await api.storage.local.set({ endpoint: $('endpoint').value.trim(), secret: $('secret').value.trim() })
  $('status').textContent = 'Pushing…'
  await api.runtime.sendMessage({ type: 'push-now' }).catch(() => {})
  setTimeout(load, 600)
})

load()
