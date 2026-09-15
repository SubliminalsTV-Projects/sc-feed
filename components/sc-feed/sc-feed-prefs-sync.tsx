'use client'

// Account sync for everything SC Feed keeps in localStorage — layout, presets, theme, sound,
// custom feeds, read state. Signed-in only; anonymous visitors never touch the network here.
//
// The app keeps reading and writing localStorage exactly as before. This layer sits around it:
//  - pull: when a signed-in session resolves (and when the tab comes back into view), fetch the
//    account copy. If another device saved since this browser last synced, write that copy into
//    localStorage and remount the app so every component re-reads its settings. No page reload,
//    and usually before the feed has even loaded.
//  - push: every PUSH_MS, if the synced keys changed, upload them. Also on tab hide.
// Last write wins, per device.

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useSession } from 'next-auth/react'
import { NOTIF_READ_KEY } from './sc-feed-types'

const SYNCED_AT_KEY = 'sc-feed-prefs-synced-at' // server `updated` this browser last matched
const ACCOUNT_KEY = 'sc-feed-prefs-account'     // the account that timestamp belongs to
const PUSH_MS = 2000

// Every sc-feed-* key syncs (so a new setting syncs without touching this file) except the ones
// that describe this device rather than the person.
const DEVICE_ONLY = new Set([
  'sc-feed-last-seen',            // drives "new since your last visit on THIS device"
  'sc-feed-install-dismissed',    // PWA install prompt
  'sc-feed-cookie-acknowledged',  // consent is per browser
  SYNCED_AT_KEY,
  ACCOUNT_KEY,
])
const isSynced = (k: string) => (k.startsWith('sc-feed-') || k === NOTIF_READ_KEY) && !DEVICE_ONLY.has(k)

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && isSynced(k)) out[k] = localStorage.getItem(k) ?? ''
    }
  } catch { /* storage blocked */ }
  return out
}

function applySnapshot(prefs: Record<string, string>) {
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && isSynced(k) && !(k in prefs)) stale.push(k)
    }
    stale.forEach(k => localStorage.removeItem(k))
    for (const [k, v] of Object.entries(prefs)) if (isSynced(k)) localStorage.setItem(k, v)
  } catch { /* storage blocked */ }
}

// Stable string for "did anything change" checks — key order in localStorage isn't guaranteed.
const fingerprint = (p: Record<string, string>) => JSON.stringify(Object.keys(p).sort().map(k => [k, p[k]]))

export function PrefsSync({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
  const email = status === 'authenticated' ? session?.user?.email?.toLowerCase() ?? null : null
  const [epoch, setEpoch] = useState(0)
  // Fingerprint of what the server holds as far as this browser knows; null = not synced yet
  // this session, so nothing is pushed until the first pull has settled who wins.
  const lastSynced = useRef<string | null>(null)

  const push = useCallback(async (keepalive = false) => {
    if (!email || lastSynced.current === null) return
    const prefs = snapshot()
    const fp = fingerprint(prefs)
    if (fp === lastSynced.current) return
    lastSynced.current = fp
    try {
      const r = await fetch('/api/sc-feed/prefs', {
        method: 'PUT', keepalive,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefs }),
      })
      if (!r.ok) throw new Error(String(r.status))
      const { updated } = await r.json() as { updated: string }
      localStorage.setItem(SYNCED_AT_KEY, updated)
      localStorage.setItem(ACCOUNT_KEY, email)
    } catch {
      lastSynced.current = null // retry after the next pull
    }
  }, [email])

  const pull = useCallback(async () => {
    if (!email) return
    try {
      const r = await fetch('/api/sc-feed/prefs', { cache: 'no-store' })
      if (!r.ok) return
      const remote = await r.json() as { prefs: Record<string, string> | null; updated: string | null }
      const sameAccount = localStorage.getItem(ACCOUNT_KEY) === email
      const syncedAt = sameAccount ? Date.parse(localStorage.getItem(SYNCED_AT_KEY) ?? '') || 0 : 0
      const local = snapshot()

      // The account copy wins when this browser hasn't seen it yet: a new device, a different
      // account, or another device saved since. Otherwise this browser's copy is current and any
      // local changes get pushed.
      if (remote.prefs && remote.updated && Date.parse(remote.updated) > syncedAt) {
        localStorage.setItem(SYNCED_AT_KEY, remote.updated)
        localStorage.setItem(ACCOUNT_KEY, email)
        lastSynced.current = fingerprint(remote.prefs)
        if (fingerprint(remote.prefs) !== fingerprint(local)) {
          applySnapshot(remote.prefs)
          setEpoch(e => e + 1)
        }
        return
      }
      lastSynced.current = remote.prefs ? fingerprint(remote.prefs) : ''
      await push()
    } catch { /* offline — try again next time the tab is shown */ }
  }, [email, push])

  useEffect(() => {
    if (!email) { lastSynced.current = null; return }
    pull()
    const timer = setInterval(() => push(), PUSH_MS)
    const onVis = () => { if (document.visibilityState === 'visible') pull(); else push(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
  }, [email, pull, push])

  return <Fragment key={epoch}>{children}</Fragment>
}
