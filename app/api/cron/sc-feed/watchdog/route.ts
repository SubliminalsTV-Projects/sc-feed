import { NextResponse } from 'next/server'
import { requireSecret, stampCronHeartbeat, SPECTRUM_MOTDS } from '../_shared'
import { getAllMotdFetchStatus } from '../motd'
import { ago, assess, type Kind } from './assess'
import { getConfigValue, setConfigValue } from '@/lib/sc-config'

// MOTD watchdog. Alerts on the RESULT of the cron's real getMotd fetch (motd_fetch_<channel>),
// never on how old the extension's token push is.
//
// Why: until 2026-09 it alarmed on token-push age and extension scrape age. Both measure the
// messenger, not the outcome, and a broken extension alarm left it re-posting the same warning
// every day from 2026-08-04 — so everyone learned to ignore it. The fetch result is exact:
//   • ErrPermissionDenied N runs in a row → the RSI session ended. One message: sign in once.
//   • any other failing code N runs in a row → RSI or network trouble; says which code.
//   • no fetch recorded for over an hour → the spectrum cron itself stopped.
// A PC being off is not a failure any more (the fetch runs on the VPS), so it never alerts.
//
// De-duped via `watchdog_state`: one alert when a problem starts or changes kind, a reminder every
// WATCHDOG_RENOTIFY_HOURS while it lasts, and a recovery ping when it clears. Fired every 10 min
// by subliminal's crontab on the VPS (~/sc-feed-watchdog.sh).

export const dynamic = 'force-dynamic'

const H = 3600_000
const RENOTIFY_MS = (Number(process.env.WATCHDOG_RENOTIFY_HOURS) || 24) * H

type WatchdogState = { alerting: boolean; kind?: Kind | ''; since: string; lastNotified: string }
const EMPTY_STATE: WatchdogState = { alerting: false, kind: '', since: '', lastNotified: '' }

const MESSAGES: Record<Kind, { title: string; fix: string }> = {
  'session-ended': {
    title: '🔴 RSI session ended — sign in once',
    fix: "Sign in to robertsspaceindustries.com in Chrome (pick the longest 'stay signed in' option). The SC Feed extension delivers the new token and the MOTD resumes on the next cron run.",
  },
  'fetch-failing': {
    title: '⚠️ SC Feed: MOTD fetch failing',
    fix: 'Not a sign-in problem — RSI or the network is returning errors. Usually clears on its own; check RSI status if it lasts.',
  },
  'fetch-not-running': {
    title: '⚠️ SC Feed: MOTD fetch not running',
    fix: 'The spectrum cron has stopped recording results. Check /opt/sc-feed-cron.sh on the VPS and the app container.',
  },
}

async function sendDiscord(embed: Record<string, unknown>): Promise<{ sent: boolean; reason: string }> {
  const url = process.env.WATCHDOG_DISCORD_WEBHOOK
  if (!url) return { sent: false, reason: 'no webhook configured' }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'SC Feed Watchdog', embeds: [embed] }),
    })
    return { sent: res.ok, reason: res.ok ? '' : `discord ${res.status}` }
  } catch (e) {
    return { sent: false, reason: String(e) }
  }
}

export async function GET(request: Request) {
  const unauth = requireSecret(request)
  if (unauth) return unauth

  try {
    const now = Date.now()
    const status = await getAllMotdFetchStatus()
    const { kind, detail } = assess(status, now, {
      failRuns:  Number(process.env.WATCHDOG_FETCH_FAIL_RUNS) || 3,
      staleMs:  (Number(process.env.WATCHDOG_FETCH_STALE_HOURS) || 1) * H,
    })

    let state = EMPTY_STATE
    try { const raw = await getConfigValue('watchdog_state'); if (raw) state = { ...EMPTY_STATE, ...JSON.parse(raw) } } catch { /* keep empty */ }

    const fields = SPECTRUM_MOTDS.map(m => {
      const s = status[m.channelId]
      return { name: m.label, value: s ? `${s.code} · ${ago(s.at, now)}\nlast OK ${ago(s.lastOkAt, now)}` : 'never fetched', inline: true }
    })

    let action = 'none'
    let delivery: { sent: boolean; reason: string } | null = null

    if (kind) {
      const changed = !state.alerting || state.kind !== kind
      const dueAgain = !!state.lastNotified && now - new Date(state.lastNotified).getTime() > RENOTIFY_MS
      if (changed || dueAgain) {
        delivery = await sendDiscord({
          title: MESSAGES[kind].title,
          description: `${detail}\n\n**Fix:** ${MESSAGES[kind].fix}`,
          color: kind === 'session-ended' ? 0xf87171 : 0xffb231,
          fields,
          footer: { text: 'SC Feed watchdog · sc-feed.subliminal.gg/owner' },
        })
        action = changed ? 'alerted' : 're-alerted'
        state = {
          alerting: true, kind,
          since: changed ? new Date(now).toISOString() : state.since,
          lastNotified: new Date(now).toISOString(),
        }
        await setConfigValue('watchdog_state', JSON.stringify(state), { updated_via: 'watchdog' })
      } else {
        action = 'suppressed'
      }
    } else if (state.alerting) {
      delivery = await sendDiscord({
        title: '✅ SC Feed: MOTD fetch recovered',
        description: `getMotd is succeeding again (problem was: ${state.kind || 'unknown'}, since ${ago(state.since, now)}).`,
        color: 0x51cf66,
        fields,
        footer: { text: 'SC Feed watchdog' },
      })
      action = 'recovered'
      state = { ...EMPTY_STATE, lastNotified: new Date(now).toISOString() }
      await setConfigValue('watchdog_state', JSON.stringify(state), { updated_via: 'watchdog' })
    }

    const summary = {
      ok: true, problem: kind, action,
      fetch: Object.fromEntries(Object.entries(status).map(([ch, s]) => [ch, s ? { ok: s.ok, code: s.code, failStreak: s.failStreak } : null])),
      ...(delivery ? { delivered: delivery.sent, deliveryNote: delivery.reason } : {}),
    }
    await stampCronHeartbeat('watchdog', summary)
    return NextResponse.json(summary)
  } catch (err) {
    await stampCronHeartbeat('watchdog', { ok: false, error: String(err) })
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
