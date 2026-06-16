'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type DiffState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; html: string; summary: string }

/**
 * The single reader for a Knowledge Base card — KB cards never fall through to the shared
 * MessageModal (which only has the bare Zendesk/RSI logo + og:description to show). When the
 * article changed (`hasChange`) it fetches the stored diff by msg_id and renders it with
 * green/red highlighting; when it didn't, it reads the snapshot `excerpt` the card already
 * carries, as a plain article view. Either way it links out to the full article via `url`.
 */
export function KbDiffModal({ msgId, title, url, excerpt, hasChange, onClose }: {
  msgId: string
  title: string
  url?: string
  excerpt?: string
  hasChange: boolean
  onClose: () => void
}) {
  // Unchanged articles have nothing to fetch — render the excerpt straight away. Only a
  // real diff needs the on-demand round-trip to /api/sc-feed/kb-diff.
  const [state, setState] = useState<DiffState>(
    hasChange ? { status: 'loading' } : { status: 'ready', html: '', summary: '' }
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    let alive = true
    if (hasChange) {
      fetch(`/api/sc-feed/kb-diff?msg_id=${encodeURIComponent(msgId)}`)
        .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then(d => { if (alive) setState({ status: 'ready', html: d.diff_html ?? '', summary: d.summary ?? '' }) })
        .catch(e => { if (alive) setState({ status: 'error', message: String(e) }) })
    }

    return () => {
      alive = false
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [msgId, hasChange, onClose])

  const eyebrow = hasChange ? 'What Changed' : 'Article'

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={e => { e.stopPropagation(); onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Knowledge Base changes"
    >
      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-surface-container rounded-xl border border-outline-variant/30 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 sm:px-6 py-4 bg-surface-container border-b border-outline-variant/30">
          <div className="min-w-0">
            <p className="text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/50">{eyebrow}</p>
            <h2 className="text-sm font-headline font-black text-on-surface truncate">{title}</h2>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {state.status === 'ready' && state.summary && (
              <span className="text-[11px] font-mono text-on-surface-variant/60">{state.summary}</span>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-full text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 sm:px-6 py-5">
          {state.status === 'loading' && (
            <p className="text-sm font-body text-on-surface-variant/60">Loading changes…</p>
          )}
          {/* On a diff fetch error we still have the snapshot excerpt to fall back to, so the
              reader is never empty — only show the error if there's nothing else to render. */}
          {state.status === 'error' && (
            excerpt
              ? <div className="text-[13px] font-body leading-relaxed text-on-surface-variant/85 whitespace-pre-line">{excerpt}</div>
              : <p className="text-sm font-body text-red-400">Couldn&apos;t load the article ({state.message}).</p>
          )}
          {state.status === 'ready' && (
            state.html
              ? (
                <div
                  className="kb-diff text-[13px] font-body leading-relaxed text-on-surface-variant/90 break-words"
                  dangerouslySetInnerHTML={{ __html: state.html }}
                />
              )
              : excerpt
                ? <div className="text-[13px] font-body leading-relaxed text-on-surface-variant/85 whitespace-pre-line">{excerpt}</div>
                : (
                  <p className="text-sm font-body text-on-surface-variant/60">
                    No preview available — open the full article below to read it.
                  </p>
                )
          )}

          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-1.5 text-[11px] font-label font-black uppercase tracking-widest text-violet-400 hover:text-violet-300"
            >
              Open full article ↗
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
