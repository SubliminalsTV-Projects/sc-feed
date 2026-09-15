import { eq, sql } from 'drizzle-orm'
import { jsonb, pgSchema, text, timestamp } from 'drizzle-orm/pg-core'
import { db } from './db'

// Per-account settings sync (`scfeed.sc_feed_user_prefs`). One row per signed-in email holding
// the browser's SC Feed settings — layout, presets, theme, custom feeds, read state — as a flat
// { localStorageKey: value } map. The client (sc-feed-prefs-sync.tsx) decides which keys sync;
// the server just stores the latest copy. Last write wins.
//
// The table is defined here rather than in lib/db.ts so this feature stays in one place.
// NO `import 'server-only'` here — breaks the tsx runner used by scripts/local-cron.ts.

const userPrefs = pgSchema('scfeed').table('sc_feed_user_prefs', {
  accountEmail: text('account_email').primaryKey(),
  prefs:        jsonb('prefs').$type<Record<string, string>>().notNull(),
  updated:      timestamp('updated', { withTimezone: true }).notNull().defaultNow(),
})

export type PrefsRow = { prefs: Record<string, string>; updated: string }

export async function getPrefs(email: string): Promise<PrefsRow | null> {
  const [row] = await db.select().from(userPrefs).where(eq(userPrefs.accountEmail, email)).limit(1)
  return row ? { prefs: row.prefs, updated: row.updated.toISOString() } : null
}

export async function putPrefs(email: string, prefs: Record<string, string>): Promise<string> {
  const [row] = await db.insert(userPrefs)
    .values({ accountEmail: email, prefs })
    .onConflictDoUpdate({ target: userPrefs.accountEmail, set: { prefs, updated: sql`now()` } })
    .returning({ updated: userPrefs.updated })
  return row.updated.toISOString()
}
