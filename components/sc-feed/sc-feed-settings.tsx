'use client'

import { useState } from 'react'
import { Bell, BellOff, BellRing, BookmarkPlus, CheckCheck, Check, ClipboardPaste, Copy, Eye, EyeOff, GripVertical, LayoutTemplate, Loader2, Moon, Plus, Rss, RotateCcw, Save, Send, Sparkles, Sun, Trash2, Tv, X, Youtube } from 'lucide-react'
import { CURRENT_VERSION } from '@/lib/patch-notes'
import type { FeedChannel } from '@/app/api/sc-feed/route'
import { type LayoutPreset, type UserYTChannel, type UserTwitchStreamer, type UserRSSFeed, MAX_YT_CHANNELS, MAX_TWITCH_STREAMERS, MAX_RSS_FEEDS } from './sc-feed-types'
import { getFeedLabel } from './sc-feed-utils'

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
      <div>
        <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">Theme</p>
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
      </div>

      {/* Date Format */}
      <div>
        <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">Date Format</p>
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
      </div>

      {/* Display */}
      <div>
        <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">Display</p>
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
      </div>

      {/* Push Notifications — sits under Display */}
      {pushSupported && (
        <div>
          <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">Push Notifications</p>
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
        </div>
      )}

      {/* Leaks toggle */}
      <div>
        <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">Leaks</p>
        <button onClick={onToggleLeaks}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-left">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-label font-black ${leaksRevealed ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
            {leaksRevealed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            Reveal Leaks
          </span>
        </button>
      </div>

      {/* Read state toggle — 2 cols when wide enough, collapse to 1 when narrow */}
      <div>
        <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">Read State</p>
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
      </div>

      {/* Layout Presets */}
      <div>
        <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">Layout Presets</p>

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
      </div>

      {/* Feed Layout */}
      <div>
        <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">Feed Layout</p>
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
      </div>

      {/* Custom Feeds — user-configurable sources, kept at the bottom */}
      <div className="pt-4 border-t border-outline-variant/20 space-y-5">
        <p className="text-[10px] font-label font-black uppercase tracking-[0.2em] text-primary-container/70">Custom Feeds</p>

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

      {/* About — version + What's New */}
      <div>
        <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">About</p>
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
      </div>

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
