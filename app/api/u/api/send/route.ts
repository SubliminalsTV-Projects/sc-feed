import { UMAMI_ORIGIN } from '@/lib/analytics'

// Umami's collect endpoint, proxied first-party (see lib/analytics.ts).
//
// 🔴 The visitor's IP travels in `x-client-ip`, NOT `x-forwarded-for`: this hop goes back out
// through the Coolify proxy to stats.subliminal.gg, and Traefik replaces an untrusted
// X-Forwarded-For with the VPS's own address — every visitor would geolocate to the VPS. The Umami
// service sets CLIENT_IP_HEADER=x-client-ip, which Traefik leaves alone. Verified 2026-09-14: a
// German IP in the header recorded DE; the same request without it recorded the sender's country.

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': req.headers.get('user-agent') || '',
  }
  if (ip) headers['x-client-ip'] = ip
  // Umami hands the tracker a session token and expects it back on every later event.
  const cache = req.headers.get('x-umami-cache')
  if (cache) headers['x-umami-cache'] = cache

  try {
    const res = await fetch(`${UMAMI_ORIGIN}/api/send`, {
      method: 'POST',
      headers,
      body: await req.text(),
      signal: AbortSignal.timeout(5000),
    })
    return new Response(await res.text(), {
      status: res.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    console.error('[analytics] collect failed:', err)
    return new Response(null, { status: 204 })
  }
}
