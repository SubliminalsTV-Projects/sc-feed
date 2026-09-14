import type { Metadata } from 'next'
import { ScFeedView } from '@/components/sc-feed/sc-feed-view'

const DESCRIPTION = 'Live Star Citizen news — patch notes, developer updates, community highlights, and in-game MOTDs updated in real time.'

// The share image is app/opengraph-image.tsx (a 1200×630 card), picked up by file convention —
// so no `images` here; setting them would put the old 512px icon back.
export const metadata: Metadata = {
  title: 'SC Feed — Live Star Citizen News',
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    title: 'SC Feed — Live Star Citizen News',
    description: DESCRIPTION,
    siteName: 'SubliminalsTV',
    type: 'website',
    url: 'https://sc-feed.subliminal.gg/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SC Feed — Live Star Citizen News',
    description: DESCRIPTION,
  },
}

export default function ScFeedPage() {
  return (
    <>
      {/* The feed renders in the browser, so this is the one heading a crawler (or a screen
          reader landing on the page) gets. Visually hidden: the header already shows the logo. */}
      <h1 className="sr-only">SC Feed — live Star Citizen news</h1>
      <ScFeedView />
    </>
  )
}
