'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import remarkGfm from 'remark-gfm'

const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false, loading: () => null })
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Expand, ExternalLink, Film, Music, Sparkles, X } from 'lucide-react'
import type { FeedMessage } from '@/app/api/sc-feed/route'
import { PILL, PIPELINE_CHANNEL_IDS, TRACKER_CATS, useFeedPrefs } from './sc-feed-types'
import { formatLocalTime, getSourceInfo, getTrackerCatKey, normalizeBodyMarkdown, stripDiscordMarkdown, timeAgo } from './sc-feed-utils'
import { KbDiffButton } from './sc-feed-kb-diff-modal'

export function PillsRow({ pills, className = '' }: {
  pills: { key: string; node: React.ReactNode }[]
  className?: string
}) {
  const ghostRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    const ghost = ghostRef.current
    const container = containerRef.current
    if (!ghost || !container || expanded) { setVisibleCount(pills.length); return }
    if (pills.length === 0) { setVisibleCount(0); return }

    const GAP = 4   // gap-1 = 4px
    const CHIP = 30 // reserved width for "+N" button

    const compute = () => {
      const containerW = container.getBoundingClientRect().width
      if (containerW === 0) return
      const pillEls = Array.from(ghost.children) as HTMLElement[]
      if (pillEls.length !== pills.length) return
      const widths = pillEls.map(el => el.getBoundingClientRect().width)
      const total = widths.reduce((s, w) => s + w, 0) + GAP * (widths.length - 1)
      if (total <= containerW + 1) { setVisibleCount(pills.length); return }
      let used = 0, n = 0
      for (let i = 0; i < widths.length; i++) {
        const next = used + (n > 0 ? GAP : 0) + widths[i]
        const hasMore = i < widths.length - 1
        if (next + (hasMore ? GAP + CHIP : 0) <= containerW + 1) { used = next; n++ }
        else break
      }
      setVisibleCount(Math.max(0, n))
    }

    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(container)
    return () => ro.disconnect()
  }, [expanded, pills.length])

  if (!pills.length) return null
  const measured = visibleCount !== null
  const displayPills = expanded ? pills : (measured ? pills.slice(0, visibleCount!) : pills)
  const overflow = measured && !expanded ? pills.length - visibleCount! : 0

  return (
    <div className={`relative ${className}`}>
      {/* Ghost layer — invisible, out of flow, always has all pills for measurement */}
      <div ref={ghostRef} className="absolute invisible pointer-events-none flex items-center gap-1" aria-hidden="true">
        {pills.map(p => <span key={p.key} className="inline-flex shrink-0">{p.node}</span>)}
      </div>
      <div ref={containerRef} className={`flex items-center gap-1 ${expanded ? 'flex-wrap' : 'flex-nowrap overflow-hidden'}`}>
        {displayPills.map(p => <span key={p.key} className="inline-flex shrink-0">{p.node}</span>)}
        {overflow > 0 && (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(true) }}
            className={`shrink-0 ${PILL} border-outline-variant/30 bg-surface-container text-on-surface-variant/40 hover:text-on-surface-variant hover:border-outline-variant cursor-pointer`}
          >
            +{overflow}
          </button>
        )}
      </div>
    </div>
  )
}

export function CompactRow({ msg, blurred, channelId, lastSeen, isRead, onMarkRead, hidePills }: {
  msg: FeedMessage; blurred: boolean; channelId: string; lastSeen?: string | null
  isRead?: boolean; onMarkRead?: () => void; hidePills?: boolean
}) {
  const isNew = typeof lastSeen === 'string' && msg.ts_raw ? msg.ts_raw > lastSeen : false
  const isPipeline = PIPELINE_CHANNEL_IDS.has(channelId)
  const isTrackerSC = channelId === 'cig-news'
  const trackerKey = isTrackerSC ? getTrackerCatKey(msg.source) : undefined
  const trackerCat = trackerKey ? TRACKER_CATS[trackerKey] : undefined
  const sourceInfo = getSourceInfo(msg.url)
  const showSource = sourceInfo && msg.url && !(trackerCat && sourceInfo.label === trackerCat.label)
  const dest = msg.url || msg.discord_jump_url
  const cleanTitle = stripDiscordMarkdown(msg.title ?? '')

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (blurred || !dest) return
    if ((e.target as HTMLElement).closest('a, button')) return
    window.open(dest, '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      onClick={handleClick}
      className={`relative px-2.5 py-2 flex items-start gap-2 transition-all ${dest && !blurred ? 'cursor-pointer hover:bg-surface-container/60' : ''
        } ${blurred ? 'blur-sm select-none' : ''} ${isRead ? 'opacity-50 hover:opacity-100' : ''}`}
    >
      {onMarkRead ? (
        <button
          onClick={e => { e.stopPropagation(); onMarkRead() }}
          title={isRead ? 'Mark as unread' : 'Mark as read'}
          className={`absolute top-2 right-2 z-10 w-4 h-4 rounded-full flex items-center justify-center border transition-all duration-200 ${isRead
            ? 'border-primary-container/60 text-primary-container'
            : 'border-outline-variant/30 text-transparent hover:border-primary-container/50 hover:text-primary-container/50'
          }`}
        >
          <Check className="w-2 h-2" />
        </button>
      ) : (
        isNew && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary-container shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {msg.url ? (
          <a href={msg.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
            className="text-[13px] font-headline font-black text-on-surface hover:text-primary-container transition-colors leading-snug block">
            {cleanTitle}
          </a>
        ) : (
          <p className="text-[13px] font-headline font-black text-on-surface leading-snug">{cleanTitle}</p>
        )}
        {!hidePills && (() => {
          type P = { key: string; node: React.ReactNode }
          const pills: P[] = []
          if (isTrackerSC) pills.push({ key: 'tsc', node: <a href="https://www.trackersc.com/" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`${PILL} border-outline-variant/40 bg-surface-container text-on-surface-variant/60 hover:text-on-surface hover:border-outline-variant`}>Tracker SC</a> })
          if (trackerCat) { const Icon = trackerCat.icon; pills.push({ key: 'cat', node: <span className={`${PILL} ${trackerCat.cls}`}><Icon className="w-2.5 h-2.5" />{trackerCat.label}</span> }) }
          if (showSource) pills.push({ key: 'src', node: <a href={msg.url!} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`${PILL} ${sourceInfo!.cls}`}>{sourceInfo!.label}</a> })
          if (msg.kbDiff) pills.push({ key: 'kbdiff', node: <KbDiffButton msg={msg} /> })
          if (msg.discord_jump_url && !isTrackerSC) pills.push({ key: 'disc', node: <a href={msg.discord_jump_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`${PILL} border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20`}>{isPipeline ? 'Pipeline' : 'Post'}</a> })
          return pills.length > 0 ? <PillsRow pills={pills} className="mt-0.5" /> : null
        })()}
      </div>
    </div>
  )
}

export function GroupedCard({ messages, blurred, channelId, lastSeen, isReadMsg, onMarkRead }: {
  messages: FeedMessage[]; blurred: boolean; channelId: string; lastSeen?: string | null
  isReadMsg?: (msgId: string, tsRaw?: string | null) => boolean
  onMarkRead?: (msgId: string, tsRaw?: string | null) => void
}) {
  const { dateFormat } = useFeedPrefs()
  const newest = messages[messages.length - 1]
  const timeLabel = timeAgo(newest.ts_raw ?? null, dateFormat) || newest.timestamp
  const isGroupRead = !!isReadMsg && messages.every(m => isReadMsg(m.id, m.ts_raw))
  function toggleGroupRead() {
    if (!onMarkRead || !isReadMsg) return
    messages.forEach(m => { if (isGroupRead === isReadMsg(m.id, m.ts_raw)) onMarkRead(m.id, m.ts_raw) })
  }

  // Compute shared pills once for the footer
  const isPipeline = PIPELINE_CHANNEL_IDS.has(channelId)
  const isTrackerSC = channelId === 'cig-news'
  const newestTrackerKey = isTrackerSC ? getTrackerCatKey(newest.source) : undefined
  const newestTrackerCat = newestTrackerKey ? TRACKER_CATS[newestTrackerKey] : undefined
  const newestSourceInfo = getSourceInfo(newest.url)
  const showNewestSource = newestSourceInfo && newest.url && !(newestTrackerCat && newestSourceInfo.label === newestTrackerCat.label)
  type P = { key: string; node: React.ReactNode }
  const footerPills: P[] = []
  if (newest.tag) {
    const tagCls = newest.tag === 'Patch Notes'
      ? 'border-green-500/40 bg-green-500/10 text-green-400'
      : newest.tag === 'LIVE'
        ? 'border-[#9146FF]/60 bg-[#9146FF]/15 text-[#bb91ff] animate-pulse'
        : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
    footerPills.push({ key: 'tag', node: <span className={`${PILL} ${tagCls}`}>{newest.tag}</span> })
  }
  if (isTrackerSC) footerPills.push({ key: 'tsc', node: <a href="https://www.trackersc.com/" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`${PILL} border-outline-variant/40 bg-surface-container text-on-surface-variant/60 hover:text-on-surface hover:border-outline-variant`}>Tracker SC</a> })
  if (newestTrackerCat) { const Icon = newestTrackerCat.icon; footerPills.push({ key: 'cat', node: <span className={`${PILL} ${newestTrackerCat.cls}`}><Icon className="w-2.5 h-2.5" />{newestTrackerCat.label}</span> }) }
  if (showNewestSource && !newest.tag) footerPills.push({ key: 'src', node: <a href={newest.url!} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`${PILL} ${newestSourceInfo!.cls}`}>{newestSourceInfo!.label}</a> })
  if (newest.kbDiff) footerPills.push({ key: 'kbdiff', node: <KbDiffButton msg={newest} /> })
  if (newest.discord_jump_url && !isTrackerSC) footerPills.push({ key: 'disc', node: <a href={newest.discord_jump_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`${PILL} border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20`}>{isPipeline ? 'Pipeline' : 'Post'}</a> })

  return (
    <article className={`rounded-xl bg-surface-container-low border border-outline-variant/40 overflow-hidden hover:border-outline-variant/70 transition-all ${isGroupRead ? 'opacity-50 hover:opacity-100' : ''}`}>
      <div className="divide-y divide-outline-variant/15">
        {messages.map(msg => (
          <CompactRow
            key={msg.id}
            msg={msg}
            blurred={blurred}
            channelId={channelId}
            lastSeen={lastSeen}
            isRead={!isGroupRead && isReadMsg?.(msg.id, msg.ts_raw)}
            hidePills
          />
        ))}
      </div>
      <div className="px-2.5 py-1.5 border-t border-outline-variant/25 flex items-center gap-1.5 bg-surface-container/30">
        <PillsRow pills={footerPills} className="flex-1 min-w-0" />
        <span className="shrink-0 text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/40 whitespace-nowrap">{messages.length} posts · {timeLabel}</span>
        {onMarkRead && (
          <button
            onClick={toggleGroupRead}
            title={isGroupRead ? 'Mark group unread' : 'Mark group read'}
            className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center border transition-all duration-200 ${
              isGroupRead
                ? 'border-primary-container/60 text-primary-container'
                : 'border-outline-variant/30 text-transparent hover:border-primary-container/50 hover:text-primary-container/50'
            }`}
          >
            <Check className="w-2.5 h-2.5" />
          </button>
        )}
      </div>
    </article>
  )
}

export function MessageCard({ msg, blurred, channelId, lastSeen, motdLabels, isRead, onMarkRead }: {
  msg: FeedMessage; blurred: boolean; channelId?: string; lastSeen?: string | null
  motdLabels?: string[]
  isRead?: boolean
  onMarkRead?: () => void
}) {
  const { dateFormat } = useFeedPrefs()
  const [imgError, setImgError] = useState(false)
  const [imgIndex, setImgIndex] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const images = (() => {
    if (!msg.image) return [] as string[]
    if (msg.image.startsWith('[')) {
      try { return JSON.parse(msg.image) as string[] } catch { /**/ }
    }
    return [msg.image]
  })()

  const isAudioUrl = (url: string) => /\.(mp3|ogg|wav|flac|aac|m4a)(\?|$)/i.test(url)
  const isMediaUrl = (url: string) => /\.(mp4|webm|mov|mp3|ogg|wav|flac|aac|m4a)(\?|$)/i.test(url)
  const isMultiMedia = images.length > 1 && images.every(isMediaUrl)
  const isAllAudio = isMultiMedia && images.every(isAudioUrl)
  const isSingleAudio = images.length === 1 && isAudioUrl(images[0])
  const ytId = msg.url?.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([^&\s/?]+)/)?.[1] ?? null

  useEffect(() => { setImgError(false) }, [imgIndex])

  useEffect(() => {
    if (!lightboxOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false)
      if (e.key === 'ArrowRight') setLightboxIndex(i => Math.min(images.length - 1, i + 1))
      if (e.key === 'ArrowLeft') setLightboxIndex(i => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxOpen, images.length])

  const [swipeX, setSwipeX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)
  const swipeActive = useRef(false)
  const SWIPE_THRESHOLD = 60

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
    swipeActive.current = false
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current
    if (!swipeActive.current) {
      if (Math.abs(dy) > Math.abs(dx)) return
      if (Math.abs(dx) > 6) swipeActive.current = true
    }
    if (swipeActive.current && dx < 0) {
      setSwiping(true)
      setSwipeX(Math.max(dx, -80))
    }
  }
  const handleTouchEnd = () => {
    if (swipeX < -SWIPE_THRESHOLD) onMarkRead?.()
    setSwiping(false)
    setSwipeX(0)
    swipeActive.current = false
  }

  const [isTruncated, setIsTruncated] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  const hasBody = msg.body && msg.body !== msg.title && msg.body.trim().length > 0
  const processedBody = useMemo(
    () => msg.body ? normalizeBodyMarkdown(expanded ? msg.body : msg.body.slice(0, 600)) : '',
    [expanded, msg.body]
  )
  const cleanTitle = stripDiscordMarkdown(msg.title ?? '')
  const displayTime = formatLocalTime(msg.ts_raw ?? null)
  const timeLabel = timeAgo(msg.ts_raw ?? null, dateFormat) || displayTime || msg.timestamp
  const isPipeline = PIPELINE_CHANNEL_IDS.has(channelId ?? '')
  const isTrackerSC = channelId === 'cig-news'
  const trackerKey = isTrackerSC ? getTrackerCatKey(msg.source) : undefined
  const trackerCat = trackerKey ? TRACKER_CATS[trackerKey] : undefined
  const sourceInfo = getSourceInfo(msg.url)
  const showSource = sourceInfo && msg.url && !(trackerCat && sourceInfo.label === trackerCat.label)
  const isNew = typeof lastSeen === 'string' && msg.ts_raw ? msg.ts_raw > lastSeen : false

  const dest = !blurred ? (msg.url || msg.discord_jump_url) : undefined
  const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!dest) return
    if ((e.target as HTMLElement).closest('a, button')) return
    window.open(dest, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    const el = bodyRef.current
    if (!el || expanded) return
    const check = () => setIsTruncated(el.scrollHeight > el.clientHeight + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [expanded, msg.body])

  return (
  <>
    {/* Swipe-to-mark-read wrapper — outer clips the slide, middle carries the transform */}
    <div className="relative overflow-hidden rounded-xl">
      {onMarkRead && (
        <div className={`absolute inset-y-0 right-0 w-16 flex items-center justify-center transition-opacity duration-75 ${swipeX < -10 ? 'opacity-100' : 'opacity-0'}`}>
          <Check className={`w-5 h-5 transition-all duration-75 ${swipeX < -SWIPE_THRESHOLD ? 'text-green-400 scale-125' : 'text-green-400/40'}`} />
        </div>
      )}
      <div
        onTouchStart={onMarkRead ? handleTouchStart : undefined}
        onTouchMove={onMarkRead ? handleTouchMove : undefined}
        onTouchEnd={onMarkRead ? handleTouchEnd : undefined}
        onTouchCancel={onMarkRead ? handleTouchEnd : undefined}
        style={{ transform: `translateX(${swipeX}px)`, transition: swiping ? 'none' : 'transform 0.25s ease-out' }}
      >
    <article
      onClick={handleCardClick}
      className={`relative rounded-xl bg-surface-container-low border border-outline-variant/40 overflow-hidden transition-all ${dest ? 'cursor-pointer hover:border-outline-variant/70' : 'hover:border-outline-variant/70'
        } ${isRead ? 'opacity-50 hover:opacity-100' : ''}`}
    >
      {blurred && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <span className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 px-3 text-center leading-relaxed">Reveal Leaks<br/>in Settings</span>
        </div>
      )}
      {(isMultiMedia || isSingleAudio) && (
        <div className={`px-2.5 pt-2.5 pb-1 ${blurred ? 'blur-sm select-none' : ''}`}>
          {msg.url ? (
            <a href={msg.url} target="_blank" rel="noopener noreferrer"
               onClick={e => e.stopPropagation()}
               className="block group">
              <span className="text-[15px] font-headline font-black text-on-surface leading-snug group-hover:text-primary-container transition-colors">
                {cleanTitle}
              </span>
            </a>
          ) : (
            <p className="text-[15px] font-headline font-black text-on-surface leading-snug">{cleanTitle}</p>
          )}
        </div>
      )}
      {images.length > 0 && !imgError && (() => {
        const currentImage = images[imgIndex]
        const isRedditPost = isTrackerSC && trackerKey === 'Reddit'
        const isSubredditIcon = isRedditPost && (
          currentImage.includes('redditmedia.com') ||
          currentImage.includes('thumbs.reddit') ||
          currentImage.includes('/subreddit-icon')
        )
        if (isSubredditIcon) {
          return (
            <div className="px-2.5 py-1.5 border-b border-outline-variant/10">
              <span className="text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/40">
                r/starcitizen
              </span>
            </div>
          )
        }
        // Knowledge Base and Dev Tracker posts use site logos (Zendesk/RSI opengraph) — skip them
        const isSourceLogo = isTrackerSC && trackerKey !== 'Reddit' && (
          currentImage.includes('theme.zdassets.com') ||
          currentImage.includes('/rsi/static/tavern/opengraph')
        )
        if (isSourceLogo) return null
        // Multiple video/audio attachments — audio: first two inline players, rest as chips; video: all chips
        if (isMultiMedia) {
          const discordUrl = msg.discord_jump_url
          if (isAllAudio) {
            const playable = images.slice(0, 2)
            const remaining = images.slice(2)
            return (
              <div className="border-b border-outline-variant/10">
                <div className="bg-surface-container-high divide-y divide-outline-variant/10">
                  {playable.map((audioUrl, i) => (
                    <div key={i} className="px-2.5 py-2">
                      <audio src={audioUrl} controls preload="none"
                        className="w-full h-8"
                        onError={() => setImgError(true)} />
                    </div>
                  ))}
                </div>
                {remaining.length > 0 && (
                  <div className="px-2.5 py-2 flex flex-wrap gap-1 border-t border-outline-variant/10">
                    {discordUrl && (
                      <a href={discordUrl} target="_blank" rel="noopener noreferrer"
                         onClick={e => e.stopPropagation()}
                         className="w-full flex items-center gap-1 mb-1 text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/40 hover:text-purple-400 transition-colors">
                        <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                        <span>Hear the rest on Pipeline</span>
                      </a>
                    )}
                    {remaining.map((imgUrl, i) => {
                      const filename = (() => {
                        try { return decodeURIComponent(new URL(imgUrl).pathname.split('/').pop() || '') || imgUrl }
                        catch { return imgUrl }
                      })()
                      return (
                        <a key={i}
                           href={discordUrl ?? '#'}
                           target="_blank" rel="noopener noreferrer"
                           onClick={e => e.stopPropagation()}
                           title={filename}
                           className="flex items-center gap-1 px-2 py-1 rounded bg-surface-container border border-outline-variant/20 text-[10px] font-mono text-on-surface-variant/60 hover:text-primary-container hover:border-outline-variant/50 transition-all max-w-[calc(50%-2px)] min-w-0">
                          <Music className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{filename}</span>
                        </a>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          }
          const videoPlayable = images.slice(0, 2)
          const videoRemaining = images.slice(2)
          return (
            <div className="border-b border-outline-variant/10">
              <div className="bg-surface-container-high divide-y divide-outline-variant/10">
                {videoPlayable.map((videoUrl, i) => (
                  <div key={i} className="aspect-video">
                    <video src={videoUrl} controls preload="metadata"
                      className="w-full h-full object-cover"
                      onError={() => setImgError(true)} />
                  </div>
                ))}
              </div>
              {videoRemaining.length > 0 && (
                <div className="px-2.5 py-2 flex flex-wrap gap-1 border-t border-outline-variant/10">
                  {discordUrl && (
                    <a href={discordUrl} target="_blank" rel="noopener noreferrer"
                       onClick={e => e.stopPropagation()}
                       className="w-full flex items-center gap-1 mb-1 text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/40 hover:text-purple-400 transition-colors">
                      <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                      <span>Watch the rest on Pipeline</span>
                    </a>
                  )}
                  {videoRemaining.map((imgUrl, i) => {
                    const filename = (() => {
                      try { return decodeURIComponent(new URL(imgUrl).pathname.split('/').pop() || '') || imgUrl }
                      catch { return imgUrl }
                    })()
                    return (
                      <a key={i}
                         href={discordUrl ?? '#'}
                         target="_blank" rel="noopener noreferrer"
                         onClick={e => e.stopPropagation()}
                         title={filename}
                         className="flex items-center gap-1 px-2 py-1 rounded bg-surface-container border border-outline-variant/20 text-[10px] font-mono text-on-surface-variant/60 hover:text-primary-container hover:border-outline-variant/50 transition-all max-w-[calc(50%-2px)] min-w-0">
                        <Film className="w-2.5 h-2.5 shrink-0" />
                        <span className="truncate">{filename}</span>
                      </a>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }
        // Single audio file → slim inline player
        if (isSingleAudio) {
          return (
            <div className="px-2.5 py-3 border-b border-outline-variant/10 bg-surface-container-high">
              <audio src={images[0]} controls preload="none"
                className="w-full h-8"
                onError={() => setImgError(true)} />
            </div>
          )
        }
        const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(currentImage)
        return (
          <div className="relative aspect-video overflow-hidden bg-surface-container-high group/img">
            {isVideo ? (
              <video src={currentImage} controls preload="metadata"
                className={`w-full h-full object-cover ${blurred ? 'blur-xl' : ''}`}
                onError={() => setImgError(true)} />
            ) : (
              <img src={currentImage} alt="" loading="lazy" decoding="async"
                className={`w-full h-full object-cover ${blurred ? 'blur-xl' : ''}`}
                onError={() => setImgError(true)} />
            )}
            {/* YouTube play button overlay — shown when the URL is a YouTube link */}
            {ytId && !isVideo && !blurred && (
              <a href={msg.url} target="_blank" rel="noopener noreferrer"
                 onClick={e => { e.stopPropagation(); onMarkRead?.() }}
                 className="absolute inset-0 flex items-center justify-center group/yt">
                <div className="w-14 h-10 rounded-xl bg-red-600/90 flex items-center justify-center shadow-lg group-hover/yt:bg-red-600 group-hover/yt:scale-110 transition-all">
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white ml-0.5" aria-hidden="true">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </a>
            )}
            {!blurred && !isVideo && !ytId && (
              <button
                onClick={e => { e.stopPropagation(); setLightboxIndex(imgIndex); setLightboxOpen(true) }}
                title="View full image"
                className="absolute bottom-2 right-2 z-10 p-1 rounded bg-black/60 text-white/80 hover:text-white opacity-0 group-hover/img:opacity-100 transition-opacity"
              >
                <Expand className="w-3.5 h-3.5" />
              </button>
            )}
            {images.length > 1 && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); setImgIndex(i => Math.max(0, i - 1)) }}
                  disabled={imgIndex === 0}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/60 text-white disabled:opacity-20 opacity-0 group-hover/img:opacity-100 transition-opacity"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setImgIndex(i => Math.min(images.length - 1, i + 1)) }}
                  disabled={imgIndex === images.length - 1}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/60 text-white disabled:opacity-20 opacity-0 group-hover/img:opacity-100 transition-opacity"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
                  {images.map((_, i) => (
                    <button key={i} onClick={e => { e.stopPropagation(); setImgIndex(i) }}
                      className={`rounded-full transition-all ${i === imgIndex ? 'w-3 h-1.5 bg-white/80' : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/50'}`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })()}

      {(!(isMultiMedia || isSingleAudio) || hasBody) && (
      <div className={`p-2.5 space-y-1.5 transition-all ${blurred ? 'blur-sm select-none' : ''}`}>
        {!(isMultiMedia || isSingleAudio) && (msg.url ? (
          <a href={msg.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="block group">
            <span className="text-[15px] font-headline font-black text-on-surface leading-snug group-hover:text-primary-container transition-colors">
              {cleanTitle}
            </span>
          </a>
        ) : (
          <p className="text-[15px] font-headline font-black text-on-surface leading-snug">{cleanTitle}</p>
        ))}

        {hasBody && (
          <div>
            <div
              ref={bodyRef}
              className={`${expanded ? '' : 'line-clamp-6'} text-xs font-body text-on-surface-variant/70 leading-relaxed prose prose-invert prose-xs max-w-none [&_a]:text-primary-container [&_a:hover]:underline [&_p]:my-0 [&_ul]:my-0 [&_ol]:my-0 [&_li]:my-0 [&_code]:bg-surface-container [&_code]:px-1 [&_code]:rounded [&_pre]:bg-surface-container [&_pre]:p-2 [&_pre]:rounded [&_blockquote]:border-l-2 [&_blockquote]:border-outline-variant [&_blockquote]:pl-2 [&_blockquote]:text-on-surface-variant/50 [&_h1]:text-[13px] [&_h1]:font-black [&_h1]:text-on-surface/90 [&_h2]:text-xs [&_h2]:font-bold [&_h2]:text-on-surface/80 [&_h3]:text-[11px] [&_h3]:font-semibold [&_h3]:text-on-surface/70`}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{processedBody}</ReactMarkdown>
            </div>
            {(isTruncated || expanded) && (
              <button
                onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
                className="w-full flex justify-center pt-1 text-primary-container/60 hover:text-primary-container transition-colors"
              >
                {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {/* Bottom bar — pills · time · read status */}
      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 border-t border-outline-variant/25 ${blurred ? 'blur-sm select-none' : ''}`}>
        {(() => {
          type P = { key: string; node: React.ReactNode }
          const pills: P[] = []
          if (motdLabels && motdLabels.length > 0) {
            pills.push({ key: 'motd', node: <span className={`${PILL} border-amber-400/60 bg-amber-400/10 text-amber-300`}><Sparkles className="w-2.5 h-2.5" />MOTD</span> })
            motdLabels.slice(0, 1).forEach((label, i) => pills.push({ key: `motdsub${i}`, node: <span className={`${PILL} ${label === 'SC MOTD' ? 'border-blue-400/40 bg-blue-400/10 text-blue-300' : 'border-green-400/40 bg-green-400/10 text-green-300'}`}>{label === 'SC MOTD' ? 'SC Testing' : 'ETF Testing'}</span> }))
          }
          if (msg.tag) {
            const tagCls = msg.tag === 'Patch Notes'
              ? 'border-green-500/40 bg-green-500/10 text-green-400'
              : msg.tag === 'LIVE'
                ? 'border-rose-500/60 bg-rose-500/15 text-rose-300 animate-pulse'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-400'
            pills.push({ key: 'tag', node: <span className={`${PILL} ${tagCls}`}>{msg.tag}</span> })
          }
          if (isTrackerSC) pills.push({ key: 'tsc', node: <a href="https://www.trackersc.com/" target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`${PILL} border-outline-variant/40 bg-surface-container text-on-surface-variant/60 hover:text-on-surface hover:border-outline-variant`}>Tracker SC</a> })
          if (trackerCat) { const Icon = trackerCat.icon; pills.push({ key: 'cat', node: <span className={`${PILL} ${trackerCat.cls}`}><Icon className="w-2.5 h-2.5" />{trackerCat.label}</span> }) }
          if (msg.dev) pills.push({ key: 'dev', node: <span className={`${PILL} border-teal-500/40 bg-teal-500/10 text-teal-400`}>{msg.dev}</span> })
          if (showSource && !msg.tag) pills.push({ key: 'src', node: <a href={msg.url!} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`${PILL} ${sourceInfo!.cls}`}>{sourceInfo!.label}</a> })
          if (msg.kbDiff) pills.push({ key: 'kbdiff', node: <KbDiffButton msg={msg} /> })
          if (msg.discord_jump_url && !isTrackerSC) pills.push({ key: 'disc', node: <a href={msg.discord_jump_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className={`${PILL} border-purple-500/40 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 hover:text-purple-300`}>{isPipeline ? 'Pipeline' : 'Post'}</a> })
          return <PillsRow pills={pills} className="flex-1 min-w-0" />
        })()}
        <span
          className="shrink-0 text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/30"
          title={displayTime || msg.timestamp}
        >
          {timeLabel}
        </span>
        {onMarkRead ? (
          <button
            onClick={e => { e.stopPropagation(); onMarkRead() }}
            title={isRead ? 'Mark as unread' : 'Mark as read'}
            className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center border transition-all duration-200 ${isRead
              ? 'border-primary-container/60 text-primary-container'
              : 'border-outline-variant/30 text-transparent hover:border-primary-container/50 hover:text-primary-container/50'
            }`}
          >
            <Check className="w-2.5 h-2.5" />
          </button>
        ) : (
          isNew && <span className="w-2 h-2 rounded-full bg-primary-container shrink-0" />
        )}
      </div>
    </article>
      </div>
    </div>

    {lightboxOpen && createPortal(
      <div
        className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
        onClick={() => setLightboxOpen(false)}
      >
        <button
          onClick={e => { e.stopPropagation(); setLightboxOpen(false) }}
          className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="relative" onClick={e => e.stopPropagation()}>
          <img
            src={images[lightboxIndex]}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded"
          />
          {images.length > 1 && (
            <>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIndex(i => Math.max(0, i - 1)) }}
                disabled={lightboxIndex === 0}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/70 text-white disabled:opacity-20 hover:bg-black/90 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                onClick={e => { e.stopPropagation(); setLightboxIndex(i => Math.min(images.length - 1, i + 1)) }}
                disabled={lightboxIndex === images.length - 1}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/70 text-white disabled:opacity-20 hover:bg-black/90 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
              <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                {images.map((_, i) => (
                  <button key={i} onClick={e => { e.stopPropagation(); setLightboxIndex(i) }}
                    className={`rounded-full transition-all ${i === lightboxIndex ? 'w-4 h-2 bg-white/90' : 'w-2 h-2 bg-white/40 hover:bg-white/60'}`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>,
      document.body
    )}
  </>
  )
}
