'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell, Check, CheckCheck, ChevronDown, ChevronUp,
  Clock, ExternalLink, RotateCcw, X,
} from 'lucide-react'
import type { FeedChannel, FeedMessage } from '@/app/api/sc-feed/route'
import {
  MOTD_CHANNEL_IDS, NOTIF_COLORS, NOTIF_READ_KEY, NOTIF_MUTED_KEY,
  NOTIF_VOLUME_KEY, NOTIF_VOLUME_DEFAULT, PILL,
  useFeedPrefs, type NotifItem,
} from './sc-feed-types'
import { getRsiStatusTheme, timeAgo } from './sc-feed-utils'

export function RsiStatusCard({ rsiStatus }: {
  rsiStatus: NonNullable<FeedChannel['rsiStatus']>
}) {
  const [collapsed, setCollapsed] = useState(false)
  const theme = getRsiStatusTheme(rsiStatus.summaryStatus)

  return (
    <a
      href="https://status.robertsspaceindustries.com/"
      target="_blank"
      rel="noopener noreferrer"
      className={`block shrink-0 border-b ${theme.sectionBg} hover:brightness-110 transition-[filter]`}
    >
      <div className="flex items-center justify-between px-4 py-2 select-none">
        <div className="flex items-center gap-2">
          <span className={`${PILL} ${theme.pill}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${theme.dot}`} />
            {theme.label}
          </span>
          <span className="text-[10px] font-mono text-on-surface-variant/30">
            {rsiStatus.systems.length} systems
          </span>
        </div>
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); setCollapsed(c => !c) }}
          className={`p-1 rounded ${theme.chevron} transition-colors`}
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="px-4 pb-3 space-y-1.5">
          {rsiStatus.systems.map(sys => {
            const sTheme = getRsiStatusTheme(sys.status)
            return (
              <div key={sys.name} className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-label font-black text-on-surface/70 truncate">
                  {sys.name}
                </span>
                <span className={`${PILL} ${sTheme.pill}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sTheme.dot}`} />
                  {sTheme.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </a>
  )
}

function NotifCard({ item, isRead, onToggle }: {
  item: NotifItem
  isRead: boolean
  onToggle: () => void
}) {
  const { dateFormat } = useFeedPrefs()
  const color = NOTIF_COLORS[item.channelId] ?? 'bg-surface-container text-on-surface-variant border-outline-variant/40'

  return (
    <div className={`relative glass-card rounded-xl p-3 transition-all duration-300 ${isRead ? 'opacity-40 hover:opacity-100' : ''}`}>
      <button
        onClick={onToggle}
        title={isRead ? 'Mark unread' : 'Mark as read'}
        className={`absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center border transition-all duration-200 ${isRead
            ? 'border-primary-container/60 text-primary-container'
            : 'border-outline-variant/30 text-transparent hover:border-primary-container/50 hover:text-primary-container/50'
          }`}
      >
        <Check className="w-2.5 h-2.5" />
      </button>

      {/* Title — 1 line */}
      {item.url ? (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group/link flex items-start gap-1 text-xs font-headline font-bold text-on-surface hover:text-primary-container transition-colors leading-snug pr-7"
        >
          <span className="line-clamp-1">{item.title}</span>
          <ExternalLink className="w-3 h-3 shrink-0 mt-0.5 opacity-30 group-hover/link:opacity-100 transition-opacity" />
        </a>
      ) : (
        <p className="text-xs font-headline font-bold text-on-surface leading-snug line-clamp-1 pr-7">{item.title}</p>
      )}

      {/* Body — 2 lines */}
      {item.body && (
        <p className="text-[10px] font-body text-on-surface-variant/60 leading-relaxed line-clamp-2 mt-1">
          {item.body}
        </p>
      )}

      {/* Bottom metadata row: channel-label tag + timestamp */}
      <div className="flex items-center gap-1 mt-2 pt-2 border-t border-outline-variant/15">
        <span className={`px-1.5 py-0.5 rounded border text-[8px] font-label font-black uppercase tracking-widest ${color}`}>
          {item.channelLabel}
        </span>
        <span className="ml-auto text-[8px] font-mono text-on-surface-variant/40 flex items-center gap-1 shrink-0">
          <Clock className="w-2 h-2" />{timeAgo(item.ts_raw || item.timestamp, dateFormat)}
        </span>
      </div>
    </div>
  )
}

/** Play the notification sound at an explicit volume, ignoring the mute setting. Used by the
 *  Settings preview button so the slider gives immediate feedback. */
export function previewChime(volume: number) {
  try {
    const vol = Math.min(1, Math.max(0, volume))
    if (vol <= 0) return
    const audio = new Audio('/sounds/notification.mp3')
    audio.volume = vol
    void audio.play().catch(() => {})
  } catch { /* audio may be blocked until user interaction */ }
}

/** Auto-play on new arrivals — respects the mute toggle + volume slider (localStorage). */
function playChime() {
  try {
    if (localStorage.getItem(NOTIF_MUTED_KEY) === 'true') return
    const raw = localStorage.getItem(NOTIF_VOLUME_KEY)
    const v = raw == null ? NOTIF_VOLUME_DEFAULT : parseFloat(raw)
    previewChime(Number.isFinite(v) ? v : NOTIF_VOLUME_DEFAULT)
  } catch { /* localStorage/audio best-effort */ }
}

/**
 * Notifications state hook — owns read state + unread computation, shared by the FAB (badge)
 * and the slide-out NotificationsPanel. On new arrivals it plays the chime (respecting the
 * mute/volume settings) and bumps the badge; it NO LONGER auto-opens the panel, since the
 * panel now shifts feed content and an auto-open on every new item would be disruptive.
 *
 * Read state is shared with the global Mission Control sidebar via the `notifications-read-ids`
 * localStorage key. Marking a card read fades + collapses it (220ms) before the readIds write
 * lands, so the next card slides up smoothly into the freed space.
 */
export function useNotifications(channels: FeedChannel[]) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())
  const lastSeenRef = useRef<Map<string, string>>(new Map())
  const isInitRef = useRef(false)
  const readIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => { readIdsRef.current = readIds }, [readIds])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIF_READ_KEY)
      const set = new Set<string>(raw ? JSON.parse(raw) : [])
      setReadIds(set)
      readIdsRef.current = set
    } catch { /* keep default */ }
  }, [])

  // Detect new arrivals across channels and chime. Skip the very first run so we don't chime
  // for everything that was already there when the page loaded.
  useEffect(() => {
    if (!isInitRef.current) {
      for (const ch of channels) {
        if (ch.messages.length > 0) {
          lastSeenRef.current.set(ch.id, ch.messages[0].ts_raw ?? '')
        }
      }
      isInitRef.current = true
      return
    }
    let hasNewUnread = false
    for (const ch of channels) {
      if (!ch.messages.length || ch.error) continue
      if (MOTD_CHANNEL_IDS.has(ch.id)) continue
      const latest = ch.messages[0]
      const lastTs = lastSeenRef.current.get(ch.id) ?? ''
      if (latest.ts_raw && latest.ts_raw > lastTs) {
        const id = `${ch.id}-${latest.id}`
        if (!readIdsRef.current.has(id)) hasNewUnread = true
        lastSeenRef.current.set(ch.id, latest.ts_raw)
      }
    }
    if (hasNewUnread) playChime()
  }, [channels])

  const toItem = useCallback((ch: FeedChannel, m: FeedMessage): NotifItem => ({
    id: `${ch.id}-${m.id}`,
    channelId: ch.id,
    channelLabel: ch.label,
    title: m.title,
    body: m.body || undefined,
    url: m.url || undefined,
    timestamp: m.timestamp,
    ts_raw: m.ts_raw ?? '',
    discord_jump_url: m.discord_jump_url || undefined,
    source: m.source || undefined,
  }), [])

  const unreadItems = useMemo(() =>
    channels
      .filter(c => !MOTD_CHANNEL_IDS.has(c.id))
      .flatMap(ch => ch.messages.map(m => toItem(ch, m)))
      .filter(i => !readIds.has(i.id))
      .sort((a, b) => b.ts_raw.localeCompare(a.ts_raw)),
    [channels, readIds, toItem]
  )

  const handleMarkRead = useCallback((id: string) => {
    setRemovingIds(s => { const n = new Set(s); n.add(id); return n })
    setTimeout(() => {
      setReadIds(prev => {
        const next = new Set(prev); next.add(id)
        try { localStorage.setItem(NOTIF_READ_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
        return next
      })
      setRemovingIds(s => { const n = new Set(s); n.delete(id); return n })
    }, 220)
  }, [])

  const handleMarkAllRead = useCallback(() => {
    setReadIds(prev => {
      const next = new Set(prev)
      unreadItems.forEach(i => next.add(i.id))
      try { localStorage.setItem(NOTIF_READ_KEY, JSON.stringify([...next])) } catch { /* ignore */ }
      return next
    })
  }, [unreadItems])

  const handleMarkAllUnread = useCallback(() => {
    setReadIds(new Set())
    try { localStorage.removeItem(NOTIF_READ_KEY) } catch { /* ignore */ }
  }, [])

  return {
    unreadItems,
    unreadCount: unreadItems.length,
    removingIds,
    hasRead: readIds.size > 0,
    handleMarkRead,
    handleMarkAllRead,
    handleMarkAllUnread,
  }
}

/** Bell FAB — toggles the slide-out panel and shows the unread badge. Positioning/state live
 *  in ScFeedView; this is purely the floating button. */
export function NotificationsFab({
  unreadCount, open, onToggleOpen, slideClass,
}: {
  unreadCount: number
  open: boolean
  onToggleOpen: () => void
  /** Tailwind class applied when the panel pushes content (e.g. 'md:-translate-x-80'). */
  slideClass?: string
}) {
  return (
    <button
      id="sc-feed-notif-fab"
      onClick={onToggleOpen}
      title={unreadCount === 0 ? 'All caught up' : `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`}
      className={`fixed bottom-24 right-6 z-30 w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200 ease-in-out shadow-lg ${
        open
          ? 'bg-primary-container text-on-primary-container'
          : unreadCount > 0
            ? 'bg-surface-container-high text-primary-container border border-primary-container/40 hover:brightness-110'
            : 'bg-surface-container-high text-on-surface-variant/60 border border-outline-variant/40 hover:text-on-surface'
      } ${slideClass ?? ''}`}
    >
      {open ? <X className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
      {!open && unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 rounded-full text-[10px] font-black flex items-center justify-center tabular-nums shadow-md ring-2 ring-surface" style={{ background: 'var(--mc-notif-badge)', color: 'var(--mc-notif-badge-fg)' }}>
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  )
}

/** Slide-out notifications panel. Fills its container (a content-shifting column on desktop,
 *  a full-screen takeover on mobile) — ScFeedView owns the positioning/animation wrappers. */
export function NotificationsPanel({
  unreadItems, unreadCount, removingIds, hasRead,
  onMarkRead, onMarkAllRead, onMarkAllUnread, onClose,
}: {
  unreadItems: NotifItem[]
  unreadCount: number
  removingIds: Set<string>
  hasRead: boolean
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
  onMarkAllUnread: () => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col h-full w-full bg-surface-container/95 backdrop-blur-md">
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary-container" />
          <span className="text-xs font-headline font-bold uppercase tracking-widest text-on-surface">Notifications</span>
          {unreadCount > 0 && (
            <span className="min-w-[1.25rem] h-5 px-1 rounded-full bg-primary-container/20 text-primary-container text-[9px] font-black flex items-center justify-center tabular-nums">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllRead}
              className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container/40 transition-colors"
              title="Mark all as read"
            >
              <CheckCheck className="w-3 h-3" />
              All read
            </button>
          )}
          {hasRead && (
            <button
              onClick={onMarkAllUnread}
              className="flex items-center gap-1 px-2 py-1 rounded text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container/40 transition-colors"
              title="Restore all as unread"
            >
              <RotateCcw className="w-3 h-3" />
              All unread
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded text-on-surface-variant/60 hover:text-on-surface transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-hidden">
        {unreadCount === 0 ? (
          <div className="glass-card rounded-xl flex flex-col items-center justify-center py-12 gap-3 text-center">
            <div className="w-14 h-14 rounded-full bg-primary-container/10 border border-primary-container/30 flex items-center justify-center">
              <CheckCheck className="w-7 h-7 text-primary-container" />
            </div>
            <p className="text-sm font-headline font-bold text-on-surface">All Caught Up!</p>
            <p className="text-[11px] font-label text-on-surface-variant/50 leading-relaxed max-w-[260px]">
              No unread notifications. New activity from your feeds will appear here.
            </p>
            {hasRead && (
              <button
                onClick={onMarkAllUnread}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant/30 bg-surface-container/30 text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/70 hover:text-on-surface hover:border-primary-container/40 hover:bg-primary-container/5 transition-colors"
                title="Restore all notifications as unread"
              >
                <RotateCcw className="w-3 h-3" />
                Mark everything unread
              </button>
            )}
          </div>
        ) : (
          unreadItems.map(item => {
            const leaving = removingIds.has(item.id)
            return (
              <div
                key={item.id}
                className={`transition-all duration-[220ms] ease-out ${
                  leaving ? 'opacity-0 max-h-0 -translate-x-4 overflow-hidden' : 'opacity-100 max-h-[600px] translate-x-0'
                }`}
                style={{ contentVisibility: 'auto', containIntrinsicSize: '0 110px' }}
              >
                <NotifCard item={item} isRead={false} onToggle={() => onMarkRead(item.id)} />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
