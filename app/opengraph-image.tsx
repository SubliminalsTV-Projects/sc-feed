import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'

// The link-preview card (Discord, X, Reddit, iMessage). It replaced the 512px app icon, which
// every platform rendered as a small square thumbnail beside the text instead of a full-width
// card. Static: rendered once at build, nothing on it goes stale.
//
// Satori's built-in font on purpose. The site's own faces ship as woff2, which Satori can't
// read, and fetching a TTF from Google at build time is exactly what used to stall the
// Coolify build (see app/layout.tsx on the self-hosted fonts).

export const alt = 'SC Feed — live Star Citizen news'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  const icon = await readFile(join(process.cwd(), 'public/icons/icon-512.png'))
  const iconSrc = `data:image/png;base64,${icon.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          padding: '0 96px',
          backgroundColor: '#0e1013',
          // Satori drops a `background` shorthand — gradients must be backgroundImage.
          backgroundImage: 'radial-gradient(circle at 18% 50%, rgba(255,178,49,0.20), rgba(14,16,19,0) 55%)',
          color: '#f2efe9',
        }}
      >
        <img src={iconSrc} width={280} height={280} style={{ flexShrink: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 72 }}>
          <div style={{ display: 'flex', fontSize: 26, letterSpacing: 6, color: '#ffb231', fontWeight: 700 }}>
            LIVE STAR CITIZEN NEWS
          </div>
          <div style={{ display: 'flex', fontSize: 124, fontWeight: 800, lineHeight: 1, marginTop: 14 }}>SC Feed</div>
          <div style={{ display: 'flex', fontSize: 34, lineHeight: 1.35, color: '#b9b3a8', marginTop: 26, maxWidth: 640 }}>
            Patch notes, dev posts, Spectrum, comm-links and MOTDs in one feed.
          </div>
          <div style={{ display: 'flex', fontSize: 28, color: '#ffb231', marginTop: 34 }}>sc-feed.subliminal.gg</div>
        </div>
        <div
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10, width: 1200, backgroundColor: '#ffb231' }}
        />
      </div>
    ),
    size,
  )
}
