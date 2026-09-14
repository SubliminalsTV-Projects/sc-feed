'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'
import { GoogleAnalytics } from '@next/third-parties/google'
import { isAutomatedClient, isUntrackedPath } from '@/lib/analytics'

// Both analytics tags, and the one decision about whether either loads. The check needs the
// screen size, which only exists in the browser, so nothing renders on the server and the tags
// mount after hydration — the same moment @next/third-parties loaded GA before this.
export function Analytics({ gaId, umamiWebsiteId }: { gaId?: string; umamiWebsiteId?: string }) {
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (isUntrackedPath(window.location.pathname)) return
    const traits = {
      webdriver: navigator.webdriver === true,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    }
    if (isAutomatedClient(traits)) return
    setAllowed(true)
  }, [])

  if (!allowed) return null
  return (
    <>
      {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      {umamiWebsiteId ? (
        <Script src="/api/u/s.js" data-website-id={umamiWebsiteId} strategy="afterInteractive" />
      ) : null}
    </>
  )
}
