import type { MetadataRoute } from 'next'

// Two public pages. No lastModified: the feed changes every ten minutes and the privacy page
// rarely, and neither has a date worth claiming.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: 'https://sc-feed.subliminal.gg/' }, { url: 'https://sc-feed.subliminal.gg/privacy' }]
}
