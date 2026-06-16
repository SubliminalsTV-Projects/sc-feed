'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileDiff, X } from 'lucide-react'
import type { FeedMessage } from '@/app/api/sc-feed/route'
import { PILL } from './sc-feed-types'

/** Footer pill for a Knowledge Base card that has a change diff. Opens the detail view. */
export function KbDiffButton({ msg }: { msg: FeedMessage }) {
  const [open, setOpen] = useState(false)
  if (!msg.kbDiff) return null
  return (
    <>
      <button
        onClick={e => { e.stopPropagation(); setOpen(true) }}
        title="See what changed in this Knowledge Base article"
        className={`${PILL} border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 cursor-pointer`}
      >
        <FileDiff className="w-2.5 h-2.5" />
        {msg.kbDiff.summary}
      </button>
      {open && <KbDiffModal msgId={msg.id} title={msg.title} onClose={() => setOpen(false)} />}
    </>
  )
}

type DiffState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; html: string; summary: string; url: string }

function KbDiffModal({ msgId, title, onClose }: { msgId: string; title: string; onClose: () => void }) {
  const [state, setState] = useState<DiffState>({ status: 'loading' })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    let alive = true
    fetch(`/api/sc-feed/kb-diff?msg_id=${encodeURIComponent(msgId)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (alive) setState({ status: 'ready', html: d.diff_html ?? '', summary: d.summary ?? '', url: d.url ?? '' }) })
      .catch(e => { if (alive) setState({ status: 'error', message: String(e) }) })

    return () => {
      alive = false
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [msgId, onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
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
            <p className="text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/50">What Changed</p>
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
          {state.status === 'error' && (
            <p className="text-sm font-body text-red-400">Couldn&apos;t load the diff ({state.message}).</p>
          )}
          {state.status === 'ready' && (
            state.html
              ? (
                <div
                  className="kb-diff text-[13px] font-body leading-relaxed text-on-surface-variant/90 break-words"
                  dangerouslySetInnerHTML={{ __html: state.html }}
                />
              )
              : (
                <p className="text-sm font-body text-on-surface-variant/60">
                  No textual changes detected — the update may have been to formatting, images, or metadata.
                </p>
              )
          )}

          {state.status === 'ready' && state.url && (
            <a
              href={state.url}
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
