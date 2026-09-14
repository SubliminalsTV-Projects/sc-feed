import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Playwright (used only by the local Monitarr cron to render Comm-Link bodies) must never
  // be bundled/traced into the Vercel functions — it's a devDependency and the dynamic
  // import is wrapped so it no-ops where chromium isn't present.
  serverExternalPackages: ['playwright'],

  async redirects() {
    return [
      // sc-feed-vps.subliminal.gg is a leftover migration domain on this same Coolify app, and it
      // served a byte-identical second copy of the feed — duplicate content that splits ranking.
      // Pages move to the canonical host. /api/* is left alone ON PURPOSE: a redirect turns a POST
      // into a GET, so any writer still pointed at the old host (the ingest endpoint, the
      // extension's pushes) must keep working rather than silently fail.
      {
        source: '/:path((?!api/).*)',
        has: [{ type: 'host', value: 'sc-feed-vps.subliminal.gg' }],
        destination: 'https://sc-feed.subliminal.gg/:path',
        permanent: true,
      },
    ]
  },
}

export default nextConfig
