import { getConfigValue } from './sc-config'

// Resolves the RSI session cookie (`Rsi-Token`) used for the cron's Spectrum/MOTD/dev-tracker
// fetches. Source of truth is the locked `sc_feed_config` row (key=`rsi_token`), pushed by the
// browser extension; falls back to the `RSI_TOKEN` env var when PB has none or is unreachable —
// so the old env-based flow keeps working and a PB blip can never blank a good token.
//
// Cached per process: the local cron runs all 5 endpoints in one node process, so the token is
// fetched once per cycle. Call `loadRsiToken()` at the start of any request that needs it, then
// read `rsiTokenValue()` synchronously wherever headers are built.
let _token: string | null = null

export async function loadRsiToken(force = false): Promise<string> {
  if (!force && _token !== null) return _token
  let pb = ''
  try { pb = await getConfigValue('rsi_token') } catch { /* PB unreachable / no admin creds → env fallback */ }
  _token = pb || (process.env.RSI_TOKEN ?? '')
  return _token
}

export function rsiTokenValue(): string {
  return _token ?? (process.env.RSI_TOKEN ?? '')
}
