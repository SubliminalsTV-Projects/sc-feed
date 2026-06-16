'use client'

import { signIn } from 'next-auth/react'

// Minimal sign-in for Phase 1. Today it only matters for the owner (the RSI-token push can
// authorize via this session instead of the push secret). Phase 2 turns the same sign-in
// into guest accounts that sync settings + custom feeds. Uses the same OAuth apps as
// subliminal.gg, so accounts carry across.
const PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'discord', label: 'Continue with Discord' },
  { id: 'twitch', label: 'Continue with Twitch' },
]

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface-container border border-outline-variant/40 p-6">
        <h1 className="text-lg font-headline font-black text-on-surface mb-1">Sign in to SC Feed</h1>
        <p className="text-[13px] font-body text-on-surface-variant/70 mb-5">
          Uses your subliminal.gg account.
        </p>
        <div className="flex flex-col gap-2">
          {PROVIDERS.map(p => (
            <button
              key={p.id}
              onClick={() => signIn(p.id, { callbackUrl: '/' })}
              className="w-full rounded-lg px-4 py-2.5 text-[13px] font-label font-black bg-surface-container-high border border-outline-variant/40 text-on-surface hover:bg-surface-container-highest transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
