import { UMAMI_ORIGIN } from '@/lib/analytics'

// The Umami tracker, served first-party (see lib/analytics.ts). It posts to
// "<its own folder>/api/send", so serving it from /api/u/ makes it post to the sibling route.

// Request-time, not prerendered: a build-time fetch would make the Coolify build depend on
// stats.subliminal.gg and cache a failed fetch as the page for an hour. The upstream response
// is cached for an hour in the data cache instead.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await fetch(`${UMAMI_ORIGIN}/script.js`, { signal: AbortSignal.timeout(5000), next: { revalidate: 3600 } })
    if (!res.ok) throw new Error(`upstream ${res.status}`)
    return new Response(await res.text(), {
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    // Analytics down must never be visible: the page simply loads no tracker.
    console.error('[analytics] tracker fetch failed:', err)
    return new Response('', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
