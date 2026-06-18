'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpDown, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  Eye, EyeOff, MoreHorizontal, RotateCcw, Rss, Sparkles, X,
} from 'lucide-react'
import type { FeedChannel, FeedMessage } from '@/app/api/sc-feed/route'
import { ALL_TRACKER_KEYS, CUSTOM_RSS_ID, FEED_DESCRIPTIONS, LEAKS_CHANNEL_ID, MOTD_CHANNEL_IDS, MOTD_LOBBY_URLS, PILL, SAVED_ID, TRACKER_CATS, TWITCH_CREATORS_ID, YT_CREATORS_ID, useFeedPrefs, type ColumnHeight, type ColumnWidth } from './sc-feed-types'
import { formatLocalTime, getTrackerCatKey, groupByWindow, timeAgo } from './sc-feed-utils'
import { GroupedCard, MessageCard } from './sc-feed-message-card'
import { RsiStatusCard } from './sc-feed-notifications'

const REVERSED_KEY = 'sc-feed-column-reversed'
const UNREAD_ONLY_KEY = 'sc-feed-show-unread-only'
const SHOW_MOTD_KEY = 'sc-feed-show-motd'

function useReversed(feedId: string): [boolean, () => void] {
  const [reversed, setReversedState] = useState(false)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(REVERSED_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, boolean>
        if (parsed[feedId]) setReversedState(true)
      }
    } catch { /**/ }
  }, [feedId])
  const toggle = useCallback(() => {
    setReversedState(prev => {
      const next = !prev
      try {
        const stored = localStorage.getItem(REVERSED_KEY)
        const parsed = stored ? JSON.parse(stored) as Record<string, boolean> : {}
        localStorage.setItem(REVERSED_KEY, JSON.stringify({ ...parsed, [feedId]: next }))
      } catch { /**/ }
      return next
    })
  }, [feedId])
  return [reversed, toggle]
}

function useShowUnreadOnly(feedId: string): [boolean, () => void] {
  const [val, setVal] = useState(false)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(UNREAD_ONLY_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, boolean>
        if (parsed[feedId]) setVal(true)
      }
    } catch { /**/ }
  }, [feedId])
  const toggle = useCallback(() => {
    setVal(prev => {
      const next = !prev
      try {
        const stored = localStorage.getItem(UNREAD_ONLY_KEY)
        const parsed = stored ? JSON.parse(stored) as Record<string, boolean> : {}
        localStorage.setItem(UNREAD_ONLY_KEY, JSON.stringify({ ...parsed, [feedId]: next }))
      } catch { /**/ }
      return next
    })
  }, [feedId])
  return [val, toggle]
}

function useShowMotd(): [boolean, (v: boolean) => void] {
  const [val, setVal] = useState(true)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SHOW_MOTD_KEY)
      if (stored !== null) setVal(stored === 'true')
    } catch { /**/ }
  }, [])
  const set = useCallback((next: boolean) => {
    setVal(next)
    try { localStorage.setItem(SHOW_MOTD_KEY, String(next)) } catch { /**/ }
  }, [])
  return [val, set]
}

type KebabItem =
  | { label: string; icon?: React.ElementType; onClick: () => void; active?: boolean; keepOpen?: boolean }
  | { type: 'section'; label: string; options: Array<{ label: string; active: boolean; onClick: () => void }> }
  | { type: 'toggleList'; label: string; options: Array<{ key: string; label: string; active: boolean; onClick: () => void; icon?: React.ElementType; iconCls?: string }> }
  | { type: 'separator' }

function KebabMenu({ items }: { items: KebabItem[] }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number; maxHeight: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Compute fixed-position coords from button rect; updated on scroll/resize while open.
  // Dropdown is portaled to document.body so the parent column's overflow:hidden can't clip it.
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const btn = buttonRef.current
      if (!btn) return
      const rect = btn.getBoundingClientRect()
      const gap = 4
      // If there's < 220px below the button, anchor above it instead (flip up).
      const spaceBelow = window.innerHeight - rect.bottom - 8
      const spaceAbove = rect.top - 8
      const flipUp = spaceBelow < 220 && spaceAbove > spaceBelow
      setPos({
        top: flipUp ? Math.max(8, rect.top - 8) : rect.bottom + gap,
        right: window.innerWidth - rect.right,
        maxHeight: Math.max(160, flipUp ? spaceAbove - gap : spaceBelow),
      })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handle = (e: MouseEvent) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="p-1 rounded text-on-surface-variant/30 hover:text-on-surface-variant transition-colors shrink-0"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>
      {open && pos && createPortal(
        <div
          ref={dropdownRef}
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, right: pos.right, maxHeight: pos.maxHeight }}
          className="z-[60] bg-surface-container-high border border-outline-variant/40 rounded-lg shadow-xl py-1 min-w-[200px] overflow-y-auto"
        >
          {items.map((item, i) => {
            if ('type' in item && item.type === 'separator') {
              return <div key={i} className="my-1 border-t border-outline-variant/20" />
            }
            if ('type' in item && item.type === 'section') {
              return (
                <div key={i} className="px-3 py-1.5">
                  <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/40 mb-1.5">{item.label}</p>
                  <div className="flex gap-1">
                    {item.options.map((opt, j) => (
                      <button
                        key={j}
                        onClick={opt.onClick}
                        className={`flex-1 py-1 rounded text-[10px] font-label font-black transition-colors border ${
                          opt.active
                            ? 'bg-primary-container/15 text-primary-container border-primary-container/30'
                            : 'bg-surface-container text-on-surface-variant/40 hover:text-on-surface-variant border-transparent'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            }
            if ('type' in item && item.type === 'toggleList') {
              return (
                <div key={i} className="px-2 py-1.5">
                  <p className="px-1 text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/40 mb-1">{item.label}</p>
                  <div className="space-y-0.5">
                    {item.options.map(opt => {
                      const Icon = opt.icon
                      return (
                        <button
                          key={opt.key}
                          onClick={opt.onClick}
                          className={`w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] font-label font-black text-left transition-colors ${
                            opt.active
                              ? 'text-on-surface hover:bg-surface-container'
                              : 'text-on-surface-variant/30 hover:text-on-surface-variant hover:bg-surface-container'
                          }`}
                        >
                          {Icon && <Icon className={`w-2.5 h-2.5 shrink-0 ${opt.iconCls ?? ''}`} />}
                          <span className="flex-1 truncate">{opt.label}</span>
                          <span className={`relative w-7 h-3.5 rounded-full transition-colors duration-150 shrink-0 ${opt.active ? 'bg-primary-container' : 'bg-surface-container'}`}>
                            <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform duration-150 ${opt.active ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            }
            const Icon = item.icon
            return (
              <button
                key={i}
                onClick={() => { item.onClick(); if (!item.keepOpen) setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-label font-black text-left transition-colors ${
                  item.active
                    ? 'text-primary-container bg-primary-container/5 hover:bg-primary-container/10'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                }`}
              >
                {Icon && <Icon className="w-3 h-3 shrink-0" />}
                {item.label}
              </button>
            )
          })}
        </div>,
        document.body
      )}
    </>
  )
}

function GhostMessageList({ messages, fading, channelId, lastSeen }: {
  messages: FeedMessage[]
  fading: boolean
  channelId: string
  lastSeen: string | null | undefined
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(id) }, [])

  return (
    <div className={`space-y-1.5 transition-opacity duration-300 ${fading ? 'opacity-0' : 'opacity-50'}`}>
      {messages.map((msg, idx) => (
        <div
          key={msg.id}
          className="transition-all duration-300 ease-out"
          style={{
            transform: mounted ? 'translateY(0)' : 'translateY(-20px)',
            opacity: mounted ? 1 : 0,
            transitionDelay: `${idx * 200}ms`,
          }}
        >
          <MessageCard msg={msg} blurred={false} channelId={channelId} lastSeen={lastSeen} />
        </div>
      ))}
    </div>
  )
}

export function ChannelFeed({ channel, isLeaks, revealed, lastSeen, enabledCategories, globalSearch, isReadMsg, onMarkRead, onMarkAllRead, onClearAllRead, onToggleLeaks, onToggleCategory, colWidth, colHeight, onSetWidth, onSetHeight }: {
  channel: FeedChannel
  isLeaks: boolean
  revealed: boolean
  lastSeen: string | null | undefined
  enabledCategories: Set<string>
  globalSearch: string
  isReadMsg: (msgId: string, tsRaw?: string | null) => boolean
  onMarkRead: (msgId: string, tsRaw?: string | null) => void
  onMarkAllRead: () => void
  onClearAllRead: () => void
  onToggleLeaks?: () => void
  onToggleCategory: (key: string) => void
  colWidth: ColumnWidth
  colHeight: ColumnHeight
  onSetWidth: (w: ColumnWidth) => void
  onSetHeight: (h: ColumnHeight) => void
}) {
  const { dateFormat, hideAllRead } = useFeedPrefs()
  const blurred = isLeaks && !revealed
  const updatedAt = formatLocalTime(channel.updated_at)
  const isTrackerSC = channel.id === 'cig-news'
  const isMotd = MOTD_CHANNEL_IDS.has(channel.id)
  const [showUnreadOnly, toggleShowUnreadOnly] = useShowUnreadOnly(channel.id)
  const [reversed, toggleReversed] = useReversed(channel.id)
  const [descOpen, setDescOpen] = useState(false)

  // Doubt easter egg state (rsi-status only)
  const [doubtClicks, setDoubtClicks] = useState(0)
  const [ghostMessages, setGhostMessages] = useState<FeedMessage[]>([])
  const [ghostVisible, setGhostVisible] = useState(false)
  const [ghostFading, setGhostFading] = useState(false)
  const ghostTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (ghostTimerRef.current) clearTimeout(ghostTimerRef.current) }, [])

  const handleDoubtClick = useCallback(async () => {
    const next = doubtClicks + 1
    setDoubtClicks(next)
    if (next < 3) return
    setDoubtClicks(0)
    try {
      const res = await fetch('/api/sc-feed/rsi-history')
      const msgs: FeedMessage[] = await res.json()
      if (!msgs.length) return
      setGhostMessages(msgs)
      setGhostFading(false)
      setGhostVisible(true)
      if (ghostTimerRef.current) clearTimeout(ghostTimerRef.current)
      ghostTimerRef.current = setTimeout(() => {
        setGhostFading(true)
        setTimeout(() => { setGhostVisible(false); setGhostFading(false) }, 300)
      }, 4700)
    } catch { /* silent */ }
  }, [doubtClicks])

  const statusDotColor = channel.error ? 'bg-red-400'
    : channel.id === 'sc-motd' ? 'bg-blue-400'
      : MOTD_CHANNEL_IDS.has(channel.id) ? 'bg-green-400'
        : 'bg-green-400'

  let visibleMessages = channel.messages
  if (isTrackerSC) {
    visibleMessages = visibleMessages.filter(msg => {
      const key = getTrackerCatKey(msg.source)
      return !key || enabledCategories.has(key)
    })
  }
  if (globalSearch.trim()) {
    const q = globalSearch.toLowerCase()
    visibleMessages = visibleMessages.filter(m =>
      m.title.toLowerCase().includes(q) ||
      (m.body ?? '').toLowerCase().includes(q) ||
      m.source.toLowerCase().includes(q)
    )
  }

  const unreadCount = visibleMessages.filter(m => !isReadMsg(m.id, m.ts_raw)).length
  const displayMessages = (showUnreadOnly || hideAllRead) ? visibleMessages.filter(m => !isReadMsg(m.id, m.ts_raw)) : visibleMessages
  const grouped = isMotd ? displayMessages : groupByWindow(displayMessages)
  const orderedItems = reversed ? [...grouped].reverse() : grouped

  const description = FEED_DESCRIPTIONS[channel.id]

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-outline-variant/30 bg-surface-container/40">
        <div
          onClick={() => setDescOpen(o => !o)}
          className="px-4 py-3 flex items-center gap-2 cursor-pointer hover:bg-surface-container/30 transition-colors"
        >
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDotColor}`} />
          <h2 className="text-xs font-label font-black uppercase tracking-widest text-on-surface whitespace-nowrap">{channel.label}</h2>
          <span className="text-[10px] font-mono text-on-surface-variant/40">{visibleMessages.length}</span>
        <div className="ml-auto flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
          {updatedAt && (
            <span className="text-[10px] font-mono text-on-surface-variant/40 hidden sm:block whitespace-nowrap cursor-default shrink-0" title={updatedAt}>
              {timeAgo(channel.updated_at, dateFormat)}
            </span>
          )}
          <button
            onClick={() => unreadCount > 0 ? toggleShowUnreadOnly() : undefined}
            title={unreadCount > 0 ? (showUnreadOnly ? 'Show all' : 'Show unread only') : undefined}
            className={`min-w-[20px] h-5 px-1.5 rounded-full text-[9px] font-black tabular-nums flex items-center justify-center transition-colors ${
              showUnreadOnly
                ? 'bg-primary-container text-on-primary-container'
                : unreadCount > 0
                  ? 'bg-primary-container/20 text-primary-container hover:bg-primary-container/30 cursor-pointer'
                  : 'bg-surface-container text-on-surface-variant/25 cursor-default'
            }`}
          >
            {unreadCount}
          </button>
          <KebabMenu items={[
            unreadCount === 0
              ? { label: 'Mark all unread', icon: RotateCcw, onClick: onClearAllRead }
              : { label: 'Mark all read', icon: CheckCheck, onClick: onMarkAllRead },
            { label: showUnreadOnly ? 'Show all' : 'Hide read', icon: showUnreadOnly ? Eye : EyeOff, onClick: toggleShowUnreadOnly, active: showUnreadOnly },
            { label: reversed ? 'Newest first' : 'Oldest first', icon: ArrowUpDown, onClick: toggleReversed, active: reversed },
            ...(isLeaks && onToggleLeaks ? [{ label: revealed ? 'Blur Leaks' : 'Reveal Leaks', icon: revealed ? EyeOff : Eye, onClick: onToggleLeaks, active: revealed }] : []),
            { type: 'separator' as const },
            { type: 'section' as const, label: 'Height', options: [
              { label: 'Full', active: colHeight === 'full', onClick: () => onSetHeight('full') },
              { label: 'Half', active: colHeight === 'half', onClick: () => onSetHeight('half') },
              { label: '1/3', active: colHeight === 'third', onClick: () => onSetHeight('third') },
              { label: '1/4', active: colHeight === 'quarter', onClick: () => onSetHeight('quarter') },
            ]},
            { type: 'section' as const, label: 'Width', options: [
              { label: 'Narrow', active: colWidth === 'narrow', onClick: () => onSetWidth('narrow') },
              { label: 'Medium', active: colWidth === 'medium', onClick: () => onSetWidth('medium') },
              { label: 'Wide', active: colWidth === 'wide', onClick: () => onSetWidth('wide') },
            ]},
            ...(isTrackerSC ? [
              { type: 'separator' as const },
              ...ALL_TRACKER_KEYS.map(key => ({
                label: TRACKER_CATS[key].label,
                icon: TRACKER_CATS[key].icon,
                active: enabledCategories.has(key),
                keepOpen: true,
                onClick: () => onToggleCategory(key),
              })),
            ] : []),
          ]} />
        </div>
        </div>
        {descOpen && description && (
          <div className="px-4 pt-3 pb-3 text-[11px] font-body text-on-surface-variant/50 leading-relaxed border-t border-outline-variant/15">
            {description}
          </div>
        )}
      </div>
      {channel.rsiStatus && (
        <RsiStatusCard rsiStatus={channel.rsiStatus} />
      )}

      <div className="flex-1 overflow-y-auto min-h-0 p-2.5 space-y-1.5">
        {channel.error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-12">
            <Rss className="w-6 h-6 text-on-surface-variant/30" />
            <p className="text-xs font-label text-on-surface-variant/50">Feed unavailable</p>
          </div>
        ) : ghostVisible && ghostMessages.length > 0 ? (
          <GhostMessageList
            messages={ghostMessages}
            fading={ghostFading}
            channelId={channel.id}
            lastSeen={lastSeen}
          />
        ) : grouped.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
            {channel.id === 'rsi-status' ? (
              <>
                <p className="text-xs font-label text-on-surface-variant/50">No Interruptions in the last 15 days.</p>
                <div className="mt-4 flex flex-col items-center gap-2">
                  <p className="text-xs font-label text-on-surface-variant/30">Smash if you...</p>
                  <button
                    onClick={handleDoubtClick}
                    className="flex items-center gap-2 opacity-40 hover:opacity-60 transition-opacity"
                  >
                    <div className="w-7 h-7 rounded-full bg-blue-900/60 border border-blue-700/30 flex items-center justify-center shrink-0">
                      <X className="w-4 h-4 text-blue-400/60" />
                    </div>
                    <span className="text-sm font-headline font-black text-on-surface-variant/70 tracking-wide">Doubt</span>
                  </button>
                </div>
              </>
            ) : channel.id === YT_CREATORS_ID || channel.id === TWITCH_CREATORS_ID || channel.id === CUSTOM_RSS_ID ? (
              <>
                <Rss className="w-6 h-6 text-on-surface-variant/30" />
                <p className="text-xs font-label text-on-surface-variant/50">No sources added yet</p>
                <p className="text-[11px] font-label text-on-surface-variant/35 leading-relaxed max-w-[220px]">
                  Open <span className="text-primary-container/80 font-black">Settings</span> and scroll to <span className="text-primary-container/80 font-black">Custom Feeds</span> to add{' '}
                  {channel.id === YT_CREATORS_ID ? 'YouTube channels' : channel.id === TWITCH_CREATORS_ID ? 'Twitch streamers' : 'RSS feeds'}.
                </p>
              </>
            ) : (
              <>
                <Rss className="w-6 h-6 text-on-surface-variant/30" />
                <p className="text-xs font-label text-on-surface-variant/50">
                  {isTrackerSC && visibleMessages.length === 0 && channel.messages.length > 0
                    ? 'All categories hidden'
                    : isMotd ? 'No MOTD yet'
                      : 'No messages yet'}
                </p>
              </>
            )}
          </div>
        ) : (
          orderedItems.map((item, idx) =>
            'type' in item ? (
              <GroupedCard
                key={`group-${idx}`}
                messages={item.messages}
                blurred={blurred}
                channelId={channel.id}
                lastSeen={lastSeen}
                isReadMsg={isReadMsg}
                onMarkRead={onMarkRead}
              />
            ) : (
              <MessageCard
                key={item.id}
                msg={item}
                blurred={blurred}
                channelId={channel.id}
                lastSeen={lastSeen}
                isRead={isReadMsg(item.id, item.ts_raw)}
                onMarkRead={() => onMarkRead(item.id, item.ts_raw)}
              />
            )
          )
        )}
      </div>
    </div>
  )
}

export const UnifiedMotdFeed = memo(function UnifiedMotdFeed({
  messages, globalSearch, isReadMsg, onMarkRead, onMarkAllRead, onClearAllRead, colWidth, colHeight, onSetWidth, onSetHeight,
}: {
  messages: Array<FeedMessage & { _channelId: string; _motdLabels: string[] }>
  globalSearch: string
  isReadMsg: (channelId: string, msgId: string, tsRaw?: string | null) => boolean
  onMarkRead: (channelId: string, msgId: string) => void
  onMarkAllRead: () => void
  onClearAllRead: () => void
  colWidth: ColumnWidth
  colHeight: ColumnHeight
  onSetWidth: (w: ColumnWidth) => void
  onSetHeight: (h: ColumnHeight) => void
}) {
  const { hideAllRead } = useFeedPrefs()
  const [showUnreadOnly, toggleShowUnreadOnly] = useShowUnreadOnly('motd')
  const [reversed, toggleReversed] = useReversed('motd')
  const [descOpen, setDescOpen] = useState(false)
  let filtered = messages
  if (globalSearch.trim()) {
    const q = globalSearch.toLowerCase()
    filtered = filtered.filter(m => m.title.toLowerCase().includes(q) || (m.body ?? '').toLowerCase().includes(q))
  }
  const unreadCount = filtered.filter(m => !isReadMsg(m._channelId, m.id, m.ts_raw)).length
  const baseMessages = (showUnreadOnly || hideAllRead) ? filtered.filter(m => !isReadMsg(m._channelId, m.id, m.ts_raw)) : filtered
  const displayMessages = reversed ? [...baseMessages].reverse() : baseMessages

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-outline-variant/30 bg-surface-container/40">
        <div
          onClick={() => setDescOpen(o => !o)}
          className="px-4 py-3 flex items-center gap-2 cursor-pointer hover:bg-surface-container/30 transition-colors"
        >
            <span className="w-2 h-2 rounded-full shrink-0 bg-amber-400" />
            <h2 className="text-xs font-label font-black uppercase tracking-widest text-on-surface whitespace-nowrap">MOTD</h2>
            <span className="text-[10px] font-mono text-on-surface-variant/40">{filtered.length}</span>
          <div className="ml-auto flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => unreadCount > 0 ? toggleShowUnreadOnly() : undefined}
              title={unreadCount > 0 ? (showUnreadOnly ? 'Show all' : 'Show unread only') : undefined}
              className={`min-w-[20px] h-5 px-1.5 rounded-full text-[9px] font-black tabular-nums flex items-center justify-center transition-colors ${
                showUnreadOnly
                  ? 'bg-primary-container text-on-primary-container'
                  : unreadCount > 0
                    ? 'bg-primary-container/20 text-primary-container hover:bg-primary-container/30 cursor-pointer'
                    : 'bg-surface-container text-on-surface-variant/25 cursor-default'
              }`}
            >
              {unreadCount}
            </button>
            <KebabMenu items={[
              unreadCount === 0
                ? { label: 'Mark all unread', icon: RotateCcw, onClick: onClearAllRead }
                : { label: 'Mark all read', icon: CheckCheck, onClick: onMarkAllRead },
              { label: showUnreadOnly ? 'Show all' : 'Hide read', icon: showUnreadOnly ? Eye : EyeOff, onClick: toggleShowUnreadOnly, active: showUnreadOnly },
              { label: reversed ? 'Newest first' : 'Oldest first', icon: ArrowUpDown, onClick: toggleReversed, active: reversed },
              { type: 'separator' as const },
              { type: 'section' as const, label: 'Height', options: [
                { label: 'Full', active: colHeight === 'full', onClick: () => onSetHeight('full') },
                { label: 'Half', active: colHeight === 'half', onClick: () => onSetHeight('half') },
                { label: '1/3', active: colHeight === 'third', onClick: () => onSetHeight('third') },
                { label: '1/4', active: colHeight === 'quarter', onClick: () => onSetHeight('quarter') },
              ]},
              { type: 'section' as const, label: 'Width', options: [
                { label: 'Narrow', active: colWidth === 'narrow', onClick: () => onSetWidth('narrow') },
                { label: 'Medium', active: colWidth === 'medium', onClick: () => onSetWidth('medium') },
                { label: 'Wide', active: colWidth === 'wide', onClick: () => onSetWidth('wide') },
              ]},
            ]} />
          </div>
        </div>
        {descOpen && (
          <div className="px-4 pt-3 pb-3 text-[11px] font-body text-on-surface-variant/50 leading-relaxed border-t border-outline-variant/15">
            {FEED_DESCRIPTIONS['__motd_unified']}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 p-2.5 space-y-1.5">
        {displayMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-12">
            <Rss className="w-6 h-6 text-on-surface-variant/30" />
            <p className="text-xs font-label text-on-surface-variant/50">No MOTD yet</p>
          </div>
        ) : (
          displayMessages.map(msg => (
            <MessageCard
              key={`${msg._channelId}-${msg.id}`}
              msg={msg}
              blurred={false}
              channelId={msg._channelId}
              lastSeen={undefined}
              motdLabels={msg._motdLabels}
              isRead={isReadMsg(msg._channelId, msg.id, msg.ts_raw)}
              onMarkRead={() => onMarkRead(msg._channelId, msg.id)}
            />
          ))
        )}
      </div>
    </div>
  )
})

export const UnifiedOmniFeed = memo(function UnifiedOmniFeed({
  channels, enabledCategories, leaksRevealed, lastSeen, motdMessages,
  globalSearch, isReadMsg, onMarkRead, onMarkAllRead, onClearAllRead, colWidth, colHeight, onSetWidth, onSetHeight,
  omniSourceToggles, onToggleOmniSource, onToggleCategory,
}: {
  channels: FeedChannel[]
  enabledCategories: Set<string>
  leaksRevealed: boolean
  lastSeen: string | null | undefined
  motdMessages: Array<FeedMessage & { _channelId: string; _motdLabels: string[] }>
  globalSearch: string
  isReadMsg: (channelId: string, msgId: string, tsRaw?: string | null) => boolean
  onMarkRead: (channelId: string, msgId: string) => void
  onMarkAllRead: () => void
  onClearAllRead: () => void
  colWidth: ColumnWidth
  colHeight: ColumnHeight
  onSetWidth: (w: ColumnWidth) => void
  onSetHeight: (h: ColumnHeight) => void
  omniSourceToggles: Record<string, boolean>
  onToggleOmniSource: (id: string) => void
  onToggleCategory: (key: string) => void
}) {
  const { dateFormat, hideAllRead } = useFeedPrefs()
  const [motdIndex, setMotdIndex] = useState(0)
  const [motdCollapsed, setMotdCollapsed] = useState(false)
  const [showMotdSection, setShowMotdSection] = useShowMotd()
  const [showUnreadOnly, toggleShowUnreadOnly] = useShowUnreadOnly('omni')
  const [reversed, toggleReversed] = useReversed('omni')
  const [descOpen, setDescOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastScrollTopRef = useRef(0)
  const touchStartX = useRef<number | null>(null)

  const isReadM = useCallback((m: { _channelId: string; id: string; ts_raw?: string | null }) =>
    isReadMsg(m._channelId, m.id, m.ts_raw), [isReadMsg])

  const markRead = useCallback((m: { _channelId: string; id: string }) =>
    onMarkRead(m._channelId, m.id), [onMarkRead])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const st = scrollRef.current.scrollTop
    if (st > lastScrollTopRef.current + 5 && st > 20) setMotdCollapsed(true)
    else if (st <= 10) setMotdCollapsed(false)
    lastScrollTopRef.current = st
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  const dedupedMotd = motdMessages

  const clampedIdx = dedupedMotd.length > 0
    ? Math.min(motdIndex, dedupedMotd.length - 1)
    : 0

  const prevMotd = () => { if (clampedIdx > 0) setMotdIndex(clampedIdx - 1) }
  const nextMotd = () => { if (clampedIdx < dedupedMotd.length - 1) setMotdIndex(clampedIdx + 1) }

  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const diff = touchStartX.current - e.changedTouches[0].clientX
    if (Math.abs(diff) > 40) { if (diff > 0) nextMotd(); else prevMotd() }
    touchStartX.current = null
  }

  // Exclude MOTD (its own carousel) and the personal Saved list (a bookmark column, not news).
  const omniSources = channels.filter(c => !MOTD_CHANNEL_IDS.has(c.id) && c.id !== SAVED_ID)

  const allMessages = omniSources
    .filter(c => omniSourceToggles[c.id] !== false)
    .flatMap(ch => ch.messages.map(m => ({ ...m, _channelId: ch.id })))
    .filter(m => {
      if (m._channelId !== 'cig-news') return true
      const key = getTrackerCatKey(m.source)
      return !key || enabledCategories.has(key)
    })
    .sort((a, b) => (b.ts_raw ?? '').localeCompare(a.ts_raw ?? ''))

  const filtered = globalSearch.trim()
    ? allMessages.filter(m => {
      const q = globalSearch.toLowerCase()
      return m.title.toLowerCase().includes(q) ||
        (m.body ?? '').toLowerCase().includes(q) ||
        m.source.toLowerCase().includes(q)
    })
    : allMessages

  const unreadCount = filtered.filter(m => !isReadM(m)).length
  const baseMessages = (showUnreadOnly || hideAllRead) ? filtered.filter(m => !isReadM(m)) : filtered
  const displayMessages = reversed ? [...baseMessages].reverse() : baseMessages

  const currentMotd = dedupedMotd[clampedIdx]
  const currentMotdRead = currentMotd ? isReadM(currentMotd) : false

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="shrink-0 border-b border-outline-variant/30 bg-surface-container/40">
        <div
          onClick={() => setDescOpen(o => !o)}
          className="px-4 py-3 flex items-center gap-2 cursor-pointer hover:bg-surface-container/30 transition-colors"
        >
            <span className="w-2 h-2 rounded-full shrink-0 bg-primary-container/60" />
            <h2 className="text-xs font-label font-black uppercase tracking-widest text-on-surface whitespace-nowrap">Omni Feed</h2>
            <span className="text-[10px] font-mono text-on-surface-variant/40">{filtered.length}</span>
          <div className="ml-auto flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => unreadCount > 0 ? toggleShowUnreadOnly() : undefined}
              title={unreadCount > 0 ? (showUnreadOnly ? 'Show all' : 'Show unread only') : undefined}
              className={`min-w-[20px] h-5 px-1.5 rounded-full text-[9px] font-black tabular-nums flex items-center justify-center transition-colors ${
                showUnreadOnly
                  ? 'bg-primary-container text-on-primary-container'
                  : unreadCount > 0
                    ? 'bg-primary-container/20 text-primary-container hover:bg-primary-container/30 cursor-pointer'
                    : 'bg-surface-container text-on-surface-variant/25 cursor-default'
              }`}
            >
              {unreadCount}
            </button>
            <KebabMenu items={[
              unreadCount === 0
                ? { label: 'Mark all unread', icon: RotateCcw, onClick: onClearAllRead }
                : { label: 'Mark all read', icon: CheckCheck, onClick: onMarkAllRead },
              { label: showUnreadOnly ? 'Show all' : 'Hide read', icon: showUnreadOnly ? Eye : EyeOff, onClick: toggleShowUnreadOnly, active: showUnreadOnly },
              { label: reversed ? 'Newest first' : 'Oldest first', icon: ArrowUpDown, onClick: toggleReversed, active: reversed },
              { label: showMotdSection ? 'Hide MOTD' : 'Show MOTD', icon: Sparkles, onClick: () => setShowMotdSection(!showMotdSection), active: showMotdSection },
              { type: 'separator' as const },
              { type: 'toggleList' as const, label: 'Sources in OmniFeed', options: omniSources.map(c => ({
                key: c.id,
                label: c.label,
                active: omniSourceToggles[c.id] !== false,
                onClick: () => onToggleOmniSource(c.id),
              })) },
              { type: 'separator' as const },
              { type: 'toggleList' as const, label: 'SC Tracker Categories', options: ALL_TRACKER_KEYS.map(key => {
                const cat = TRACKER_CATS[key]
                return {
                  key,
                  label: cat.label,
                  icon: cat.icon,
                  active: enabledCategories.has(key),
                  onClick: () => onToggleCategory(key),
                }
              }) },
              { type: 'separator' as const },
              { type: 'section' as const, label: 'Height', options: [
                { label: 'Full', active: colHeight === 'full', onClick: () => onSetHeight('full') },
                { label: 'Half', active: colHeight === 'half', onClick: () => onSetHeight('half') },
                { label: '1/3', active: colHeight === 'third', onClick: () => onSetHeight('third') },
                { label: '1/4', active: colHeight === 'quarter', onClick: () => onSetHeight('quarter') },
              ]},
              { type: 'section' as const, label: 'Width', options: [
                { label: 'Narrow', active: colWidth === 'narrow', onClick: () => onSetWidth('narrow') },
                { label: 'Medium', active: colWidth === 'medium', onClick: () => onSetWidth('medium') },
                { label: 'Wide', active: colWidth === 'wide', onClick: () => onSetWidth('wide') },
              ]},
            ]} />
          </div>
        </div>
        {descOpen && (
          <div className="px-4 pt-3 pb-3 text-[11px] font-body text-on-surface-variant/50 leading-relaxed border-t border-outline-variant/15">
            {FEED_DESCRIPTIONS['__omni_feed']}
          </div>
        )}
      </div>

      {/* MOTD carousel — pinned, collapsible */}
      {showMotdSection && dedupedMotd.length > 0 && (
        <div className="shrink-0 border-b border-amber-400/20 bg-amber-400/[0.04]">

          {/* Collapse header */}
          <div className="grid grid-cols-3 items-center px-4 py-2 select-none">
            <div />
            <div className="flex items-center justify-center gap-2">
              <Sparkles className="w-3 h-3 text-amber-400/60" />
              <span className="text-xs font-label font-black uppercase tracking-widest text-amber-300">MOTD</span>
              <span className="text-[10px] font-mono text-on-surface-variant/30">{dedupedMotd.length}</span>
            </div>
            <div className="flex items-center gap-1.5 justify-end">
              {currentMotd && (
                <button
                  onClick={() => markRead(currentMotd)}
                  title={currentMotdRead ? 'Mark unread' : 'Mark as read'}
                  className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all duration-200 ${
                    currentMotdRead
                      ? 'border-primary-container/60 text-primary-container'
                      : 'border-outline-variant/30 text-transparent hover:border-primary-container/50 hover:text-primary-container/50'
                  }`}
                >
                  <Check className="w-2.5 h-2.5" />
                </button>
              )}
              <button onClick={() => setMotdCollapsed(c => !c)}
                className="p-1 rounded text-amber-400/60 hover:text-amber-400 transition-colors">
                {motdCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Carousel content — animated collapse via grid-rows trick */}
          <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${motdCollapsed ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}>
            <div className="overflow-hidden min-h-0">
              {currentMotd && (
                <div className={`select-none transition-opacity duration-200 ${currentMotdRead ? 'opacity-50 hover:opacity-100' : ''}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                  <div key={clampedIdx} className="px-4 pb-1">
                    <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                      {currentMotd._motdLabels.map(label => (
                        <span key={label} className={`${PILL} ${label === 'SC MOTD'
                            ? 'border-blue-400/40 bg-blue-400/10 text-blue-300'
                            : 'border-green-400/40 bg-green-400/10 text-green-300'
                          }`}>
                          {label === 'SC MOTD' ? 'SC Testing' : 'ETF Testing'}
                        </span>
                      ))}
                      <span className="ml-auto text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/30 shrink-0">
                        {timeAgo(currentMotd.ts_raw ?? null, dateFormat)}
                      </span>
                    </div>
                    <p className="text-[13px] font-headline font-black text-on-surface leading-snug line-clamp-2 mb-1">
                      {currentMotd.title}
                    </p>
                    {currentMotd.body && currentMotd.body !== currentMotd.title && (
                      <p className="text-[11px] text-on-surface-variant/55 leading-relaxed line-clamp-3">
                        {currentMotd.body.replace(/[#*_`[\]]/g, '').trim()}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {currentMotd.url && (
                        <a href={currentMotd.url} target="_blank" rel="noopener noreferrer"
                          className={`${PILL} border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 transition-colors`}>
                          Message
                        </a>
                      )}
                      {MOTD_LOBBY_URLS[currentMotd._channelId] && (
                        <a href={MOTD_LOBBY_URLS[currentMotd._channelId]} target="_blank" rel="noopener noreferrer"
                          className={`${PILL} border-outline-variant/40 bg-surface-container/60 text-on-surface-variant/60 hover:text-on-surface transition-colors`}>
                          Chat
                        </a>
                      )}
                    </div>
                  </div>
                  {dedupedMotd.length > 1 && (
                    <div className="flex items-center justify-between px-2 py-1.5">
                      <button onClick={prevMotd} disabled={clampedIdx === 0}
                        className="p-1 rounded text-on-surface-variant/40 hover:text-on-surface disabled:opacity-20 transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <div className="flex items-center gap-1.5">
                        {dedupedMotd.map((_, i) => (
                          <button key={i} onClick={() => setMotdIndex(i)}
                            className={`rounded-full transition-all ${i === clampedIdx
                                ? 'w-4 h-1.5 bg-amber-400/70'
                                : 'w-1.5 h-1.5 bg-on-surface-variant/20 hover:bg-on-surface-variant/40'
                              }`}
                          />
                        ))}
                      </div>
                      <button onClick={nextMotd} disabled={clampedIdx === dedupedMotd.length - 1}
                        className="p-1 rounded text-on-surface-variant/40 hover:text-on-surface disabled:opacity-20 transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 p-2.5 space-y-1.5">
        {displayMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center py-12">
            <Rss className="w-6 h-6 text-on-surface-variant/30" />
            <p className="text-xs font-label text-on-surface-variant/50">
              {showUnreadOnly ? 'All caught up' : globalSearch ? 'No messages match' : 'No messages yet'}
            </p>
          </div>
        ) : (
          displayMessages.map(msg => (
            <MessageCard
              key={`${msg._channelId}-${msg.id}`}
              msg={msg}
              blurred={msg._channelId === LEAKS_CHANNEL_ID && !leaksRevealed}
              channelId={msg._channelId}
              lastSeen={lastSeen}
              isRead={isReadM(msg)}
              onMarkRead={() => markRead(msg)}
            />
          ))
        )}
      </div>

    </div>
  )
})
