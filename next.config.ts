import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Playwright (used only by the local Monitarr cron to render Comm-Link bodies) must never
  // be bundled/traced into the Vercel functions — it's a devDependency and the dynamic
  // import is wrapped so it no-ops where chromium isn't present.
  serverExternalPackages: ['playwright'],
}

export default nextConfig
