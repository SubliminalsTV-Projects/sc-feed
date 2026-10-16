'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { PATCH_NOTES, type PatchNote } from '@/lib/patch-notes'

export function PatchNotesModal({ open, onClose, theme = 'dark' }: { open: boolean; onClose: () => void; theme?: 'dark' | 'light' }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="patch-notes-title"
    >
      <div
        className="relative w-full max-w-xl max-h-[85vh] overflow-y-auto bg-surface-container rounded-xl border border-outline-variant/30 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 sm:px-6 py-4 bg-surface-container border-b border-outline-variant/30">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src={theme === 'light' ? '/logos/[SCFeed][Logo][Black][Color].svg' : '/logos/[SCFeed][Logo][White][Color].svg'}
              alt="SC Feed"
              className="h-7 sm:h-8 shrink-0"
            />
            <h2 id="patch-notes-title" className="text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant/60 truncate">
              What&apos;s New
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-full text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-8">
          {PATCH_NOTES.map(note => (
            <NoteEntry key={note.version} note={note} />
          ))}
        </div>
      </div>
    </div>
  )
}

function NoteEntry({ note }: { note: PatchNote }) {
  return (
    <article>
      <header className="mb-3">
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-container/15 text-primary-container text-[10px] font-mono font-black uppercase tracking-widest">
            v{note.version}
          </span>
          <span className="text-[10px] font-mono text-on-surface-variant/40">{note.date}</span>
        </div>
        {note.title && (
          <h3 className="text-xl sm:text-2xl font-headline font-black text-on-surface leading-tight">{note.title}</h3>
        )}
        {note.intro && (
          <p className="mt-2 text-sm font-body text-on-surface-variant/80 leading-relaxed">{note.intro}</p>
        )}
      </header>

      <div className="space-y-5">
        {note.sections.map((section, i) => (
          <section key={i}>
            {section.heading && (
              <p className="text-[9px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-2">
                {section.heading}
              </p>
            )}
            <ul className="space-y-2">
              {section.items.map((item, j) => (
                <li key={j} className="flex gap-2.5 text-[12.5px] font-body text-on-surface-variant/85 leading-relaxed">
                  <span className="mt-1.5 shrink-0 w-1 h-1 rounded-full bg-primary-container/60" aria-hidden />
                  <span dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </article>
  )
}

// Minimal inline formatter: **bold** and [text](href). Content is hard-coded in lib/patch-notes.ts so HTML
// escaping is for defense-in-depth. Links only allow site-relative paths (/x, not //x) or https:// URLs;
// anything else is left as literal text. External links open in a new tab.
function renderInline(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  return escaped
    .replace(/\[([^\]]+)\]\((\/(?!\/)[^\s)]*|https:\/\/[^\s)]+)\)/g, (_, label: string, href: string) => {
      const external = href.startsWith('https://') ? ' target="_blank" rel="noopener noreferrer"' : ''
      return `<a href="${href}"${external} class="text-primary-container hover:underline">${label}</a>`
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-on-surface font-black">$1</strong>')
}
