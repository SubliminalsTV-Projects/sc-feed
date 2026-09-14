// Analytics config + the rule for who gets no tag. Mirrors subliminal-gg's lib/analytics/* so the
// two sites count visitors the same way.
//
// 🔴 THE BOT RULE. From 2026-09-04 a headless crawler put ~204K fake users into the GA property
// these two sites share (Chrome · Macintosh · screen 1366x1366, residential proxies in ~100
// countries). It hit subliminal.gg/archive, not this app — but the tell is the device, not the
// page, and the next crawler can land anywhere. No shipping laptop or desktop has a square screen.

export interface ClientTraits {
  webdriver: boolean
  screenWidth: number
  screenHeight: number
}

export function isAutomatedClient(t: ClientTraits): boolean {
  if (t.webdriver) return true
  if (t.screenWidth === t.screenHeight && t.screenWidth >= 1000) return true
  return false
}

/** Sub's own backend is not a visit. */
export function isUntrackedPath(pathname: string): boolean {
  return pathname === '/owner' || pathname.startsWith('/owner/')
}

// Self-hosted Umami (Coolify service `umami`, stats.subliminal.gg). Both values are public — the
// id is printed into every page — so they default here and need no Coolify env var; the env vars
// only override. The browser never talks to stats.subliminal.gg directly: it loads /api/u/s.js and
// posts to /api/u/api/send on this origin (app/api/u/*), which keeps it clear of ad-block host lists.
export const UMAMI_ORIGIN = (process.env.UMAMI_URL || 'https://stats.subliminal.gg').replace(/\/$/, '')

/** The "SC Feed" website in Umami (subliminal.gg is a separate website, a1d312ea-…).
 *  UMAMI_WEBSITE_ID="" turns the Umami tag off. */
export const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID ?? 'e175be30-2e36-49ee-90fe-64c6df5fb2cd'
