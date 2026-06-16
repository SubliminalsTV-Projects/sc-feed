'use client'

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
}

const VAPID_PUBLIC_KEY = 'BFX3WsSy9ryBor2CuqQSz1ZdjuEDmRjE_tzl4J4EELvciVYKMrYh06Kge7Eu6jloPA6AQ6NO5tpENnGYjfxMyGM'

function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4)
  const raw    = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const arr    = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { Download, Loader2, LogIn, LogOut, Menu, RefreshCw, Search, Settings, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { FeedChannel, FeedMessage } from '@/app/api/sc-feed/route'
import {
  COLUMN_WIDTHS, DEFAULT_ENABLED_TRACKER_KEYS, DEFAULT_PRESETS, FeedPrefsContext,
  LEAKS_CHANNEL_ID, MOTD_CHANNEL_IDS, MOTD_UNIFIED_ID, OMNI_FEED_ID, REFRESH_INTERVAL_MS,
  YT_CREATORS_ID, TWITCH_CREATORS_ID, CUSTOM_RSS_ID,
  USER_YT_KEY, USER_TWITCH_KEY, USER_RSS_KEY,
  MAX_YT_CHANNELS, MAX_TWITCH_STREAMERS, MAX_RSS_FEEDS,
  type ColumnHeight, type ColumnWidth, type LayoutPreset,
  type UserYTChannel, type UserTwitchStreamer, type UserRSSFeed,
} from './sc-feed-types'
import { getFeedLabel, timeAgo } from './sc-feed-utils'
import { ChannelFeed, UnifiedMotdFeed, UnifiedOmniFeed } from './sc-feed-channel'
import { SettingsPanel } from './sc-feed-settings'
import { NotificationsFab } from './sc-feed-notifications'
import { CookieBanner } from './sc-feed-cookie-banner'
import { GithubWidget } from './sc-feed-github-widget'
import { PatchNotesModal } from './sc-feed-patch-notes'
import { CURRENT_VERSION, PATCH_NOTES_SEEN_KEY } from '@/lib/patch-notes'

// Stable per-channel wrapper so React.memo on ChannelFeed can skip re-renders when
// only unrelated ScFeedView state (e.g. settingsOpen) changes. Defined at module level
// so React never sees it as a new component type.
const ChannelFeedColumn = memo(function ChannelFeedColumn({
  col, channel, enabledCategories, globalSearch, lastSeen, leaksRevealed, onToggleLeaks, onToggleCategory,
  isReadGlobal, toggleReadGlobal, markChannelRead, clearChannelRead, onSetWidth, onSetHeight,
}: {
  col: { id: string; colWidth: ColumnWidth; colHeight: ColumnHeight }
  channel: FeedChannel
  enabledCategories: Set<string>
  globalSearch: string
  lastSeen: string | null | undefined
  leaksRevealed: boolean
  onToggleLeaks?: () => void
  onToggleCategory: (key: string) => void
  isReadGlobal: (channelId: string, msgId: string, tsRaw?: string | null) => boolean
  toggleReadGlobal: (channelId: string, msgId: string, tsRaw?: string | null) => void
  markChannelRead: (channelId: string) => void
  clearChannelRead: (channelId: string) => void
  onSetWidth: (w: ColumnWidth) => void
  onSetHeight: (h: ColumnHeight) => void
}) {
  const id = channel.id
  const isReadMsg = useCallback(
    (msgId: string, tsRaw?: string | null) => isReadGlobal(id, msgId, tsRaw),
    [isReadGlobal, id]
  )
  const onMarkRead = useCallback(
    (msgId: string, tsRaw?: string | null) => toggleReadGlobal(id, msgId, tsRaw),
    [toggleReadGlobal, id]
  )
  const onMarkAllRead = useCallback(
    () => markChannelRead(id),
    [markChannelRead, id]
  )
  const onClearAllRead = useCallback(
    () => clearChannelRead(id),
    [clearChannelRead, id]
  )
  return (
    <ChannelFeed
      channel={channel}
      isLeaks={col.id === LEAKS_CHANNEL_ID}
      revealed={leaksRevealed}
      lastSeen={lastSeen}
      enabledCategories={enabledCategories}
      globalSearch={globalSearch}
      isReadMsg={isReadMsg}
      onMarkRead={onMarkRead}
      onMarkAllRead={onMarkAllRead}
      onClearAllRead={onClearAllRead}
      onToggleLeaks={onToggleLeaks}
      onToggleCategory={onToggleCategory}
      colWidth={col.colWidth}
      colHeight={col.colHeight}
      onSetWidth={onSetWidth}
      onSetHeight={onSetHeight}
    />
  )
})

export function ScFeedView() {
  const [channels, setChannels] = useState<FeedChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [lastSeen, setLastSeen] = useState<string | null | undefined>(undefined)
  const [enabledCategories, setEnabledCategories] = useState<Set<string>>(() => new Set(DEFAULT_ENABLED_TRACKER_KEYS))
  const [hiddenChannels, setHiddenChannels] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [patchNotesOpen, setPatchNotesOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuRef = useRef<HTMLDivElement | null>(null)
  const { data: session, status: authStatus } = useSession()
  const [leaksRevealed, setLeaksRevealed] = useState(false)
  const [mobileActiveFeed, setMobileActiveFeed] = useState<string | null>(null)

  const [columnWidths, setColumnWidths] = useState<Record<string, ColumnWidth>>({})
  const [columnHeights, setColumnHeights] = useState<Record<string, ColumnHeight>>({})
  const [columnOrder, setColumnOrder] = useState<string[] | null>(null)
  const [showTabBar, setShowTabBar] = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [dateFormat, setDateFormat] = useState<'short' | 'long'>('short')
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark')
  const [hideAllRead, setHideAllRead] = useState(false)
  const [layoutPresets, setLayoutPresets] = useState<LayoutPreset[]>([])
  const [omniSourceToggles, setOmniSourceToggles] = useState<Record<string, boolean>>({})
  const [userYTChannels, setUserYTChannels] = useState<UserYTChannel[]>([])
  const [userTwitchStreamers, setUserTwitchStreamers] = useState<UserTwitchStreamer[]>([])
  const [userRSSFeeds, setUserRSSFeeds] = useState<UserRSSFeed[]>([])
  const userYTRef = useRef<UserYTChannel[]>([])
  const userTwitchRef = useRef<UserTwitchStreamer[]>([])
  const userRSSRef = useRef<UserRSSFeed[]>([])
  const [readCutoff, setReadCutoff] = useState<string | null>(null)
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [unreadOverrides, setUnreadOverrides] = useState<Set<string>>(new Set())
  const readCutoffRef = useRef<string | null>(null)
  const readIdsRef = useRef<Set<string>>(new Set())
  const unreadOverridesRef = useRef<Set<string>>(new Set())

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const colRefs = useRef<Map<string, HTMLElement>>(new Map())
  const channelsRef = useRef<FeedChannel[]>([])
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null)
  const [showInstallBtn, setShowInstallBtn] = useState(false)
  const [pushSupported, setPushSupported] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')
  const [pushPending, setPushPending] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const [pushTestPending, setPushTestPending] = useState(false)
  const [pushTestStatus, setPushTestStatus] = useState<'idle' | 'sent' | 'error'>('idle')

  function toggleTabBar() {
    const next = !showTabBar
    setShowTabBar(next)
    localStorage.setItem('sc-feed-show-tabbar', String(next))
  }

  function setDateFormatPref(f: 'short' | 'long') {
    setDateFormat(f)
    try { localStorage.setItem('sc-feed-date-format', f) } catch { /* ignore */ }
  }

  // Theme toggle. Applies the .light class to <html> so all CSS-var-based
  // utilities re-skin instantly. Plays public/sounds/SolarFlare.mp3 when going
  // dark→light.
  function setThemePref(next: 'dark' | 'light') {
    setThemeState(next)
    if (typeof window === 'undefined') return
    if (next === 'light') {
      document.documentElement.classList.add('light')
      try {
        const audio = new Audio('/sounds/SolarFlare.mp3')
        audio.volume = 0.9
        void audio.play().catch(() => { /* autoplay blocked */ })
      } catch { /* audio is best-effort */ }
    } else {
      document.documentElement.classList.remove('light')
    }
    try { localStorage.setItem('sc-feed-theme', next) } catch { /* ignore */ }
  }

  useEffect(() => { readCutoffRef.current = readCutoff }, [readCutoff])
  useEffect(() => { readIdsRef.current = readIds }, [readIds])
  useEffect(() => { unreadOverridesRef.current = unreadOverrides }, [unreadOverrides])

  const isReadGlobal = useCallback((channelId: string, msgId: string, tsRaw?: string | null): boolean => {
    const key = `${channelId}-${msgId}`
    if (unreadOverrides.has(key)) return false
    if (readIds.has(key)) return true
    if (readCutoff && tsRaw && tsRaw <= readCutoff) return true
    return false
  }, [readIds, readCutoff, unreadOverrides])

  const toggleReadGlobal = useCallback((channelId: string, msgId: string, tsRaw?: string | null) => {
    const key = `${channelId}-${msgId}`
    const cur = unreadOverridesRef.current
    const ids = readIdsRef.current
    const cutoff = readCutoffRef.current
    const isRead = cur.has(key) ? false : ids.has(key) ? true : (cutoff && tsRaw && tsRaw <= cutoff) ? true : false
    if (isRead) {
      setReadIds(prev => { const n = new Set(prev); n.delete(key); try { localStorage.setItem('sc-feed-read-ids', JSON.stringify([...n])) } catch {} return n })
      setUnreadOverrides(prev => { const n = new Set(prev); n.add(key); try { localStorage.setItem('sc-feed-unread-overrides', JSON.stringify([...n])) } catch {} return n })
    } else {
      setUnreadOverrides(prev => { const n = new Set(prev); n.delete(key); try { localStorage.setItem('sc-feed-unread-overrides', JSON.stringify([...n])) } catch {} return n })
      setReadIds(prev => { const n = new Set(prev); n.add(key); try { localStorage.setItem('sc-feed-read-ids', JSON.stringify([...n])) } catch {} return n })
    }
  }, [])

  const markAllReadGlobal = useCallback(() => {
    const now = new Date().toISOString()
    setReadCutoff(now)
    setReadIds(new Set())
    setUnreadOverrides(new Set())
    try {
      localStorage.setItem('sc-feed-read-cutoff', now)
      localStorage.removeItem('sc-feed-read-ids')
      localStorage.removeItem('sc-feed-unread-overrides')
    } catch { }
  }, [])

  const clearAllReadGlobal = useCallback(() => {
    setReadCutoff(null)
    setReadIds(new Set())
    setUnreadOverrides(new Set())
    try {
      localStorage.removeItem('sc-feed-read-cutoff')
      localStorage.removeItem('sc-feed-read-ids')
      localStorage.removeItem('sc-feed-unread-overrides')
    } catch { }
  }, [])

  // Per-feed "mark all read" — only marks messages in the given channel as read.
  // Adds explicit readIds entries; clears any matching unreadOverrides. Does NOT touch
  // the global cutoff, so other channels' read state is preserved.
  const markChannelRead = useCallback((channelId: string) => {
    const messages = channelsRef.current.find(c => c.id === channelId)?.messages ?? []
    if (messages.length === 0) return
    setReadIds(prev => {
      const n = new Set(prev)
      for (const msg of messages) n.add(`${channelId}-${msg.id}`)
      try { localStorage.setItem('sc-feed-read-ids', JSON.stringify([...n])) } catch {}
      return n
    })
    setUnreadOverrides(prev => {
      const filtered = [...prev].filter(k => !k.startsWith(`${channelId}-`))
      if (filtered.length === prev.size) return prev
      const n = new Set(filtered)
      try { localStorage.setItem('sc-feed-unread-overrides', JSON.stringify([...n])) } catch {}
      return n
    })
  }, [])

  // Per-feed "mark all unread" — only clears read state for the given channel's messages.
  // Removes readIds entries for that channel; adds unreadOverrides for anything read via the
  // global cutoff so those messages surface as unread without wiping other channels.
  const clearChannelRead = useCallback((channelId: string) => {
    setReadIds(prev => {
      const n = new Set([...prev].filter(k => !k.startsWith(`${channelId}-`)))
      try { localStorage.setItem('sc-feed-read-ids', JSON.stringify([...n])) } catch {}
      return n
    })
    const cutoff = readCutoffRef.current
    if (cutoff) {
      const messages = channelsRef.current.find(c => c.id === channelId)?.messages ?? []
      setUnreadOverrides(prev => {
        const n = new Set(prev)
        for (const msg of messages) {
          if (msg.ts_raw && msg.ts_raw <= cutoff) n.add(`${channelId}-${msg.id}`)
        }
        try { localStorage.setItem('sc-feed-unread-overrides', JSON.stringify([...n])) } catch {}
        return n
      })
    }
  }, [])

  const handleTogglePush = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    setPushPending(true)
    setPushError(null)

    if (pushEnabled) {
      try {
        // Sweep all registrations — subscription may live on a prior one
        const regs = await navigator.serviceWorker.getRegistrations()
        const pairs = await Promise.all(regs.map(async r => ({ r, sub: await r.pushManager.getSubscription() })))
        for (const { sub } of pairs) {
          if (!sub) continue
          await fetch('/api/sc-feed/push-subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
          await sub.unsubscribe()
        }
        setPushEnabled(false)
      } catch (err) {
        console.warn('[push] unsubscribe failed', err)
        setPushError('Failed to disable. Try again.')
      } finally { setPushPending(false) }
      return
    }

    try {
      const t0 = Date.now()
      const permission = await Notification.requestPermission()
      const elapsed = Date.now() - t0
      setPushPermission(permission)

      if (permission === 'denied') {
        setPushError('Blocked — enable notifications in browser/OS settings.')
        return
      }
      if (permission !== 'granted') {
        // Resolved almost instantly = Chrome PWA quiet chip had nowhere to render
        setPushError(
          elapsed < 800
            ? 'No prompt appeared. Open site settings (🔒 in address bar or OS notification settings) and allow notifications.'
            : 'Permission not granted.'
        )
        return
      }

      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Service worker not ready (timeout)')), 10000)),
      ])
      const sub = await Promise.race([
        reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Push subscribe timed out — browser could not reach the push service')), 20000)),
      ])
      // Browser subscription is the source of truth — mark enabled immediately.
      // The API save below syncs to PB so the server can deliver pushes; its
      // failure is non-fatal (user is still subscribed at the browser level).
      setPushEnabled(true)
      try {
        const subJson = sub.toJSON()
        const res = await fetch('/api/sc-feed/push-subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint, p256dh: subJson.keys?.p256dh ?? '', auth: subJson.keys?.auth ?? '' }),
        })
        if (!res.ok) console.warn('[push] API save returned', res.status)
      } catch (apiErr) {
        console.warn('[push] API save failed (subscription exists in browser):', apiErr)
        setPushError('Enabled locally — server sync failed. Push delivery may not work until you toggle off then on.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[push] subscribe failed', err)
      setPushError(msg.includes('timed out') ? 'Timed out — browser could not reach the push service. Check your network.' : `Subscribe failed: ${msg}`)
    } finally { setPushPending(false) }
  }, [pushEnabled])

  const handleTestPush = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
    setPushTestPending(true)
    setPushTestStatus('idle')
    setPushError(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!sub) {
        setPushError('No active subscription on this device. Toggle push off and back on.')
        setPushTestStatus('error')
        return
      }
      const res = await fetch('/api/sc-feed/push-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      })
      if (!res.ok) {
        const d: { error?: string } = await res.json().catch(() => ({}))
        setPushError(d.error ?? `Test failed (HTTP ${res.status})`)
        setPushTestStatus('error')
        return
      }
      setPushTestStatus('sent')
      // Auto-clear the "Sent" hint after a few seconds
      setTimeout(() => setPushTestStatus(s => s === 'sent' ? 'idle' : s), 4000)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setPushError(`Test failed: ${msg}`)
      setPushTestStatus('error')
    } finally {
      setPushTestPending(false)
    }
  }, [])

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .catch(err => console.warn('[sw]', err))
    }
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return
    setPushSupported(true)
    const perm = Notification.permission
    setPushPermission(perm)
    if (perm !== 'granted') return

    // Check for an active push subscription.
    // Fast path: the controlling SW (root scope) — resolves instantly on load since the SW is already active.
    // Fallback: sweep all registrations in case the subscription lives on an older one.
    // Per-registration .catch(() => null) prevents a single bad registration from silently killing the whole check.
    ;(async () => {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription().catch(() => null)
        if (sub) { setPushEnabled(true); return }
      } catch { /* SW not ready or no subscription on controlling reg */ }
      try {
        const regs = await navigator.serviceWorker.getRegistrations()
        const subs = await Promise.all(regs.map(r => r.pushManager.getSubscription().catch(() => null)))
        if (subs.some(s => s !== null)) setPushEnabled(true)
      } catch { /* ignore */ }
    })()

    // Watch for the user changing notification permission in browser settings
    // while the page is open (e.g. clicking 🔒 → Reset permission).
    let permStatus: PermissionStatus | null = null
    navigator.permissions.query({ name: 'notifications' as PermissionName }).then(status => {
      permStatus = status
      status.onchange = () => {
        const next = status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'default'
        setPushPermission(next)
        if (next !== 'granted') setPushEnabled(false)
      }
    }).catch(() => {})

    return () => { if (permStatus) permStatus.onchange = null }
  }, [])

  useEffect(() => {
    if (localStorage.getItem('sc-feed-install-dismissed')) return
    const handler = (e: Event) => {
      e.preventDefault()
      installPromptRef.current = e as BeforeInstallPromptEvent
      setShowInstallBtn(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    const stored = localStorage.getItem('sc-feed-last-seen')
    setLastSeen(stored)
    localStorage.setItem('sc-feed-last-seen', new Date().toISOString())
    setShowTabBar(localStorage.getItem('sc-feed-show-tabbar') === 'true')
    if (localStorage.getItem('sc-feed-theme') === 'light') {
      setThemeState('light')
      document.documentElement.classList.add('light')
    }
    if (localStorage.getItem('sc-feed-leaks-revealed') === 'true') setLeaksRevealed(true)
    if (localStorage.getItem('sc-feed-date-format') === 'long') setDateFormat('long')
    const cutoff = localStorage.getItem('sc-feed-read-cutoff')
    if (cutoff) setReadCutoff(cutoff)
    try {
      const ids = localStorage.getItem('sc-feed-read-ids')
      if (ids) setReadIds(new Set(JSON.parse(ids)))
    } catch { /* keep default */ }
    try {
      const overrides = localStorage.getItem('sc-feed-unread-overrides')
      if (overrides) setUnreadOverrides(new Set(JSON.parse(overrides)))
    } catch { /* keep default */ }
    try {
      const cats = localStorage.getItem('sc-feed-tracker-categories')
      if (cats) setEnabledCategories(new Set(JSON.parse(cats)))
    } catch { /* keep default */ }
    // First-visit users (no localStorage) get layout from the canonical 16:9 All preset
    // so column heights/widths/hidden match the curated default. Once they edit a column,
    // their changes get persisted on top — these defaults are not written back to localStorage
    // unless the user explicitly modifies something.
    const defaultPreset = DEFAULT_PRESETS[0]
    try {
      const hidden = localStorage.getItem('sc-feed-hidden-channels')
      if (hidden) setHiddenChannels(new Set(JSON.parse(hidden)))
      else setHiddenChannels(new Set(defaultPreset.hiddenChannels))
    } catch { setHiddenChannels(new Set(defaultPreset.hiddenChannels)) }
    try {
      const widths = localStorage.getItem('sc-feed-column-widths')
      if (widths) setColumnWidths(JSON.parse(widths))
      else setColumnWidths(defaultPreset.columnWidths as Record<string, ColumnWidth>)
    } catch { setColumnWidths(defaultPreset.columnWidths as Record<string, ColumnWidth>) }
    try {
      const heights = localStorage.getItem('sc-feed-column-heights')
      if (heights) setColumnHeights(JSON.parse(heights))
      else setColumnHeights(defaultPreset.columnHeights as Record<string, ColumnHeight>)
    } catch { setColumnHeights(defaultPreset.columnHeights as Record<string, ColumnHeight>) }
    try {
      const presets = localStorage.getItem('sc-feed-layout-presets')
      if (presets) setLayoutPresets(JSON.parse(presets))
    } catch { /* keep default */ }
    try {
      const omni = localStorage.getItem('sc-feed-omni-source-toggles')
      if (omni) setOmniSourceToggles(JSON.parse(omni))
    } catch { /* keep default */ }
    try {
      const yt = localStorage.getItem(USER_YT_KEY)
      if (yt) {
        const parsed = JSON.parse(yt) as UserYTChannel[]
        setUserYTChannels(parsed)
        userYTRef.current = parsed
      }
    } catch { /* keep default */ }
    try {
      const tw = localStorage.getItem(USER_TWITCH_KEY)
      if (tw) {
        const parsed = JSON.parse(tw) as UserTwitchStreamer[]
        setUserTwitchStreamers(parsed)
        userTwitchRef.current = parsed
      }
    } catch { /* keep default */ }
    try {
      const rs = localStorage.getItem(USER_RSS_KEY)
      if (rs) {
        const parsed = JSON.parse(rs) as UserRSSFeed[]
        setUserRSSFeeds(parsed)
        userRSSRef.current = parsed
      }
    } catch { /* keep default */ }
  }, [])

  useEffect(() => {
    if (channels.length === 0 || columnOrder !== null) return
    try {
      const saved = localStorage.getItem('sc-feed-column-order')
      if (saved) {
        const hasMOTD = channels.some(c => MOTD_CHANNEL_IDS.has(c.id))
        const available = new Set([
          OMNI_FEED_ID,
          ...channels.filter(c => !MOTD_CHANNEL_IDS.has(c.id)).map(c => c.id),
          ...(hasMOTD ? [MOTD_UNIFIED_ID] : []),
        ])
        const parsed: string[] = JSON.parse(saved)
        const valid = parsed.filter(id => available.has(id))
        for (const id of available) {
          if (!valid.includes(id)) valid.push(id)
        }
        setColumnOrder(valid)
        return
      }
    } catch { /* fall through */ }
    const PREFERRED_ORDER = [
      OMNI_FEED_ID,
      MOTD_UNIFIED_ID,
      'rsi-status',
      'spectrum-cig',
      'twitter-rsi',
      'sc-youtube',
      'sc-news',
      'patch-news',
      'cig-news',
      'sc-leaks',
      'subliminalstv',
      'sc-yt-creators',
      'sc-twitch-creators',
      'sc-custom-rss',
    ]
    const hasMOTD = channels.some(c => MOTD_CHANNEL_IDS.has(c.id))
    const available = new Set([
      OMNI_FEED_ID,
      ...channels.filter(c => !MOTD_CHANNEL_IDS.has(c.id)).map(c => c.id),
      ...(hasMOTD ? [MOTD_UNIFIED_ID] : []),
    ])
    const ids = PREFERRED_ORDER.filter(id => available.has(id))
    for (const id of available) {
      if (!ids.includes(id)) ids.push(id)
    }
    setColumnOrder(ids)
  }, [channels, columnOrder])

  const toggleCategory = useCallback((key: string) => {
    setEnabledCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      try { localStorage.setItem('sc-feed-tracker-categories', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  const toggleOmniSource = useCallback((id: string) => {
    setOmniSourceToggles(prev => {
      // Default-true semantics: missing key OR true → currently enabled. Toggle flips it explicitly.
      const currentlyEnabled = prev[id] !== false
      const next = { ...prev, [id]: !currentlyEnabled }
      try { localStorage.setItem('sc-feed-omni-source-toggles', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const toggleChannel = useCallback((id: string) => {
    setHiddenChannels(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      try { localStorage.setItem('sc-feed-hidden-channels', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  const setColWidth = useCallback((id: string, w: ColumnWidth) => {
    setColumnWidths(prev => {
      const updated = { ...prev, [id]: w }
      try { localStorage.setItem('sc-feed-column-widths', JSON.stringify(updated)) } catch { /* ignore */ }
      return updated
    })
  }, [])

  const setColHeight = useCallback((id: string, h: ColumnHeight) => {
    setColumnHeights(prev => {
      const updated: Record<string, ColumnHeight> = { ...prev, [id]: h }
      try { localStorage.setItem('sc-feed-column-heights', JSON.stringify(updated)) } catch { /* ignore */ }
      return updated
    })
  }, [])

  const reorderCols = useCallback((newOrder: string[]) => {
    setColumnOrder(newOrder)
    try { localStorage.setItem('sc-feed-column-order', JSON.stringify(newOrder)) } catch { /* ignore */ }
  }, [])

  const saveLayoutPreset = useCallback((name: string) => {
    const preset: LayoutPreset = {
      id: Date.now().toString(),
      name,
      columnOrder: columnOrder ?? [],
      columnWidths: { ...columnWidths },
      columnHeights: { ...columnHeights },
      hiddenChannels: [...hiddenChannels],
    }
    setLayoutPresets(prev => {
      const next = [...prev, preset]
      try { localStorage.setItem('sc-feed-layout-presets', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [columnOrder, columnWidths, columnHeights, hiddenChannels])

  const applyLayoutPreset = useCallback((preset: LayoutPreset) => {
    setColumnOrder(preset.columnOrder)
    setColumnWidths(preset.columnWidths)
    setColumnHeights(preset.columnHeights as Record<string, ColumnHeight>)
    setHiddenChannels(new Set(preset.hiddenChannels))
    try {
      localStorage.setItem('sc-feed-column-order', JSON.stringify(preset.columnOrder))
      localStorage.setItem('sc-feed-column-widths', JSON.stringify(preset.columnWidths))
      localStorage.setItem('sc-feed-column-heights', JSON.stringify(preset.columnHeights))
      localStorage.setItem('sc-feed-hidden-channels', JSON.stringify(preset.hiddenChannels))
    } catch { /* ignore */ }
  }, [])

  const deleteLayoutPreset = useCallback((id: string) => {
    setLayoutPresets(prev => {
      const next = prev.filter(p => p.id !== id)
      try { localStorage.setItem('sc-feed-layout-presets', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const overwriteLayoutPreset = useCallback((id: string) => {
    setLayoutPresets(prev => {
      const next = prev.map(p => p.id === id ? {
        ...p,
        columnOrder: columnOrder ?? [],
        columnWidths: { ...columnWidths },
        columnHeights: { ...columnHeights },
        hiddenChannels: [...hiddenChannels],
      } : p)
      try { localStorage.setItem('sc-feed-layout-presets', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [columnOrder, columnWidths, columnHeights, hiddenChannels])

  // Export the CURRENT live layout as portable JSON (the four LayoutPreset fields). Used to
  // hand a tuned layout off — e.g. to bake into DEFAULT_PRESETS as the shipped default.
  const exportLayout = useCallback(() => JSON.stringify({
    columnOrder: columnOrder ?? [],
    columnWidths,
    columnHeights,
    hiddenChannels: [...hiddenChannels],
  }, null, 2), [columnOrder, columnWidths, columnHeights, hiddenChannels])

  // Apply a pasted layout JSON. Returns false on malformed input so the UI can flag it.
  const importLayout = useCallback((text: string): boolean => {
    try {
      const p = JSON.parse(text)
      if (!Array.isArray(p.columnOrder)) return false
      applyLayoutPreset({
        id: 'imported',
        name: 'Imported',
        columnOrder: p.columnOrder,
        columnWidths: (p.columnWidths ?? {}) as Record<string, ColumnWidth>,
        columnHeights: (p.columnHeights ?? {}) as Record<string, ColumnHeight>,
        hiddenChannels: Array.isArray(p.hiddenChannels) ? p.hiddenChannels : [],
      })
      return true
    } catch { return false }
  }, [applyLayoutPreset])

  const fanOutUserFeeds = useCallback(async (channels: FeedChannel[]): Promise<FeedChannel[]> => {
    const yt = userYTRef.current
    const tw = userTwitchRef.current
    const rs = userRSSRef.current

    const safeFetch = async (url: string): Promise<FeedMessage[]> => {
      try {
        const r = await fetch(url)
        if (!r.ok) return []
        const d: { messages?: FeedMessage[] } = await r.json()
        return d.messages ?? []
      } catch { return [] }
    }

    const [ytResults, twResult, rsResults] = await Promise.all([
      Promise.all(yt.slice(0, MAX_YT_CHANNELS).map(c =>
        safeFetch(`/api/sc-feed/youtube-proxy?id=${encodeURIComponent(c.channelId)}&name=${encodeURIComponent(c.name)}`)
      )),
      tw.length > 0
        ? safeFetch(`/api/sc-feed/twitch-proxy?logins=${tw.slice(0, MAX_TWITCH_STREAMERS).map(s => encodeURIComponent(s.login)).join(',')}`)
        : Promise.resolve([] as FeedMessage[]),
      Promise.all(rs.slice(0, MAX_RSS_FEEDS).map(f =>
        safeFetch(`/api/sc-feed/rss-proxy?url=${encodeURIComponent(f.url)}&label=${encodeURIComponent(f.label)}`)
      )),
    ])

    const ytMsgs = ytResults.flat().sort((a, b) => (b.ts_raw ?? '').localeCompare(a.ts_raw ?? '')).slice(0, 25)
    const rsMsgs = rsResults.flat().sort((a, b) => (b.ts_raw ?? '').localeCompare(a.ts_raw ?? '')).slice(0, 25)

    return channels.map(ch => {
      if (ch.id === YT_CREATORS_ID)     return { ...ch, messages: ytMsgs, updated_at: ytMsgs[0]?.ts_raw ?? null }
      if (ch.id === TWITCH_CREATORS_ID) return { ...ch, messages: twResult, updated_at: twResult[0]?.ts_raw ?? null }
      if (ch.id === CUSTOM_RSS_ID)      return { ...ch, messages: rsMsgs, updated_at: rsMsgs[0]?.ts_raw ?? null }
      return ch
    })
  }, [])

  const fetchFeed = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    else setRefreshing(true)
    try {
      const res = await fetch('/api/sc-feed')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: FeedChannel[] = await res.json()
      const augmented = await fanOutUserFeeds(data)
      channelsRef.current = augmented
      setChannels(augmented)
      setLastFetch(new Date())
    } catch (err) {
      console.error('[sc-feed]', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [fanOutUserFeeds])

  useEffect(() => {
    fetchFeed()
    intervalRef.current = setInterval(() => fetchFeed(true), REFRESH_INTERVAL_MS)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') fetchFeed(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchFeed])

  // Auto-show patch notes on first visit OR when version has bumped since last close.
  useEffect(() => {
    const seen = localStorage.getItem(PATCH_NOTES_SEEN_KEY)
    if (seen !== CURRENT_VERSION) setPatchNotesOpen(true)
  }, [])

  // Stamp seen-version when modal closes.
  const closePatchNotes = useCallback(() => {
    setPatchNotesOpen(false)
    try { localStorage.setItem(PATCH_NOTES_SEEN_KEY, CURRENT_VERSION) } catch {}
  }, [])

  // Close mobile menu on outside click.
  useEffect(() => {
    if (!mobileMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [mobileMenuOpen])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if ((e.key === '/' && !inInput && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key === 'k')) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const motdChannels = useMemo(() =>
    channels.filter(c => MOTD_CHANNEL_IDS.has(c.id)),
    [channels]
  )

  const unifiedMotd = useMemo(() => {
    type MotdEntry = FeedMessage & { _channelId: string; _motdLabels: string[] }
    const all: MotdEntry[] = []
    for (const ch of motdChannels) {
      const label = ch.id === 'sc-motd' ? 'SC MOTD' : 'EVO MOTD'
      const latest = [...ch.messages].sort((a, b) => (b.ts_raw ?? '').localeCompare(a.ts_raw ?? ''))[0]
      if (latest) all.push({ ...latest, _channelId: ch.id, _motdLabels: [label] })
    }
    return all.sort((a, b) => (b.ts_raw ?? '').localeCompare(a.ts_raw ?? ''))
  }, [motdChannels])

  const motdClearAllRead = useCallback(() => {
    channelsRef.current
      .filter(c => MOTD_CHANNEL_IDS.has(c.id))
      .forEach(ch => clearChannelRead(ch.id))
  }, [clearChannelRead])

  const motdMarkAllRead = useCallback(() => {
    channelsRef.current
      .filter(c => MOTD_CHANNEL_IDS.has(c.id))
      .forEach(ch => markChannelRead(ch.id))
  }, [markChannelRead])

  const orderedColumns = useMemo(() =>
    (columnOrder ?? [])
      .map(id => {
        const isOmni = id === OMNI_FEED_ID
        const isMOTD = id === MOTD_UNIFIED_ID
        const visible = isOmni
          ? !hiddenChannels.has(OMNI_FEED_ID)
          : isMOTD
            ? motdChannels.length > 0 && !hiddenChannels.has(MOTD_UNIFIED_ID)
            : !hiddenChannels.has(id) && channels.some(c => c.id === id)
        return {
          id, isOmni, isMOTD, visible,
          colWidth: (columnWidths[id] ?? 'medium') as ColumnWidth,
          colHeight: (columnHeights[id] ?? 'full') as ColumnHeight,
        }
      })
      .filter(col => col.visible),
    [columnOrder, hiddenChannels, channels, columnWidths, columnHeights, motdChannels]
  )

  const effectiveMobileFeed =
    orderedColumns.find(c => c.id === mobileActiveFeed)?.id ?? orderedColumns[0]?.id ?? null

  // Overflow-aware slot grouping: start a new slot when adding would exceed 100% height
  const slots = useMemo(() => {
    const result: (typeof orderedColumns)[] = []
    let i = 0
    while (i < orderedColumns.length) {
      const cur = orderedColumns[i]
      if (cur.colHeight === 'full') {
        result.push([cur]); i++
      } else {
        const group: typeof orderedColumns = []
        let totalFrac = 0
        let j = i
        while (j < orderedColumns.length && orderedColumns[j].colHeight !== 'full') {
          const col = orderedColumns[j]
          const frac = col.colHeight === 'third' ? 1 / 3 : col.colHeight === 'quarter' ? 0.25 : 0.5
          if (totalFrac + frac > 1.01) break
          group.push(col); totalFrac += frac; j++
        }
        if (group.length === 0) { result.push([cur]); i++ }
        else { result.push(group); i = j }
      }
    }
    return result
  }, [orderedColumns])

  const totalMinWidth = useMemo(() =>
    slots.reduce((sum, slot) => {
      const slotW = Math.max(...slot.map(c => COLUMN_WIDTHS[c.colWidth]))
      return sum + slotW + 12
    }, 0),
    [slots]
  )

  // Stable per-column width/height setters — recomputed only when orderedColumns changes,
  // not on every ScFeedView state update (e.g. settingsOpen, read state, search).
  const colSetWidthFns = useMemo(() => {
    const map: Record<string, (w: ColumnWidth) => void> = {}
    for (const col of orderedColumns) {
      const id = col.id
      map[id] = (w: ColumnWidth) => setColWidth(id, w)
    }
    return map
  }, [orderedColumns, setColWidth])

  const colSetHeightFns = useMemo(() => {
    const map: Record<string, (h: ColumnHeight) => void> = {}
    for (const col of orderedColumns) {
      const id = col.id
      map[id] = (h: ColumnHeight) => setColHeight(id, h)
    }
    return map
  }, [orderedColumns, setColHeight])

  const renderCol = (col: typeof orderedColumns[number]) => {
    if (col.isOmni) return (
      <UnifiedOmniFeed
        channels={channels}
        enabledCategories={enabledCategories}
        leaksRevealed={leaksRevealed}
        lastSeen={lastSeen}
        motdMessages={unifiedMotd}
        globalSearch={globalSearch}
        isReadMsg={isReadGlobal}
        onMarkRead={toggleReadGlobal}
        onMarkAllRead={markAllReadGlobal}
        onClearAllRead={clearAllReadGlobal}
        colWidth={col.colWidth}
        colHeight={col.colHeight}
        onSetWidth={colSetWidthFns[col.id]}
        onSetHeight={colSetHeightFns[col.id]}
        omniSourceToggles={omniSourceToggles}
        onToggleOmniSource={toggleOmniSource}
        onToggleCategory={toggleCategory}
      />
    )
    if (col.isMOTD) return (
      <UnifiedMotdFeed
        messages={unifiedMotd}
        globalSearch={globalSearch}
        isReadMsg={isReadGlobal}
        onMarkRead={toggleReadGlobal}
        onMarkAllRead={motdMarkAllRead}
        onClearAllRead={motdClearAllRead}
        colWidth={col.colWidth}
        colHeight={col.colHeight}
        onSetWidth={colSetWidthFns[col.id]}
        onSetHeight={colSetHeightFns[col.id]}
      />
    )
    const ch = channels.find(c => c.id === col.id)
    if (!ch) return null
    return (
      <ChannelFeedColumn
        col={col}
        channel={ch}
        enabledCategories={enabledCategories}
        globalSearch={globalSearch}
        lastSeen={lastSeen}
        leaksRevealed={leaksRevealed}
        onToggleLeaks={ch.id === LEAKS_CHANNEL_ID ? toggleLeaks : undefined}
        onToggleCategory={toggleCategory}
        isReadGlobal={isReadGlobal}
        toggleReadGlobal={toggleReadGlobal}
        markChannelRead={markChannelRead}
        clearChannelRead={clearChannelRead}
        onSetWidth={colSetWidthFns[col.id]}
        onSetHeight={colSetHeightFns[col.id]}
      />
    )
  }

  const toggleLeaks = useCallback(() => {
    setLeaksRevealed(r => {
      const next = !r
      try { localStorage.setItem('sc-feed-leaks-revealed', String(next)) } catch { /**/ }
      return next
    })
  }, [])

  const persistAndRefetch = useCallback((key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* ignore */ }
    void fetchFeed(true)
  }, [fetchFeed])

  const ensureChannelVisible = useCallback((channelId: string) => {
    setHiddenChannels(prev => {
      if (!prev.has(channelId)) return prev
      const next = new Set(prev)
      next.delete(channelId)
      try { localStorage.setItem('sc-feed-hidden-channels', JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [])

  const handleAddYT = useCallback(async (input: string): Promise<string | null> => {
    if (userYTRef.current.length >= MAX_YT_CHANNELS) return `Max ${MAX_YT_CHANNELS} channels`
    try {
      const r = await fetch(`/api/sc-feed/youtube-proxy?q=${encodeURIComponent(input)}`)
      const d: { channelId?: string; name?: string; error?: string } = await r.json()
      if (!r.ok || !d.channelId) return d.error ?? 'Could not resolve channel'
      if (userYTRef.current.some(c => c.channelId === d.channelId)) return 'Channel already added'
      const next = [...userYTRef.current, { channelId: d.channelId, name: d.name ?? d.channelId }]
      userYTRef.current = next
      setUserYTChannels(next)
      ensureChannelVisible(YT_CREATORS_ID)
      persistAndRefetch(USER_YT_KEY, next)
      return null
    } catch (e) { return String(e) }
  }, [persistAndRefetch, ensureChannelVisible])

  const handleRemoveYT = useCallback((channelId: string) => {
    const next = userYTRef.current.filter(c => c.channelId !== channelId)
    userYTRef.current = next
    setUserYTChannels(next)
    persistAndRefetch(USER_YT_KEY, next)
  }, [persistAndRefetch])

  const handleAddTwitch = useCallback(async (input: string): Promise<string | null> => {
    if (userTwitchRef.current.length >= MAX_TWITCH_STREAMERS) return `Max ${MAX_TWITCH_STREAMERS} streamers`
    const login = input.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//, '').split('/')[0]
    if (!/^[a-z0-9_]{2,40}$/.test(login)) return 'Invalid Twitch login'
    if (userTwitchRef.current.some(s => s.login === login)) return 'Streamer already added'
    try {
      const r = await fetch(`/api/sc-feed/twitch-proxy?logins=${encodeURIComponent(login)}`)
      const d: { states?: Record<string, { live: boolean; userName?: string }>; error?: string } = await r.json()
      if (!r.ok) return d.error ?? 'Twitch lookup failed'
      const displayName = d.states?.[login]?.userName
      const next = [...userTwitchRef.current, { login, displayName }]
      userTwitchRef.current = next
      setUserTwitchStreamers(next)
      ensureChannelVisible(TWITCH_CREATORS_ID)
      persistAndRefetch(USER_TWITCH_KEY, next)
      return null
    } catch (e) { return String(e) }
  }, [persistAndRefetch, ensureChannelVisible])

  const handleRemoveTwitch = useCallback((login: string) => {
    const next = userTwitchRef.current.filter(s => s.login !== login)
    userTwitchRef.current = next
    setUserTwitchStreamers(next)
    persistAndRefetch(USER_TWITCH_KEY, next)
  }, [persistAndRefetch])

  const handleAddRSS = useCallback(async (input: string): Promise<string | null> => {
    if (userRSSRef.current.length >= MAX_RSS_FEEDS) return `Max ${MAX_RSS_FEEDS} feeds`
    let url: string
    try { url = new URL(input.trim()).toString() } catch { return 'Invalid URL' }
    if (userRSSRef.current.some(f => f.url === url)) return 'Feed already added'
    try {
      const r = await fetch(`/api/sc-feed/rss-proxy?url=${encodeURIComponent(url)}`)
      const d: { feedTitle?: string; error?: string } = await r.json()
      if (!r.ok) return d.error ?? 'RSS fetch failed'
      const label = d.feedTitle ?? new URL(url).hostname
      const next = [...userRSSRef.current, { url, label }]
      userRSSRef.current = next
      setUserRSSFeeds(next)
      ensureChannelVisible(CUSTOM_RSS_ID)
      persistAndRefetch(USER_RSS_KEY, next)
      return null
    } catch (e) { return String(e) }
  }, [persistAndRefetch, ensureChannelVisible])

  const handleRemoveRSS = useCallback((url: string) => {
    const next = userRSSRef.current.filter(f => f.url !== url)
    userRSSRef.current = next
    setUserRSSFeeds(next)
    persistAndRefetch(USER_RSS_KEY, next)
  }, [persistAndRefetch])

  const settingsPanelProps = {
    channels, columnOrder,
    onReorder: reorderCols,
    hiddenChannels, onToggleChannel: toggleChannel,
    leaksRevealed, onToggleLeaks: toggleLeaks,
    showTabBar, onToggleTabBar: toggleTabBar,
    theme, onSetTheme: setThemePref,
    dateFormat, onSetDateFormat: setDateFormatPref,
    hideAllRead, onToggleHideAllRead: () => setHideAllRead(v => !v),
    onMarkAllRead: markAllReadGlobal,
    onMarkAllUnread: clearAllReadGlobal,
    layoutPresets: [...DEFAULT_PRESETS, ...layoutPresets],
    onSavePreset: saveLayoutPreset,
    onApplyPreset: applyLayoutPreset,
    onDeletePreset: deleteLayoutPreset,
    onOverwritePreset: overwriteLayoutPreset,
    onExportLayout: exportLayout,
    onImportLayout: importLayout,
    pushSupported, pushEnabled, pushPermission, pushPending, pushError,
    pushTestPending, pushTestStatus,
    onTogglePush: handleTogglePush,
    onTestPush: handleTestPush,
    userYTChannels, onAddYT: handleAddYT, onRemoveYT: handleRemoveYT,
    userTwitchStreamers, onAddTwitch: handleAddTwitch, onRemoveTwitch: handleRemoveTwitch,
    userRSSFeeds, onAddRSS: handleAddRSS, onRemoveRSS: handleRemoveRSS,
    onOpenPatchNotes: () => { setSettingsOpen(false); setPatchNotesOpen(true) },
  }

  return (
    <FeedPrefsContext.Provider value={{ dateFormat, hideAllRead }}>
    <div className="flex flex-col hero-gradient flex-1 min-h-0">

      {/* Header — three-zone layout: hamburger LEFT · logo CENTER · github RIGHT */}
      <div className="shrink-0 px-4 sm:px-6 py-3.5 border-b border-outline-variant/30 grid grid-cols-[auto_1fr_auto] items-center gap-3">

        {/* LEFT — single canonical hamburger menu (all sizes) */}
        <div className="relative justify-self-start" ref={mobileMenuRef}>
          <button
            onClick={() => setMobileMenuOpen(o => !o)}
            className={`inline-flex items-center justify-center p-2 rounded-lg border transition-colors ${mobileMenuOpen
                ? 'border-primary-container/40 bg-primary-container/10 text-primary-container'
                : 'border-outline-variant/40 text-on-surface-variant hover:text-on-surface hover:border-outline'
              }`}
            aria-label="Menu"
            aria-expanded={mobileMenuOpen}
          >
            <Menu className="w-4 h-4" />
          </button>
          {mobileMenuOpen && (
            <div className="absolute left-0 top-full mt-2 w-56 z-40 rounded-lg border border-outline-variant/40 bg-surface-container shadow-xl overflow-hidden">
              {lastFetch && (
                <div className="px-3 py-2 text-[10px] font-mono text-on-surface-variant/50 border-b border-outline-variant/30">
                  Updated {timeAgo(lastFetch.toISOString())}
                </div>
              )}
              <button
                onClick={() => { setMobileMenuOpen(false); fetchFeed(true) }}
                disabled={refreshing || loading}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors disabled:opacity-50 text-left"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />Refresh
              </button>
              <button
                onClick={() => { setMobileMenuOpen(false); setSettingsOpen(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-left"
              >
                <Settings className="w-3.5 h-3.5" />Settings
              </button>
              {showInstallBtn && (
                <button
                  onClick={async () => {
                    setMobileMenuOpen(false)
                    if (!installPromptRef.current) return
                    await installPromptRef.current.prompt()
                    const { outcome } = await installPromptRef.current.userChoice
                    installPromptRef.current = null
                    setShowInstallBtn(false)
                    if (outcome === 'dismissed') {
                      localStorage.setItem('sc-feed-install-dismissed', 'true')
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-left border-t border-outline-variant/30"
                >
                  <Download className="w-3.5 h-3.5" />Install
                </button>
              )}
              <button
                onClick={() => { setMobileMenuOpen(false); setPatchNotesOpen(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-left border-t border-outline-variant/30"
              >
                <Sparkles className="w-3.5 h-3.5 text-primary-container" />What&apos;s New
              </button>

              {/* Account — sign in / signed-in identity + sign out (+ owner backend) */}
              {authStatus !== 'loading' && (
                session ? (
                  <>
                    <div className="px-3 pt-2.5 pb-1 border-t border-outline-variant/30 text-[10px] font-mono text-on-surface-variant/50 truncate" title={session.user?.email ?? ''}>
                      {session.user?.email}
                    </div>
                    {session.user?.role === 'owner' && (
                      <Link
                        href="/owner"
                        onClick={() => setMobileMenuOpen(false)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-left"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-primary-container" />Owner Backend
                      </Link>
                    )}
                    <button
                      onClick={() => { setMobileMenuOpen(false); signOut() }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-left"
                    >
                      <LogOut className="w-3.5 h-3.5" />Sign Out
                    </button>
                  </>
                ) : (
                  <Link
                    href="/login"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors text-left border-t border-outline-variant/30"
                  >
                    <LogIn className="w-3.5 h-3.5" />Sign In
                  </Link>
                )
              )}
            </div>
          )}
        </div>

        {/* CENTER — logo + version pill */}
        <div className="justify-self-center flex items-center gap-2.5 sm:gap-3 min-w-0">
          <img
            src={theme === 'light' ? '/logos/[SCFeed][Logo][Black][Color].svg' : '/logos/[SCFeed][Logo][White][Color].svg'}
            alt="SC Feed"
            className="h-9 sm:h-10 shrink-0"
          />
          <button
            onClick={() => setPatchNotesOpen(true)}
            className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full border border-outline-variant/40 text-[9px] font-mono font-black uppercase tracking-widest text-on-surface-variant/70 hover:text-on-surface hover:border-outline transition-colors"
            title="What's new"
          >
            v{CURRENT_VERSION}
          </button>
        </div>

        {/* RIGHT — GitHub badge */}
        <div className="justify-self-end flex items-center">
          <GithubWidget className="!hidden md:!inline-flex" />
        </div>
      </div>

      {/* Feed tab bar — mobile always, desktop when enabled in settings */}
      <div className={`${showTabBar ? '' : 'md:hidden'} shrink-0 flex items-center border-b border-outline-variant/20 overflow-x-auto scrollbar-hidden`}>
        {orderedColumns.map(col => {
          const isActive = col.id === effectiveMobileFeed
          return (
            <button
              key={col.id}
              onClick={() => {
                setMobileActiveFeed(col.id)
                const el = colRefs.current.get(col.id)
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
              }}
              className={`px-3 py-2.5 text-[10px] font-label font-black uppercase tracking-widest whitespace-nowrap transition-colors shrink-0 border-b-2 ${isActive
                  ? 'text-primary-container border-primary-container'
                  : 'text-on-surface-variant/50 hover:text-on-surface border-transparent'
                }`}
            >
              {getFeedLabel(col.id, channels)}
            </button>
          )
        })}
      </div>

      {/* Body row */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">

        {/* Mobile backdrop */}
        {settingsOpen && (
          <div className="md:hidden fixed inset-0 z-30 bg-black/50" onClick={() => setSettingsOpen(false)} />
        )}

        {/* Content — clicking here closes any open settings panel */}
        <div className="flex-1 min-h-0 overflow-hidden" onClick={() => { if (settingsOpen) setSettingsOpen(false) }}>
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="w-6 h-6 text-primary-container animate-spin" />
            </div>
          ) : (
            <>
              {/* Desktop: horizontal scroll columns */}
              <div className="hidden md:block h-full overflow-x-auto">
                <div className="flex gap-3 h-full px-3 py-3 justify-center" style={{ minWidth: `${totalMinWidth}px` }}>
                  {slots.map(slot => (
                    <div key={slot[0].id} className="flex flex-col shrink-0 gap-3">
                      {slot.map(col => {
                        const frac = col.colHeight === 'quarter' ? 0.25 : col.colHeight === 'third' ? 1 / 3 : col.colHeight === 'half' ? 0.5 : 1
                        const gapTax = slot.length > 1 ? ((slot.length - 1) * 12) / slot.length : 0
                        const itemH = slot.length === 1 && col.colHeight === 'full'
                          ? '100%'
                          : `calc(${(frac * 100).toFixed(4)}% - ${gapTax.toFixed(2)}px)`
                        const colPx = COLUMN_WIDTHS[col.colWidth]
                        return (
                          <div key={col.id}
                            ref={el => { if (el) colRefs.current.set(col.id, el) }}
                            className="flex flex-col rounded-xl border border-outline-variant/25 bg-surface-container-low/60 overflow-hidden"
                            style={{ width: `${colPx}px`, height: itemH }}
                          >
                            {renderCol(col)}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Mobile: single active feed */}
              {effectiveMobileFeed && (
                <div className="md:hidden h-full bg-surface-container-low/60">
                  {(() => {
                    const col = orderedColumns.find(c => c.id === effectiveMobileFeed)
                    return col ? renderCol(col) : null
                  })()}
                </div>
              )}
            </>
          )}
        </div>

        {/* Desktop settings: pushes content from right */}
        <div className={`max-md:hidden shrink-0 overflow-hidden transition-[width] duration-200 ease-in-out border-l border-outline-variant/30 ${settingsOpen ? 'w-72' : 'w-0 border-0'}`}>
          <SettingsPanel {...settingsPanelProps} />
        </div>

        {/* Mobile settings: fixed overlay from right */}
        {settingsOpen && (
          <div className="md:hidden fixed right-0 top-0 h-full z-40 w-72 overflow-hidden border-l border-outline-variant/30 bg-surface-container">
            <SettingsPanel {...settingsPanelProps} />
          </div>
        )}

      </div>

    </div>

      {/* Spotlight search overlay */}
      {searchOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setSearchOpen(false)}
          />
          <div className="fixed inset-x-0 top-4 md:top-[22%] z-50 flex justify-center px-4 md:px-6 pointer-events-none">
            <div className="w-full max-w-2xl pointer-events-auto" style={{ animation: 'mc-slide-in 0.15s ease-out' }}>
              <div className="flex items-center gap-3 px-4 md:px-5 py-4 rounded-2xl bg-surface-container-high border border-outline-variant/50 shadow-2xl">
                <Search className="w-5 h-5 text-on-surface-variant/50 shrink-0" />
                <input
                  autoFocus
                  type="text"
                  value={globalSearch}
                  onChange={e => setGlobalSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') setSearchOpen(false)
                    if (e.key === 'Escape') { setSearchOpen(false); setGlobalSearch('') }
                  }}
                  placeholder="Search all feeds…"
                  className="flex-1 bg-transparent text-lg font-body text-on-surface placeholder:text-on-surface-variant/30 outline-none min-w-0"
                />
                <button
                  onClick={() => { setSearchOpen(false); setGlobalSearch('') }}
                  className="text-on-surface-variant/40 hover:text-on-surface transition-colors shrink-0 p-1 -mr-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
      {globalSearch && !searchOpen && (
        <div className={`fixed bottom-24 right-6 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-high border border-primary-container/40 shadow-lg max-w-[220px] transition-transform duration-200 ease-in-out ${
          settingsOpen ? 'md:-translate-x-72' : ''
        }`}>
          <Search className="w-3 h-3 text-primary-container/60 shrink-0" />
          <span className="text-[11px] font-label font-black text-on-surface truncate">{globalSearch}</span>
          <button onClick={() => setGlobalSearch('')} className="shrink-0 p-0.5 rounded-full hover:bg-surface-container transition-colors">
            <X className="w-3 h-3 text-on-surface-variant/60" />
          </button>
        </div>
      )}
      <button
        onClick={() => setSearchOpen(o => !o)}
        className={`fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 ease-in-out shadow-lg text-on-primary-container ${globalSearch && !searchOpen ? 'bg-primary-container ring-2 ring-primary-container/60 ring-offset-2 ring-offset-surface' : 'bg-primary-container hover:brightness-110'} ${
          settingsOpen ? 'md:-translate-x-72' : ''
        }`}
      >
        {searchOpen ? <X className="w-5 h-5" /> : <Search className="w-5 h-5" />}
      </button>

      {/* Notifications FAB — stacked above the Search FAB */}
      <NotificationsFab
        channels={channels}
        open={notificationsOpen}
        onToggleOpen={() => setNotificationsOpen(o => !o)}
        onForceOpen={() => setNotificationsOpen(true)}
        slideClass={settingsOpen ? 'md:-translate-x-72' : ''}
      />

      {/* SC Community FAB — top of the FAB stack, links out to RSI */}
      <a
        href="https://robertsspaceindustries.com"
        target="_blank"
        rel="noopener noreferrer"
        title="Made by the Community — robertsspaceindustries.com"
        className={`fixed bottom-[10.5rem] right-6 z-30 w-14 h-14 rounded-full flex items-center justify-center shadow-lg bg-surface-container-high border border-outline-variant/40 hover:brightness-110 transition-all duration-200 ease-in-out ${
          settingsOpen ? 'md:-translate-x-72' : ''
        }`}
      >
        <img
          src={theme === 'light' ? '/logos/MadeByTheCommunity_Black.png' : '/logos/MadeByTheCommunity_White.png'}
          alt="Made by the Community"
          className="w-9 h-9 object-contain"
        />
      </a>

      <CookieBanner />

      <PatchNotesModal open={patchNotesOpen} onClose={closePatchNotes} theme={theme} />

    </FeedPrefsContext.Provider>
  )
}
