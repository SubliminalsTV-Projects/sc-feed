import Link from 'next/link'
import { auth } from '@/auth'
import { getConfigStatus } from '@/lib/sc-config'

// Owner-only backend. Phase 1 surfaces the RSI-token sync status (proof the extension is
// pushing); it's the place future owner controls + the Phase-2 account/sync admin will live.
export const dynamic = 'force-dynamic'

const CARD = 'w-full rounded-2xl bg-surface-container border border-outline-variant/40 p-6'
const BTN = 'inline-flex items-center justify-center px-4 py-2 rounded-lg text-[13px] font-label font-black bg-surface-container-high border border-outline-variant/40 text-on-surface hover:bg-surface-container-highest transition-colors'

export default async function OwnerPage() {
  const session = await auth()
  const isOwner = session?.user?.role === 'owner'

  if (!isOwner) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className={`${CARD} max-w-sm text-center`}>
          <h1 className="text-lg font-headline font-black text-on-surface mb-1">Owner area</h1>
          <p className="text-[13px] font-body text-on-surface-variant/70 mb-5">
            {session ? `Signed in as ${session.user?.email ?? 'guest'} — no owner access.` : 'Sign in to continue.'}
          </p>
          <div className="flex gap-2 justify-center">
            {!session && <Link href="/login" className={BTN}>Sign in</Link>}
            <Link href="/" className={BTN}>Back to feed</Link>
          </div>
        </div>
      </main>
    )
  }

  const rsi = await getConfigStatus('rsi_token').catch(() => ({ set: false } as Awaited<ReturnType<typeof getConfigStatus>>))
  const updated = rsi.updated ? new Date(rsi.updated.replace(' ', 'T')).toLocaleString() : null

  return (
    <main className="min-h-screen px-4 py-10 flex justify-center">
      <div className="w-full max-w-lg space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-headline font-black text-on-surface">Owner backend</h1>
          <Link href="/" className="text-[12px] font-label font-black text-on-surface-variant/60 hover:text-on-surface transition-colors">← Feed</Link>
        </div>

        <div className={CARD}>
          <p className="text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-3">RSI Token</p>
          <div className="flex items-center gap-2 mb-4">
            <span className={`w-2 h-2 rounded-full ${rsi.set ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-[14px] font-headline font-black text-on-surface">{rsi.set ? 'Synced' : 'Not set'}</span>
          </div>
          <dl className="space-y-1.5 text-[13px] font-body">
            <div className="flex justify-between gap-4"><dt className="text-on-surface-variant/60">Last updated</dt><dd className="text-on-surface text-right">{updated ?? '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-on-surface-variant/60">Source</dt><dd className="text-on-surface text-right">{rsi.updated_via || '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-on-surface-variant/60">By</dt><dd className="text-on-surface text-right">{rsi.updated_by || '—'}</dd></div>
          </dl>
          <p className="mt-4 text-[11px] font-body text-on-surface-variant/45 leading-relaxed">
            Pushed by the RSI Token Sync browser extension. The cron reads this (falling back to the env var), so Spectrum/MOTD stay fresh without the manual DevTools copy-paste.
          </p>
        </div>

        <p className="text-[11px] font-body text-on-surface-variant/40 text-center">
          Signed in as {session.user?.email}.
        </p>
      </div>
    </main>
  )
}
