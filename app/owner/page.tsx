import Link from 'next/link'
import { auth } from '@/auth'
import { getConfigStatus } from '@/lib/sc-config'
import { getHealth, type CronHealth, type SourceHealth } from '@/lib/health'
import { RsiTokenLive } from './rsi-token-live'

// Owner-only backend. Surfaces pipeline health (DB, cron heartbeats, per-source freshness,
// library counts) + RSI-token sync/validity. The place future owner controls live.
export const dynamic = 'force-dynamic'

const CARD = 'w-full rounded-2xl bg-surface-container border border-outline-variant/40 p-6'
const BTN = 'inline-flex items-center justify-center px-4 py-2 rounded-lg text-[13px] font-label font-black bg-surface-container-high border border-outline-variant/40 text-on-surface hover:bg-surface-container-highest transition-colors'
const LABEL = 'text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/50 mb-3'

// A cron heartbeat older than ~2 run cycles (10-min cadence) means the job is dead.
const CRON_STALE_MS = 25 * 60 * 1000
// A source with no new item in this long gets a soft amber hint (not an alarm — some feeds
// are genuinely quiet for days).
const SOURCE_STALE_MS = 3 * 24 * 60 * 60 * 1000

// Each source row links to where that source PUBLISHES (its channel/page) — so you can click
// through and compare what the source shows vs. what SCFeed shows. NOT the latest article URL.
// All 4 Discord channels live in the SubliminalsTV guild (303670222097874945).
const DISCORD_GUILD = '303670222097874945'
const SOURCE_LINKS: Record<string, string> = {
  '1484315008216207450': `https://discord.com/channels/${DISCORD_GUILD}/1484315008216207450`, // SC News
  '1484315784816627903': `https://discord.com/channels/${DISCORD_GUILD}/1484315784816627903`, // Patch News
  '933047593666236487':  `https://discord.com/channels/${DISCORD_GUILD}/933047593666236487`,  // CIG / Tracker SC
  '1484315527416647802': `https://discord.com/channels/${DISCORD_GUILD}/1484315527416647802`, // SC Leaks
  'spectrum-announce':    'https://robertsspaceindustries.com/spectrum/community/SC/forum/1',
  'spectrum-patch-notes': 'https://robertsspaceindustries.com/spectrum/community/SC/forum/190048',
  'rsi-status':           'https://status.robertsspaceindustries.com/',
  'twitter-rsi':          'https://twitter.com/RobertsSpaceInd',
  'sc-youtube':           'https://www.youtube.com/channel/UCTeLqJq1mXUX5WWoNXLmOIA',
  'subliminalstv':        'https://www.youtube.com/channel/UCK2D42bb2isF77-lbNPCpXA',
  // MOTDs are Spectrum lobby messages with no public page — left unlinked on purpose.
}

function ago(ms: number | null): string {
  if (ms == null) return 'never'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function Dot({ tone }: { tone: 'green' | 'amber' | 'red' }) {
  const cls = tone === 'green' ? 'bg-green-400' : tone === 'amber' ? 'bg-amber-400' : 'bg-red-400'
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />
}

function CronRow({ c }: { c: CronHealth }) {
  const stale = c.ageMs == null || c.ageMs > CRON_STALE_MS
  const tone = !c.ok || c.ageMs == null ? 'red' : stale ? 'amber' : 'green'
  const detail =
    typeof c.summary.error === 'string'
      ? c.summary.error
      : c.summary.count != null
        ? `${c.summary.count} item${c.summary.count === 1 ? '' : 's'}${typeof c.summary.deleted === 'number' ? ` · ${c.summary.deleted} pruned` : ''}`
        : ''
  return (
    <div className="flex items-center gap-3 py-1.5">
      <Dot tone={tone} />
      <span className="text-[13px] font-headline font-black text-on-surface w-24 capitalize">{c.source}</span>
      <span className="text-[12px] font-body text-on-surface-variant/60 flex-1 truncate">{detail || '—'}</span>
      <span className={`text-[12px] font-body text-right ${tone === 'red' ? 'text-red-300/80' : 'text-on-surface-variant/70'}`}>{ago(c.ageMs)}</span>
    </div>
  )
}

function SourceRow({ s }: { s: SourceHealth }) {
  const stale = s.ageMs == null || s.ageMs > SOURCE_STALE_MS
  const href = SOURCE_LINKS[s.channelId]
  const inner = (
    <>
      <Dot tone={stale ? 'amber' : 'green'} />
      <span className={`text-[13px] font-body flex-1 truncate text-on-surface ${href ? 'group-hover/src:text-primary group-hover/src:underline underline-offset-2' : ''}`}>{s.label}</span>
      <span className="text-[12px] font-body text-on-surface-variant/50 w-16 text-right tabular-nums">{s.count24h} / 24h</span>
      <span className="text-[12px] font-body text-on-surface-variant/70 w-20 text-right">{ago(s.ageMs)}</span>
    </>
  )
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer"
        title="Open this source's channel/page"
        className="group/src flex items-center gap-3 py-1.5 -mx-2 px-2 rounded-lg hover:bg-surface-container-high/60 transition-colors">
        {inner}
      </a>
    )
  }
  return <div className="flex items-center gap-3 py-1.5">{inner}</div>
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-surface-container-high/50 border border-outline-variant/30 p-3">
      <p className="text-[10px] font-label font-black uppercase tracking-wider text-on-surface-variant/50">{label}</p>
      <p className="text-[18px] font-headline font-black text-on-surface mt-0.5 tabular-nums">{value}</p>
    </div>
  )
}

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

  const [rsi, health] = await Promise.all([
    getConfigStatus('rsi_token').catch(() => ({ set: false } as Awaited<ReturnType<typeof getConfigStatus>>)),
    getHealth().catch((err): Awaited<ReturnType<typeof getHealth>> => ({
      db: { ok: false, latencyMs: null, error: String(err) }, cron: [], sources: [],
      counts: { messagesTotal: 0, messages24h: 0, kbSnapshots: 0, kbDiffs: 0, kbLastDiff: null, saved: 0, pushSubs: 0 },
    })),
  ])
  const updated = rsi.updated ? new Date(rsi.updated.replace(' ', 'T')).toLocaleString() : null
  const kbLastDiff = health.counts.kbLastDiff ? new Date(health.counts.kbLastDiff).toLocaleString() : '—'

  return (
    <main className="min-h-screen px-4 py-10 flex justify-center">
      <div className="w-full max-w-4xl">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-xl font-headline font-black text-on-surface">Owner backend</h1>
          <Link href="/" className="text-[12px] font-label font-black text-on-surface-variant/60 hover:text-on-surface transition-colors">← Feed</Link>
        </div>

        {/* Cards flow into 2 balanced columns on desktop, single stack on mobile */}
        <div className="space-y-5 lg:space-y-0 lg:columns-2 lg:gap-5 [&>*]:break-inside-avoid lg:[&>*]:mb-5">

        {/* Pipeline: DB + cron heartbeats — the "is it alive" headline */}
        <div className={CARD}>
          <p className={LABEL}>Pipeline</p>
          <div className="flex items-center gap-2 mb-4">
            <Dot tone={health.db.ok ? 'green' : 'red'} />
            <span className="text-[14px] font-headline font-black text-on-surface">
              {health.db.ok ? 'Timescale connected' : 'Database unreachable'}
            </span>
            {health.db.ok && health.db.latencyMs != null && (
              <span className="text-[12px] font-body text-on-surface-variant/50 ml-auto tabular-nums">{health.db.latencyMs}ms</span>
            )}
          </div>
          {!health.db.ok && health.db.error && (
            <p className="text-[12px] font-body text-red-300/80 mb-3 break-words">{health.db.error}</p>
          )}
          <div className="border-t border-outline-variant/30 pt-2">
            <p className="text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/40 mb-1">Cron heartbeats</p>
            {health.cron.map((c) => <CronRow key={c.source} c={c} />)}
          </div>
          <p className="mt-3 text-[11px] font-body text-on-surface-variant/45 leading-relaxed">
            Each source stamps a heartbeat every run (10-min cadence). Amber = no run in 25min, red = failed or never seen.
          </p>
        </div>

        {/* Per-source freshness */}
        <div className={CARD}>
          <p className={LABEL}>Sources — last item</p>
          {health.sources.length === 0 ? (
            <p className="text-[13px] font-body text-on-surface-variant/50">No messages in the store.</p>
          ) : (
            <div className="divide-y divide-outline-variant/20">
              {health.sources.map((s) => <SourceRow key={s.channelId} s={s} />)}
            </div>
          )}
        </div>

        {/* Library counts */}
        <div className={CARD}>
          <p className={LABEL}>Library</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Messages" value={health.counts.messagesTotal} />
            <Stat label="Last 24h" value={health.counts.messages24h} />
            <Stat label="KB snaps" value={health.counts.kbSnapshots} />
            <Stat label="KB diffs" value={health.counts.kbDiffs} />
            <Stat label="Saved" value={health.counts.saved} />
            <Stat label="Push subs" value={health.counts.pushSubs} />
          </div>
          <p className="mt-3 text-[12px] font-body text-on-surface-variant/50">Last KB diff: {kbLastDiff}</p>
        </div>

        {/* RSI token — sync status (server) + live validity (client probe) */}
        <div className={CARD}>
          <p className={LABEL}>RSI Token</p>
          <div className="flex items-center gap-2 mb-4">
            <Dot tone={rsi.set ? 'green' : 'red'} />
            <span className="text-[14px] font-headline font-black text-on-surface">{rsi.set ? 'Synced' : 'Not set'}</span>
          </div>
          <dl className="space-y-1.5 text-[13px] font-body">
            <div className="flex justify-between gap-4"><dt className="text-on-surface-variant/60">Last updated</dt><dd className="text-on-surface text-right">{updated ?? '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-on-surface-variant/60">Source</dt><dd className="text-on-surface text-right">{rsi.updated_via || '—'}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-on-surface-variant/60">By</dt><dd className="text-on-surface text-right">{rsi.updated_by || '—'}</dd></div>
          </dl>
          <div className="mt-4 pt-3 border-t border-outline-variant/30">
            <p className="text-[10px] font-label font-black uppercase tracking-widest text-on-surface-variant/40 mb-2">Live validity</p>
            <RsiTokenLive />
          </div>
          <p className="mt-4 text-[11px] font-body text-on-surface-variant/45 leading-relaxed">
            Pushed by the RSI Token Sync browser extension. The cron reads this (falling back to the env var), so Spectrum/MOTD stay fresh without the manual DevTools copy-paste.
          </p>
        </div>

        </div>

        <p className="mt-6 text-[11px] font-body text-on-surface-variant/40 text-center">
          Signed in as {session.user?.email}.
        </p>
      </div>
    </main>
  )
}
