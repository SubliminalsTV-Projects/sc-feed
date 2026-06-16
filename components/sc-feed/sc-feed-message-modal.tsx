'use client'

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import remarkGfm from 'remark-gfm'

const ReactMarkdown = dynamic(() => import('react-markdown'), { ssr: false, loading: () => null })
import { ExternalLink, MessageSquare, X } from 'lucide-react'
import type { FeedMessage } from '@/app/api/sc-feed/route'
import { PILL, PIPELINE_CHANNEL_IDS, TRACKER_CATS, useFeedPrefs } from './sc-feed-types'
import { formatLocalTime, getSourceInfo, getTrackerCatKey, normalizeBodyMarkdown, stripDiscordMarkdown, timeAgo } from './sc-feed-utils'

const PROSE = 'text-[13px] font-body text-on-surface-variant/85 leading-relaxed prose prose-invert prose-sm max-w-none [&_a]:text-primary-container [&_a:hover]:underline [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5 [&_code]:bg-surface-container [&_code]:px-1 [&_code]:rounded [&_pre]:bg-surface-container [&_pre]:p-2 [&_pre]:rounded [&_blockquote]:border-l-2 [&_blockquote]:border-outline-variant [&_blockquote]:pl-2 [&_blockquote]:text-on-surface-variant/60 [&_h1]:text-[15px] [&_h1]:font-black [&_h1]:text-on-surface/90 [&_h2]:text-[14px] [&_h2]:font-bold [&_h2]:text-on-surface/80 [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:text-on-surface/70 [&_img]:rounded-lg'

/**
 * Reader modal — opens when a feed card is clicked, showing the full content (article /
 * Discord message / dev reply / MOTD) inline with an explicit "View source" link. This is
 * the intentional way out to the source: a stray click on a card no longer fires a new tab.
 */
export function MessageModal({ msg, channelId, onClose }: {
  msg: FeedMessage
  channelId?: string
  onClose: () => void
}) {
  const { dateFormat } = useFeedPrefs()

  // ESC to close + lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  const images = (() => {
    if (!msg.image) return [] as string[]
    if (msg.image.startsWith('[')) { try { return JSON.parse(msg.image) as string[] } catch { /**/ } }
    return [msg.image]
  })()
  const isVideo = (u: string) => /\.(mp4|webm|mov)(\?|$)/i.test(u)
  const isAudio = (u: string) => /\.(mp3|ogg|wav|flac|aac|m4a)(\?|$)/i.test(u)

  const isTrackerSC = channelId === 'cig-news'
  const trackerKey = isTrackerSC ? getTrackerCatKey(msg.source) : undefined
  const trackerCat = trackerKey ? TRACKER_CATS[trackerKey] : undefined
  const sourceInfo = getSourceInfo(msg.url)
  const showSource = sourceInfo && !(trackerCat && sourceInfo.label === trackerCat.label)

  // Drop TrackerSC site-logo images (Zendesk / RSI opengraph) — they aren't real content.
  const displayImages = images.filter(u =>
    !(isTrackerSC && trackerKey !== 'Reddit' && (u.includes('redditmedia.com') || u.includes('thumbs.reddit') || u.includes('/subreddit-icon') || /opengraph|tavern\//i.test(u)))
  )

  const cleanTitle = stripDiscordMarkdown(msg.title ?? '')
  const bodyText = (msg.body && msg.body.trim()) ? msg.body : (msg.kbDiff?.excerpt ?? '')
  const processedBody = bodyText ? normalizeBodyMarkdown(bodyText) : ''
  const timeLabel = timeAgo(msg.ts_raw ?? null, dateFormat) || formatLocalTime(msg.ts_raw ?? null) || msg.timestamp

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-surface-container border border-outline-variant/40 shadow-2xl overflow-hidden"
      >
        {/* Header — pills, title, close */}
        <div className="flex items-start gap-2 px-4 py-3 border-b border-outline-variant/20">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
              {isTrackerSC && <span className={`${PILL} border-outline-variant/40 bg-surface-container-high text-on-surface-variant/60`}>Tracker SC</span>}
              {trackerCat && (() => { const Icon = trackerCat.icon; return <span className={`${PILL} ${trackerCat.cls}`}><Icon className="w-2.5 h-2.5" />{trackerCat.label}</span> })()}
              {showSource && <span className={`${PILL} ${sourceInfo!.cls}`}>{sourceInfo!.label}</span>}
              {msg.dev && <span className={`${PILL} border-teal-500/40 bg-teal-500/10 text-teal-300`}>{msg.dev}</span>}
              {timeLabel && <span className="text-[10px] font-label text-on-surface-variant/45">{timeLabel}</span>}
            </div>
            <h2 className="text-[16px] font-headline font-black text-on-surface leading-snug">{cleanTitle}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body — media + full text */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {displayImages.map((u, i) => (
            isVideo(u)
              ? <video key={i} src={u} controls preload="metadata" className="w-full rounded-lg bg-black" />
              : isAudio(u)
                ? <audio key={i} src={u} controls className="w-full" />
                // eslint-disable-next-line @next/next/no-img-element
                : <img key={i} src={u} alt="" className="w-full rounded-lg" />
          ))}
          {processedBody ? (
            <div className={PROSE}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{processedBody}</ReactMarkdown>
            </div>
          ) : (
            displayImages.length === 0 && (
              <p className="text-[12px] text-on-surface-variant/50 italic">No preview available — open the source below to read more.</p>
            )
          )}
        </div>

        {/* Actions — the intentional way out to the source */}
        {(msg.url || msg.discord_jump_url) && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-outline-variant/20 bg-surface-container-low/50">
            {msg.url && (
              <a
                href={msg.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-label font-black bg-primary-container/15 border border-primary-container/30 text-primary-container hover:bg-primary-container/25 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />View source
              </a>
            )}
            {msg.discord_jump_url && (
              <a
                href={msg.discord_jump_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-label font-black bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />Open in Discord
              </a>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
