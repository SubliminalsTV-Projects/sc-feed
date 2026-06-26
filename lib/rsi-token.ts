import { getConfigValue } from './sc-config'

// Resolves the RSI session cookie (`Rsi-Token`) used for the cron's Spectrum/MOTD/dev-tracker
// fetches. Source of truth is the locked `sc_feed_config` row (key=`rsi_token`), pushed by the
// browser extension; falls back to the `RSI_TOKEN` env var when PB has none or is unreachable —
// so the old env-based flow keeps working and a PB blip can never blank a good token.
//
// Cached per process. This is a LONG-LIVED process (the Coolify Next.js server also services the
// cron, which now curls these endpoints rather than running as a fresh tsx process each cycle), so
// the cache must be invalidated whenever the token changes — otherwise the server keeps validating
// and fetching MOTD with whatever token was current at container boot, ignoring every extension
// push until the next redeploy/restart. Two safeguards: (1) the push endpoint calls
// `resetRsiTokenCache()` the instant a new token lands, and (2) the cron + spectrum-health pass
// `force` so each cycle/probe reflects the current stored token. The cache then only serves WITHIN
// a single request (build headers many times off one fetch), which is its only intended purpose.
let _token: string | null = null

export async function loadRsiToken(force = false): Promise<string> {
  if (!force && _token !== null) return _token
  let pb = ''
  try { pb = await getConfigValue('rsi_token') } catch { /* PB unreachable / no admin creds → env fallback */ }
  _token = pb || (process.env.RSI_TOKEN ?? '')
  return _token
}

// Drop the cached token so the next loadRsiToken() re-reads the config singleton. Called by the
// owner push endpoint immediately after storing a freshly pushed token.
export function resetRsiTokenCache(): void {
  _token = null
}

export function rsiTokenValue(): string {
  return _token ?? (process.env.RSI_TOKEN ?? '')
}
