// Watchdog decision logic, kept out of route.ts (Next.js route files may only export handlers) and
// free of DB/network so it can be exercised directly with fixture statuses.
import { SPECTRUM_MOTDS } from '../_shared'
import { SESSION_ENDED_CODE, type MotdFetchStatus } from '../motd'

export type Kind = 'session-ended' | 'fetch-failing' | 'fetch-not-running'

export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return 'never'
  const m = Math.round((now - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Pure decision: which problem (if any) the recorded fetch results show. */
export function assess(
  status: Record<string, MotdFetchStatus | null>,
  now: number,
  { failRuns, staleMs }: { failRuns: number; staleMs: number },
): { kind: Kind | null; detail: string } {
  const entries = SPECTRUM_MOTDS.map(m => ({ label: m.label, s: status[m.channelId] ?? null }))
  const notRunning = entries.filter(e => !e.s || now - new Date(e.s.at).getTime() > staleMs)
  if (notRunning.length) {
    return { kind: 'fetch-not-running', detail: notRunning.map(e => `${e.label}: last fetch ${ago(e.s?.at, now)}`).join('\n') }
  }
  const denied = entries.filter(e => e.s!.code === SESSION_ENDED_CODE && e.s!.failStreak >= failRuns)
  if (denied.length) {
    return { kind: 'session-ended', detail: denied.map(e => `${e.label}: denied ${e.s!.failStreak} runs in a row, last OK ${ago(e.s!.lastOkAt, now)}`).join('\n') }
  }
  const failing = entries.filter(e => !e.s!.ok && e.s!.failStreak >= failRuns)
  if (failing.length) {
    return { kind: 'fetch-failing', detail: failing.map(e => `${e.label}: ${e.s!.code}, ${e.s!.failStreak} runs in a row, last OK ${ago(e.s!.lastOkAt, now)}`).join('\n') }
  }
  return { kind: null, detail: '' }
}

