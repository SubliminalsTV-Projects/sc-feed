'use client'

import { Crown, Heart, X, ExternalLink } from 'lucide-react'

// Ways to support SC Feed / SubliminalsTV. Links confirmed with Sub (2026-06).
const SUPPORT_OPTIONS = [
  {
    key: 'subclub',
    title: 'Join SubClub',
    blurb: 'Membership perks and the most direct way to back the channel.',
    href: 'https://subliminal.gg/subclub',
    accent: 'var(--mc-primary-container)',
    Icon: () => <Crown className="w-5 h-5" style={{ color: 'var(--mc-primary-container)' }} />,
  },
  {
    key: 'patreon',
    title: 'Become a Patron',
    blurb: 'Monthly support over on Patreon.',
    href: 'https://www.patreon.com/c/SubliminalsTV',
    accent: '#FF424D',
    Icon: () => (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#FF424D" aria-hidden="true">
        <path d="M0 .48v23.04h4.22V.48zm15.385 0c-4.764 0-8.641 3.88-8.641 8.65 0 4.755 3.877 8.623 8.641 8.623 4.75 0 8.615-3.868 8.615-8.623C24 4.36 20.136.48 15.385.48z" />
      </svg>
    ),
  },
  {
    key: 'twitch',
    title: 'Subscribe on Twitch',
    blurb: 'Subscribe or gift subs on the SubliminalsTV stream.',
    href: 'https://www.twitch.tv/subs/subliminalstv',
    accent: '#9146FF',
    Icon: () => (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#9146FF" aria-hidden="true">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
      </svg>
    ),
  },
]

export function SupportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-3xl bg-surface-container border border-outline-variant/40 shadow-2xl shadow-black/40 overflow-hidden"
        style={{ animation: 'mc-slide-in 0.15s ease-out' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/30">
          <div className="flex items-center gap-2">
            <Heart className="w-4 h-4 text-primary-container" />
            <span className="text-sm font-headline font-black text-on-surface">Support SC Feed</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded text-on-surface-variant/60 hover:text-on-surface transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-[12.5px] font-body text-on-surface-variant/70 leading-relaxed">
            SC Feed is free and ad-light. If it saves you time keeping up with Star Citizen, here are the ways to keep it running and back the channel:
          </p>

          <div className="space-y-2.5">
            {SUPPORT_OPTIONS.map(({ key, title, blurb, href, accent, Icon }) => (
              <a
                key={key}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl px-3.5 py-3 bg-surface-container-high/60 border border-outline-variant/40 hover:bg-surface-container-highest transition-colors"
                style={{ borderLeft: `3px solid ${accent}` }}
              >
                <span className="shrink-0"><Icon /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-label font-black text-on-surface">{title}</span>
                  <span className="block text-[11px] font-body text-on-surface-variant/60 leading-snug">{blurb}</span>
                </span>
                <ExternalLink className="w-4 h-4 shrink-0 text-on-surface-variant/30 group-hover:text-on-surface-variant/70 transition-colors" />
              </a>
            ))}
          </div>

          <p className="text-[11px] font-body text-on-surface-variant/45 text-center leading-relaxed pt-1">
            Thank you — every bit helps. o7
          </p>
        </div>
      </div>
    </div>
  )
}
