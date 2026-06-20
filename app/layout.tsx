import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { GoogleAnalytics } from '@next/third-parties/google'
import { Providers } from './providers'
import './globals.css'

const gaId = process.env.NEXT_PUBLIC_GA_ID

// Self-hosted (was next/font/google). Google's build-time font fetch was timing out in the
// Coolify build container ("Retrying 1/3…"), slowing builds and causing transient failures.
// Variable woff2s live in app/fonts; same CSS-var names so globals.css is unchanged.
const spaceGrotesk = localFont({
  src: './fonts/space-grotesk-latin-variable.woff2',
  variable: '--font-sg',
  weight: '300 700',
  display: 'swap',
})

const inter = localFont({
  src: './fonts/inter-latin-variable.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL('https://sc-feed.subliminal.gg'),
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent' },
  icons: {
    icon: '/logos/[SCFeed][Logo][Avatar][Color].svg',
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#ffb231',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>
          <div className="h-screen overflow-hidden flex flex-col bg-background">
            {children}
          </div>
        </Providers>
        {gaId ? <GoogleAnalytics gaId={gaId} /> : null}
      </body>
    </html>
  )
}
