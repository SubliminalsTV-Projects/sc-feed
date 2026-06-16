'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, ChevronDown, ChevronUp, FileDiff } from 'lucide-react'
import type { FeedMessage } from '@/app/api/sc-feed/route'
import { KbDiffModal } from './sc-feed-kb-diff-modal'
import { timeAgo } from './sc-feed-utils'

/**
 * Dedicated display path for Knowledge Base cards (TrackerSC "[Updated]" → Zendesk article).
 * Owns its own rendering end-to-end — NOT routed through the shared MessageCard/CompactRow
 * footer-pill logic (see the display-isolation rule in the dev-sc-feed skill). The diff is a
 * first-class element here: an inline preview of the change + a "View full diff" action,
 * never a truncatable footer pill.
 */
export function KbCard({ msg, isRead, onMarkRead }: {
  msg: FeedMessage
  channelId?: string
  blurred?: boolean
  lastSeen?: string | null
  isRead?: boolean
  onMarkRead?: () => void
}) {
  const [diffOpen, setDiffOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [isTruncated, setIsTruncated] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const diff = msg.kbDiff
  const hasChange = !!diff && (diff.added > 0 || diff.removed > 0)
  const title = msg.title.replace(/^\[Updated\]\s*/i, '').trim()

  // KB cards never open the shared MessageModal — that renders the bare Zendesk/RSI logo
  // plus the junk og:description body. The KB reader (KbDiffModal) is the single reader for
  // every KB interaction: a changed article shows its diff, an unchanged one shows the
  // article excerpt. So all entry points (whole card, title, diff preview, footer) open it.
  const openDiff = () => { setDiffOpen(true); onMarkRead?.() }
  // Whole-card click opens the reader (matches every other card). Inner buttons —
  // the diff preview, "View full diff", the expand chevron — are skipped here and
  // handle their own clicks.
  const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('a, button')) return
    openDiff()
  }

  // Match the shared card's expand affordance: clamp the excerpt, show a chevron
  // only when there's more article to reveal.
  useEffect(() => {
    const el = bodyRef.current
    if (!el || expanded) return
    const check = () => setIsTruncated(el.scrollHeight > el.clientHeight + 2)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [expanded, diff?.excerpt])

  return (
    <article onClick={handleCardClick} className={`group cursor-pointer rounded-xl bg-surface-container-low border border-outline-variant/40 overflow-hidden hover:border-outline-variant/70 transition-all ${isRead ? 'opacity-50 hover:opacity-100' : ''}`}>
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-label font-black uppercase tracking-widest border-violet-500/40 bg-violet-500/10 text-violet-400">
            <BookOpen className="w-2.5 h-2.5" />Knowledge
          </span>
          <span className="text-[10px] font-label text-on-surface-variant/45 truncate">
            Tracker SC{msg.ts_raw ? ` · ${timeAgo(msg.ts_raw)}` : ''}
          </span>
        </div>

        <button onClick={openDiff} className="group block w-full text-left cursor-pointer">
          <h3 className="text-[13px] font-headline font-black text-on-surface leading-snug group-hover:text-primary-container transition-colors">
            {title}
            <ArrowUpRight className="inline w-3 h-3 ml-0.5 align-text-top text-on-surface-variant/40 group-hover:text-primary-container" />
          </h3>
        </button>

        {hasChange && diff?.preview && (
          <button
            onClick={openDiff}
            className="mt-2 block w-full text-left rounded-lg border border-violet-500/25 bg-violet-500/[0.06] hover:bg-violet-500/[0.1] hover:border-violet-500/40 transition-colors px-2.5 py-2 cursor-pointer"
          >
            <span
              className="kb-diff block text-[12px] font-body leading-relaxed text-on-surface-variant/80 line-clamp-2"
              dangerouslySetInnerHTML={{ __html: diff.preview }}
            />
          </button>
        )}

        {!hasChange && diff?.excerpt && (
          <div className="mt-1.5">
            <div
              ref={bodyRef}
              className={`${expanded ? '' : 'line-clamp-3'} text-[12px] font-body leading-relaxed text-on-surface-variant/70 whitespace-pre-line`}
            >
              {diff.excerpt}
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

      {hasChange && (
        <button
          onClick={openDiff}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 border-t border-outline-variant/20 bg-surface-container/30 hover:bg-surface-container/60 transition-colors cursor-pointer"
        >
          <span className="inline-flex items-center gap-1.5 text-[11px] font-label">
            <FileDiff className="w-3 h-3 text-violet-400" />
            <span className="text-green-400 font-black">+{diff.added}</span>
            <span className="text-on-surface-variant/30">/</span>
            <span className="text-red-400 font-black">−{diff.removed}</span>
          </span>
          <span className="text-[10px] font-label font-black uppercase tracking-widest text-violet-400">View full diff →</span>
        </button>
      )}

      {diffOpen && (
        <KbDiffModal
          msgId={msg.id}
          title={title}
          url={msg.url}
          excerpt={diff?.excerpt}
          hasChange={hasChange}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </article>
  )
}
