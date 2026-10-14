import type { MetadataRoute } from 'next'

// Public pages. No lastModified: the feed changes every ten minutes and the rest rarely, and
// none has a date worth claiming.
export default function sitemap(): MetadataRoute.Sitemap {
  return ['/', '/privacy', '/bot', '/bot/privacy', '/bot/terms'].map(p => ({ url: `https://sc-feed.subliminal.gg${p}` }))
}
