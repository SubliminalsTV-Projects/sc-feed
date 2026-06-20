'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'

// Minimal sign-in for Phase 1. Today it only matters for the owner (the RSI-token push can
// authorize via this session instead of the push secret). Phase 2 turns the same sign-in
// into guest accounts that sync settings + custom feeds. Uses the same OAuth apps as
// subliminal.gg, so accounts carry across.

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  )
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="#5865F2" aria-hidden="true">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
    </svg>
  )
}

function TwitchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="#9146FF" aria-hidden="true">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  )
}

const PROVIDERS = [
  { id: 'google',  label: 'Continue with Google',  Icon: GoogleIcon },
  { id: 'discord', label: 'Continue with Discord', Icon: DiscordIcon },
  { id: 'twitch',  label: 'Continue with Twitch',  Icon: TwitchIcon },
]

export default function LoginPage() {
  // Honor the saved theme. ScFeedView (which applies the .light class on <html>) isn't mounted
  // on this standalone page, so we read the same localStorage key it writes and apply the class
  // ourselves — otherwise a light-mode user would get a dark login. Defaults to dark so the
  // first paint matches the default theme with no flash.
  const [light, setLight] = useState(false)
  useEffect(() => {
    const isLight = (() => { try { return localStorage.getItem('sc-feed-theme') === 'light' } catch { return false } })()
    if (isLight) document.documentElement.classList.add('light')
    setLight(isLight)
  }, [])
  const logo = light ? '/logos/[SCFeed][Logo][Black][Color].svg' : '/logos/[SCFeed][Logo][White][Color].svg'

  return (
    <main className="relative min-h-screen flex items-center justify-center bg-background px-4 overflow-hidden">
      {/* Ambient amber glow — same treatment as the feed */}
      <div className="absolute inset-0 hero-gradient pointer-events-none" />

      <div className="relative w-full max-w-sm">
        <div className="glass-card rounded-3xl p-8 shadow-2xl shadow-black/40">
          {/* Brand */}
          <div className="flex flex-col items-center text-center mb-7">
            <img src={logo} alt="SC Feed" className="h-9 mb-5" />
            <h1 className="text-[15px] font-headline font-black text-on-surface">Welcome back</h1>
            <p className="text-[12.5px] font-body text-on-surface-variant/60 mt-1">
              Your Star Citizen news, all in one place.
            </p>
          </div>

          {/* Providers */}
          <div className="flex flex-col gap-2.5">
            {PROVIDERS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => signIn(id, { callbackUrl: '/' })}
                className="group flex items-center gap-3 w-full rounded-xl px-4 py-3 bg-surface-container-high/70 border border-outline-variant/40 text-on-surface hover:bg-surface-container-highest hover:border-outline transition-all duration-150"
              >
                <span className="shrink-0 transition-transform duration-150 group-hover:scale-110"><Icon /></span>
                <span className="text-[13px] font-label font-black">{label}</span>
                <svg
                  viewBox="0 0 24 24" width="16" height="16"
                  className="ml-auto text-on-surface-variant/40 -translate-x-1 opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100"
                  fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-7 pt-5 border-t border-outline-variant/30">
            <p className="text-[11px] font-body text-on-surface-variant/45 text-center leading-relaxed">
              Uses your <span className="text-on-surface-variant/70 font-bold">subliminal.gg</span> account — no new password to create.
            </p>
          </div>
        </div>

        <div className="text-center mt-4">
          <Link href="/" className="text-[12px] font-label font-black text-on-surface-variant/50 hover:text-on-surface transition-colors">
            ← Back to feed
          </Link>
        </div>
      </div>
    </main>
  )
}
