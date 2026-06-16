import NextAuth, { type DefaultSession } from 'next-auth'
import Google from 'next-auth/providers/google'
import Twitch from 'next-auth/providers/twitch'
import Discord from 'next-auth/providers/discord'

declare module 'next-auth' {
  interface Session {
    user: {
      role: 'owner' | 'guest'
    } & DefaultSession['user']
  }
}

// Same model + same OAuth apps as subliminal.gg (so accounts are shared across
// *.subliminal.gg). Anyone can sign in — that's the Phase-2 guest tier (settings/feed sync
// per account). Only the emails below are 'owner', which is what gates the RSI-token push
// endpoint (app/api/owner/*). A guest signing in NEVER gains owner access, so a guest's RSI
// cookie can never be stored. To onboard another owner, add their email here.
const ROLES: Record<string, 'owner'> = {
  'sub@subliminal.gg': 'owner',
  'subliminal1988@gmail.com': 'owner',
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET }),
    Twitch({ clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET }),
    Discord({ clientId: process.env.DISCORD_OAUTH_CLIENT_ID, clientSecret: process.env.DISCORD_OAUTH_CLIENT_SECRET }),
  ],
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    async signIn({ user }) { return !!user.email },
    async jwt({ token, user }) {
      const t = token as Record<string, unknown>
      if (user?.email) t.role = ROLES[user.email] ?? 'guest'
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = ((token as Record<string, unknown>).role ?? 'guest') as 'owner' | 'guest'
      }
      return session
    },
  },
})
