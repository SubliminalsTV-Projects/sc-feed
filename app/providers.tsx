'use client'

import { SessionProvider } from 'next-auth/react'

// Client boundary for next-auth so components can useSession(). The public feed works
// signed-out; this just exposes login state for the account menu + owner areas.
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>
}
