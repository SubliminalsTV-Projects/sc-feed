import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/owner', '/login'] }],
    sitemap: 'https://sc-feed.subliminal.gg/sitemap.xml',
  }
}
