'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, BellOff, BellRing, BookmarkPlus, CheckCheck, Check, ChevronDown, ClipboardPaste, Copy, Download, Eye, EyeOff, GripVertical, LayoutTemplate, Loader2, Moon, Plus, Rss, RotateCcw, Save, Send, Sparkles, Sun, Trash2, Tv, Volume2, VolumeX, X, Youtube } from 'lucide-react'
import { CURRENT_VERSION } from '@/lib/patch-notes'
import type { FeedChannel } from '@/app/api/sc-feed/route'
import { type LayoutPreset, type UserYTChannel, type UserTwitchStreamer, type UserRSSFeed, MAX_YT_CHANNELS, MAX_TWITCH_STREAMERS, MAX_RSS_FEEDS, NOTIF_MUTED_KEY, NOTIF_VOLUME_KEY, NOTIF_VOLUME_DEFAULT } from './sc-feed-types'
import { getFeedLabel } from './sc-feed-utils'
import { previewChime } from './sc-feed-notifications'

const COLLAPSE_KEY = 'sc-feed-settings-collapsed'

/** Collapsible settings section. The label row toggles; children hide when collapsed. */
function Section({ id, title, open, onToggle, accent, children }: {
  id: string
  title: string
  open: boolean
  onToggle: (id: string) => void
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <button onClick={() => onToggle(id)} className="w-full flex items-center justify-between mb-2 group">
        <span className={`font-label font-black uppercase transition-colors ${accent
          ? 'text-[10px] tracking-[0.2em] text-primary-container/70 group-hover:text-primary-container'
          : 'text-[9px] tracking-widest text-on-surface-variant/50 group-hover:text-on-surface-variant/80'}`}>
          {title}
        </span>
        <ChevronDown className={`w-3 h-3 shrink-0 text-on-surface-variant/30 group-hover:text-on-surface-variant/60 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && children}
    </div>
  )
}

export function SettingsPanel({
  channels,
  columnOrder,
  onReorder,
  hiddenChannels, onToggleChannel,
  leaksRevealed, onToggleLeaks,
  showTabBar, onToggleTabBar,
  theme, onSetTheme,
  dateFormat, onSetDateFormat,
  hideAllRead, onToggleHideAllRead,
  onMarkAllRead, onMarkAllUnread,
  layoutPresets, onSavePreset, onApplyPreset, onDeletePreset, onOverwritePreset, onExportLayout, onImportLayout,
  pushSupported, pushEnabled, pushPermission, pushPending, pushError, pushTestPending, pushTestStatus, onTogglePush, onTestPush,
  userYTChannels, onAddYT, onRemoveYT,
  userTwitchStreamers, onAddTwitch, onRemoveTwitch,
  userRSSFeeds, onAddRSS, onRemoveRSS,
  onOpenPatchNotes,
  showInstall, onInstall,
}: {
  channels: FeedChannel[]
  columnOrder: string[] | null
  onReorder: (newOrder: string[]) => void
  hiddenChannels: Set<string>; onToggleChannel: (id: string) => void
  leaksRevealed: boolean; onToggleLeaks: () => void
  showTabBar: boolean; onToggleTabBar: () => void
  theme: 'dark' | 'light'; onSetTheme: (t: 'dark' | 'light') => void
  dateFormat: 'short' | 'long'; onSetDateFormat: (f: 'short' | 'long') => void
  hideAllRead: boolean; onToggleHideAllRead: () => void
  onMarkAllRead: () => void
  onMarkAllUnread: () => void
  layoutPresets: LayoutPreset[]
  onSavePreset: (name: string) => void
  onApplyPreset: (preset: LayoutPreset) => void
  onDeletePreset: (id: string) => void
  onOverwritePreset: (id: string) => void
  onExportLayout: () => string
  onImportLayout: (text: string) => boolean
  pushSupported: boolean
  pushEnabled: boolean
  pushPermission: NotificationPermission
  pushPending: boolean
  pushError: string | null
  pushTestPending: boolean
  pushTestStatus: 'idle' | 'sent' | 'error'
  onTogglePush: () => void
  onTestPush: () => void
  userYTChannels: UserYTChannel[]
  onAddYT: (input: string) => Promise<string | null>
  onRemoveYT: (channelId: string) => void
  userTwitchStreamers: UserTwitchStreamer[]
  onAddTwitch: (login: string) => Promise<string | null>
  onRemoveTwitch: (login: string) => void
  userRSSFeeds: UserRSSFeed[]
  onAddRSS: (url: string) => Promise<string | null>
  onRemoveRSS: (url: string) => void
  onOpenPatchNotes: () => void
  showInstall: boolean
  onInstall: () => void
}) {
  const order = columnOrder ?? []
  const [markedAllRead, setMarkedAllRead] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetNameInput, setPresetNameInput] = useState('')
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState(false)
  const [copied, setCopied] = useState(false)

  // Collapsible-section state (persisted). Loaded in an effect to avoid a hydration mismatch;
  // the panel is hidden (width 0) until opened, so there's no visible flash.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    try { setCollapsed(new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]'))) } catch { /* ignore */ }
  }, [])
  const toggleSection = useCallback((id: string) => {
    setCollapsed(prev => {
      const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id)
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...n])) } catch { /* ignore */ }
      return n
    })
  }, [])
  const isOpen = (id: string) => !collapsed.has(id)

  // Notification sound — mute + volume (read by playChime in sc-feed-notifications via localStorage).
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(NOTIF_VOLUME_DEFAULT)
  useEffect(() => {
    try {
      setMuted(localStorage.getItem(NOTIF_MUTED_KEY) === 'true')
      const raw = localStorage.getItem(NOTIF_VOLUME_KEY)
      if (raw != null) { const v = parseFloat(raw); if (Number.isFinite(v)) setVolume(Math.min(1, Math.max(0, v))) }
    } catch { /* ignore */ }
  }, [])
  const setMutedPref = (m: boolean) => {
    setMuted(m)
    try { localStorage.setItem(NOTIF_MUTED_KEY, String(m)) } catch { /* ignore */ }
    if (!m) previewChime(volume) // un-muting previews the current level
  }
  const setVolumePref = (v: number) => {
    setVolume(v)
    try { localStorage.setItem(NOTIF_VOLUME_KEY, String(v)) } catch { /* ignore */ }
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) return
    const next = [...order]
    const from = next.indexOf(draggedId)
    const to = next.indexOf(targetId)
    if (from < 0 || to < 0) return
    next.splice(from, 1)
    next.splice(to, 0, draggedId)
    onReorder(next)
    setDraggedId(null)
    setDragOverId(null)
  }

  return (
    <div className="@container w-full h-full overflow-y-auto p-4 space-y-5">

      {/* Theme — top of settings. Light mode plays a "SOLAR FLARE!" audio cue on switch. */}
      <Section id="theme" title="Theme" open={isOpen('theme')} onToggle={toggleSection}>
        <div className="flex gap-1">
          {([
            { value: 'dark' as const, label: 'Dark', Icon: Moon },
            { value: 'light' as const, label: 'Light', Icon: Sun },
          ]).map(({ value, label, Icon }) => (
            <button key={value} onClick={() => onSetTheme(value)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-1 rounded text-[10px] font-label font-black transition-colors border ${
                theme === value
                  ? 'bg-primary-container/15 text-primary-container border-primary-container/30'
                  : 'bg-surface-container text-on-surface-variant/40 hover:text-on-surface-variant border-transparent'
              }`}>
              <Icon className="w-3 h-3" />
              {label}
            </button>
          ))}
        </div>
      </Section>

      {/* Date Format */}
      <Section id="date" title="Date Format" open={isOpen('date')} onToggle={toggleSection}>
        <div className="flex gap-1">
          {(['short', 'long'] as const).map(f => (
            <button key={f} onClick={() => onSetDateFormat(f)}
              className={`flex-1 py-1 rounded text-[10px] font-label font-black transition-colors border ${
                dateFormat === f
                  ? 'bg-primary-container/15 text-primary-container border-primary-container/30'
                  : 'bg-surface-container text-on-surface-variant/40 hover:text-on-surface-variant border-transparent'
              }`}>
              {f === 'short' ? '5h / 2d' : '2d 5h'}
            </button>
          ))}
        </div>
      </Section>

      {/* Display */}
      <Section id="display" title="Display" open={isOpen('display')} onToggle={toggleSection}>
        <button
          onClick={onToggleTabBar}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-left"
        >
          <span className={`text-[11px] font-label font-black ${showTabBar ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
            Show Feed Tab Bar
          </span>
          <span className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${showTabBar ? 'bg-primary-container' : 'bg-surface-container'}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${showTabBar ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
        </button>
      </Section>

      {/* Push Notifications — sits under Display */}
      {pushSupported && (
        <Section id="push" title="Push Notifications" open={isOpen('push')} onToggle={toggleSection}>
          <button
            onClick={!pushPending && pushPermission !== 'denied' ? onTogglePush : undefined}
            disabled={pushPending || pushPermission === 'denied'}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-colors text-left ${
              pushPending || pushPermission === 'denied' ? 'opacity-60 cursor-not-allowed' : 'hover:bg-surface-container-high'
            }`}
          >
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-label font-black ${pushEnabled && !pushPending ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
              {pushPending
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />{pushEnabled ? 'Disabling…' : 'Enabling…'}</>
                : pushEnabled
                  ? <><BellRing className="w-3.5 h-3.5" />Push notifications on</>
                  : pushPermission === 'denied'
                    ? <><BellOff className="w-3.5 h-3.5" />Blocked in browser settings</>
                    : pushPermission === 'granted'
                      ? <><BellOff className="w-3.5 h-3.5" />Push notifications off</>
                      : <><Bell className="w-3.5 h-3.5" />Enable push notifications</>
              }
            </span>
            {!pushPending && (
              <span className={`ml-auto relative w-8 h-4 rounded-full transition-colors duration-200 shrink-0 ${pushEnabled ? 'bg-primary-container' : 'bg-surface-container'}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-200 ${pushEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </span>
            )}
          </button>
          {pushError && (
            <p className="text-[10px] font-label mt-1.5 px-1 leading-snug" style={{ color: 'var(--mc-error-text)' }}>{pushError}</p>
          )}
          {pushEnabled && !pushPending && (
            <button
              onClick={onTestPush}
              disabled={pushTestPending}
              className="mt-1.5 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-high/30 hover:border-primary-container/40 hover:bg-primary-container/5 transition-colors text-left disabled:opacity-50"
              title="Send a test push to this device"
            >
              <span className="inline-flex items-center gap-1.5 text-[11px] font-label font-black text-on-surface-variant/70">
                {pushTestPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Sending…</>
                  : pushTestStatus === 'sent'
                    ? <><Check className="w-3.5 h-3.5 text-primary-container" />Sent — check your device</>
                    : <><Send className="w-3.5 h-3.5" />Send test notification</>
                }
              </span>
            </button>
          )}
        </Section>
      )}

      {/* Notification Sound — mute + volume for the new-arrival chime */}
      <Section id="sound" title="Notification Sound" open={isOpen('sound')} onToggle={toggleSection}>
        <button
          onClick={() => setMutedPref(!muted)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-left"
        >
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-label font-black ${muted ? 'text-on-surface-variant/40' : 'text-on-surface'}`}>
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            {muted ? 'Muted' : 'Sound on'}
          </span>
          <span className={`relative w-8 h-4 rounded-full transition-colors shrink-0 ${!muted ? 'bg-primary-container' : 'bg-surface-container'}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${!muted ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </span>
        </button>
        <div className={`flex items-center gap-2 px-2.5 mt-2 transition-opacity ${muted ? 'opacity-40 pointer-events-none' : ''}`}>
          <VolumeX className="w-3 h-3 text-on-surface-variant/40 shrink-0" />
          <input
            type="range" min={0} max={1} step={0.05}
            value={volume}
            onChange={e => setVolumePref(parseFloat(e.target.value))}
            onMouseUp={() => previewChime(volume)}
            onTouchEnd={() => previewChime(volume)}
            disabled={muted}
            className="flex-1 accent-[var(--mc-primary-container)] h-1 cursor-pointer"
            aria-label="Notification volume"
          />
          <Volume2 className="w-3.5 h-3.5 text-on-surface-variant/40 shrink-0" />
          <button
            onClick={() => previewChime(volume)}
            disabled={muted}
            title="Preview sound"
            className="shrink-0 p-1 rounded text-on-surface-variant/40 hover:text-primary-container hover:bg-primary-container/10 transition-colors disabled:opacity-40"
          >
            <Bell className="w-3.5 h-3.5" />
          </button>
        </div>
      </Section>

      {/* Leaks toggle */}
      <Section id="leaks" title="Leaks" open={isOpen('leaks')} onToggle={toggleSection}>
        <button onClick={onToggleLeaks}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-left">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-label font-black ${leaksRevealed ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
            {leaksRevealed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            Reveal Leaks
          </span>
        </button>
      </Section>

      {/* Read state toggle — 2 cols when wide enough, collapse to 1 when narrow */}
      <Section id="read" title="Read State" open={isOpen('read')} onToggle={toggleSection}>
        <div className="grid grid-cols-1 @[14rem]:grid-cols-2 gap-1.5">
          <button
            onClick={onToggleHideAllRead}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-high/30 hover:border-primary-container/40 hover:bg-primary-container/5 transition-colors text-left"
          >
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-label font-black ${hideAllRead ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
              {hideAllRead ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              Hide read
            </span>
          </button>
          <button
            onClick={() => {
              if (markedAllRead) { onMarkAllUnread(); setMarkedAllRead(false) }
              else { onMarkAllRead(); setMarkedAllRead(true) }
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-high/30 hover:border-primary-container/40 hover:bg-primary-container/5 transition-colors text-left"
          >
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-label font-black ${markedAllRead ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
              {markedAllRead
                ? <><RotateCcw className="w-3.5 h-3.5" />Mark unread</>
                : <><CheckCheck className="w-3.5 h-3.5" />Mark read</>
              }
            </span>
          </button>
        </div>
      </Section>

      {/* Layout Presets */}
      <Section id="presets" title="Layout Presets" open={isOpen('presets')} onToggle={toggleSection}>

        {layoutPresets.length === 0 && !savingPreset && (
          <p className="text-[10px] font-label text-on-surface-variant/25 px-1 mb-2">No saved presets</p>
        )}

        <div className="space-y-1 mb-2">
          {layoutPresets.map(preset => (
            <div key={preset.id} className="flex items-center gap-1 group">
              <button
                onClick={() => onApplyPreset(preset)}
                className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-high/30 hover:border-primary-container/40 hover:bg-primary-container/5 transition-all text-left"
              >
                <LayoutTemplate className="w-3 h-3 text-primary-container/40 shrink-0" />
                <span className="flex-1 text-[11px] font-label font-black text-on-surface truncate">{preset.name}</span>
                <span className="text-[9px] font-label font-black uppercase tracking-widest text-primary-container/0 group-hover:text-primary-container/60 transition-colors shrink-0">Apply</span>
              </button>
              {!preset.isDefault && (
                <>
                  <button
                    onClick={() => onOverwritePreset(preset.id)}
                    className="shrink-0 p-1.5 rounded text-on-surface-variant/20 hover:text-primary-container transition-colors"
                    title="Overwrite with current layout"
                  >
                    <Save className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onDeletePreset(preset.id)}
                    className="shrink-0 p-1.5 rounded text-on-surface-variant/20 transition-colors hover:[color:var(--mc-error-text)]"
                    title="Delete preset"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        {savingPreset ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={presetNameInput}
              onChange={e => setPresetNameInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && presetNameInput.trim()) {
                  onSavePreset(presetNameInput.trim())
                  setSavingPreset(false)
                  setPresetNameInput('')
                }
                if (e.key === 'Escape') { setSavingPreset(false); setPresetNameInput('') }
              }}
              placeholder="Preset name…"
              className="flex-1 bg-surface-container border border-outline-variant/30 rounded px-2 py-1 text-[11px] font-label text-on-surface placeholder:text-on-surface-variant/25 outline-none focus:border-primary-container/50 min-w-0"
            />
            <button
              onClick={() => {
                if (presetNameInput.trim()) {
                  onSavePreset(presetNameInput.trim())
                  setSavingPreset(false)
                  setPresetNameInput('')
                }
              }}
              disabled={!presetNameInput.trim()}
              className="shrink-0 px-2 py-1 rounded text-[10px] font-label font-black bg-primary-container/15 text-primary-container border border-primary-container/30 disabled:opacity-30 transition-opacity"
            >
              Save
            </button>
            <button
              onClick={() => { setSavingPreset(false); setPresetNameInput('') }}
              className="shrink-0 p-1 rounded text-on-surface-variant/30 hover:text-on-surface-variant transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setSavingPreset(true)}
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-high/30 transition-colors text-on-surface-variant/35 hover:text-on-surface-variant"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span className="text-[11px] font-label font-black">Save current layout</span>
          </button>
        )}

        {/* Export / Import the current layout as portable JSON */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <button
            onClick={async () => {
              try { await navigator.clipboard.writeText(onExportLayout()); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
            }}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-high/30 transition-colors text-on-surface-variant/35 hover:text-on-surface-variant"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="text-[11px] font-label font-black">{copied ? 'Copied!' : 'Export'}</span>
          </button>
          <button
            onClick={() => { setImporting(v => !v); setImportError(false) }}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-outline-variant/20 hover:border-outline-variant/40 hover:bg-surface-container-high/30 transition-colors text-on-surface-variant/35 hover:text-on-surface-variant"
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            <span className="text-[11px] font-label font-black">Import</span>
          </button>
        </div>
        {importing && (
          <div className="mt-1.5 space-y-1.5">
            <textarea
              autoFocus
              value={importText}
              onChange={e => { setImportText(e.target.value); setImportError(false) }}
              placeholder="Paste layout JSON…"
              rows={4}
              className={`w-full bg-surface-container border rounded px-2 py-1.5 text-[10px] font-mono text-on-surface placeholder:text-on-surface-variant/25 outline-none resize-y ${importError ? 'border-red-500/50' : 'border-outline-variant/30 focus:border-primary-container/50'}`}
            />
            {importError && <p className="text-[10px] font-label text-red-400 px-0.5">Invalid layout JSON.</p>}
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  if (onImportLayout(importText.trim())) { setImporting(false); setImportText('') }
                  else setImportError(true)
                }}
                disabled={!importText.trim()}
                className="flex-1 px-2 py-1 rounded text-[10px] font-label font-black bg-primary-container/15 text-primary-container border border-primary-container/30 disabled:opacity-30 transition-opacity"
              >
                Apply
              </button>
              <button
                onClick={() => { setImporting(false); setImportText(''); setImportError(false) }}
                className="shrink-0 px-2 py-1 rounded text-[10px] font-label font-black text-on-surface-variant/40 hover:text-on-surface-variant transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>

      {/* Feed Layout */}
      <Section id="layout" title="Feed Layout" open={isOpen('layout')} onToggle={toggleSection}>
        <div className="space-y-1.5">
          {order.map(id => {
            const label = getFeedLabel(id, channels)
            const visible = !hiddenChannels.has(id)
            const isDragging = draggedId === id
            const isDragOver = dragOverId === id && !isDragging

            return (
              <div
                key={id}
                draggable
                onDragStart={() => setDraggedId(id)}
                onDragEnd={() => { setDraggedId(null); setDragOverId(null) }}
                onDragOver={e => { e.preventDefault(); setDragOverId(id) }}
                onDrop={() => handleDrop(id)}
                className={`flex items-center gap-1.5 px-1.5 py-2 rounded-lg border transition-all select-none ${
                  isDragOver
                    ? 'border-primary-container/50 bg-primary-container/5'
                    : 'border-outline-variant/20 bg-surface-container-high/30'
                } ${isDragging ? 'opacity-40' : ''}`}
              >
                <div className="shrink-0 text-on-surface-variant/20 hover:text-on-surface-variant/50 transition-colors cursor-grab">
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
                <span className={`flex-1 text-[12px] font-label font-black truncate ${visible ? 'text-on-surface' : 'text-on-surface-variant/25 line-through'}`}>
                  {label}
                </span>
                <button
                  onClick={() => onToggleChannel(id)}
                  className={`shrink-0 p-1 rounded transition-colors ${visible ? 'text-primary-container/50 hover:text-primary-container' : 'text-on-surface-variant/20 hover:text-on-surface-variant/50'}`}
                >
                  {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Custom Feeds — user-configurable sources, kept at the bottom */}
      <div className="pt-4 border-t border-outline-variant/20">
        <Section id="custom" title="Custom Feeds" open={isOpen('custom')} onToggle={toggleSection} accent>
          <div className="space-y-5">
        <UserChannelSection
          title="YouTube Creators"
          icon={Youtube}
          items={userYTChannels.map(c => ({ key: c.channelId, label: c.name, sublabel: c.channelId }))}
          max={MAX_YT_CHANNELS}
          placeholder="@handle, channel URL, or UC…"
          onAdd={onAddYT}
          onRemove={key => onRemoveYT(key)}
        />

        <UserChannelSection
          title="Twitch Creators"
          icon={Tv}
          items={userTwitchStreamers.map(s => ({ key: s.login, label: s.displayName ?? s.login, sublabel: s.login }))}
          max={MAX_TWITCH_STREAMERS}
          placeholder="streamer login (e.g. subliminalstv)"
          onAdd={onAddTwitch}
          onRemove={key => onRemoveTwitch(key)}
        />

        <UserChannelSection
          title="Custom RSS Feeds"
          icon={Rss}
          items={userRSSFeeds.map(f => ({ key: f.url, label: f.label, sublabel: f.url }))}
          max={MAX_RSS_FEEDS}
          placeholder="https://example.com/feed.xml"
          onAdd={onAddRSS}
          onRemove={key => onRemoveRSS(key)}
        />
          </div>
        </Section>
      </div>

      {/* App — install + What's New */}
      <Section id="about" title="App" open={isOpen('about')} onToggle={toggleSection}>
        {showInstall && (
          <button
            onClick={onInstall}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 mb-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-high/30 hover:border-primary-container/40 hover:bg-primary-container/5 transition-colors text-left"
          >
            <span className="inline-flex items-center gap-2 text-[11px] font-label font-black text-on-surface">
              <Download className="w-3.5 h-3.5 text-primary-container" />
              Install app
            </span>
          </button>
        )}
        <button
          onClick={onOpenPatchNotes}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-left"
        >
          <span className="inline-flex items-center gap-2 text-[11px] font-label font-black text-on-surface">
            <Sparkles className="w-3.5 h-3.5 text-primary-container" />
            What&apos;s New
          </span>
          <span className="text-[10px] font-mono text-on-surface-variant/50">v{CURRENT_VERSION}</span>
        </button>
      </Section>

    </div>
  )
}

function UserChannelSection({
  title, icon: Icon, items, max, placeholder, onAdd, onRemove,
}: {
  title: string
  icon: React.ElementType
  items: Array<{ key: string; label: string; sublabel?: string }>
  max: number
  placeholder: string
  onAdd: (input: string) => Promise<string | null>
  onRemove: (key: string) => void
}) {
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const atLimit = items.length >= max

  const submit = async () => {
    const v = input.trim()
    if (!v || pending || atLimit) return
    setPending(true)
    setError(null)
    const err = await onAdd(v)
    setPending(false)
    if (err) setError(err)
    else setInput('')
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 flex items-center gap-1.5">
          <Icon className="w-3 h-3" /> {title}
        </p>
        <span className="text-[9px] font-label text-on-surface-variant/30 tabular-nums">{items.length} / {max}</span>
      </div>

      {items.length > 0 && (
        <div className="space-y-1 mb-2">
          {items.map(it => (
            <div key={it.key} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-high/30">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-label font-black text-on-surface truncate">{it.label}</p>
                {it.sublabel && it.sublabel !== it.label && (
                  <p className="text-[9px] font-label text-on-surface-variant/40 truncate">{it.sublabel}</p>
                )}
              </div>
              <button
                onClick={() => onRemove(it.key)}
                className="shrink-0 p-1 rounded text-on-surface-variant/25 transition-colors hover:[color:var(--mc-error-text)]"
                title="Remove"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!atLimit && (
        <div className="flex items-center gap-1.5">
          <input
            value={input}
            onChange={e => { setInput(e.target.value); if (error) setError(null) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); submit() }
              if (e.key === 'Escape') { setInput(''); setError(null) }
            }}
            placeholder={placeholder}
            disabled={pending}
            className="flex-1 bg-surface-container border border-outline-variant/30 rounded px-2 py-1 text-[11px] font-label text-on-surface placeholder:text-on-surface-variant/25 outline-none focus:border-primary-container/50 min-w-0 disabled:opacity-50"
          />
          <button
            onClick={submit}
            disabled={!input.trim() || pending}
            className="shrink-0 p-1 rounded text-primary-container disabled:opacity-30 hover:bg-primary-container/10 transition-colors"
            title="Add"
          >
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {error && (
        <p className="text-[10px] font-label mt-1.5 px-1 leading-snug" style={{ color: 'var(--mc-error-text)' }}>{error}</p>
      )}
    </div>
  )
}
