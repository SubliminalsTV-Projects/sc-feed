'use client'

import { useEffect, useState } from 'react'
import { Cookie, X } from 'lucide-react'
import Link from 'next/link'
import { isEmbedded } from '@/lib/embed'

const ACK_KEY = 'sc-feed-cookie-acknowledged'

export function CookieBanner() {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (isEmbedded()) return // stay hidden in embedded previews
    try {
      if (!localStorage.getItem(ACK_KEY)) setShown(true)
    } catch { /* private mode — don't show banner */ }
  }, [])

  if (!shown) return null

  const dismiss = () => {
    try { localStorage.setItem(ACK_KEY, new Date().toISOString()) } catch { /* ignore */ }
    setShown(false)
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 bg-surface-container-high/95 backdrop-blur border-t border-outline-variant/40 shadow-2xl">
      <div className="max-w-3xl mx-auto flex items-start sm:items-center gap-3">
        <Cookie className="w-5 h-5 text-primary-container shrink-0 mt-0.5 sm:mt-0" />
        <p className="flex-1 text-[11px] sm:text-[12px] font-body text-on-surface-variant leading-relaxed">
          SC Feed stores your layout, read state, and custom feeds in your browser only. We use Google Analytics for anonymous usage stats — no ad networks, no profile selling.{' '}
          <Link href="/privacy" className="text-primary-container hover:underline">Learn more</Link>
        </p>
        <button
          onClick={dismiss}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-container text-surface text-[10px] font-label font-black uppercase tracking-widest hover:brightness-110 transition-all"
        >
          Got it
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 sm:hidden p-1 rounded text-on-surface-variant/40 hover:text-on-surface-variant"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
