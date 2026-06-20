import { timingSafeEqual } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { db, saved } from './db'
import type { FeedMessage } from '@/app/api/sc-feed/route'

// Server helpers for the per-user "Saved" list (`sc_feed_saved`, scfeed schema). A save is
// attributed to an email: a signed-in NextAuth user (owner OR guest) → their own email; the
// browser extension authenticates with the owner push secret → the owner email. Every read/
// write filters by that email, so one user's bookmarks are never visible to another.
//
// NO `import 'server-only'` here — breaks the tsx runner used by scripts/local-cron.ts.

const OWNER_EMAIL = process.env.OWNER_PUSH_EMAIL ?? 'sub@subliminal.gg'

export type SavedRow = { id: string; account_email: string; url: string; title: string; source_type: string; created: string }

function secretOk(req: Request): boolean {
  const secret = process.env.OWNER_PUSH_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!presented) return false
  const a = Buffer.from(presented), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The email this request acts as, or null if neither signed in nor holding the owner secret. */
export async function resolveCaller(req: Request): Promise<string | null> {
  const session = await auth().catch(() => null)
  const email = session?.user?.email
  if (email) return email.toLowerCase()
  if (secretOk(req)) return OWNER_EMAIL.toLowerCase()
  return null
}

export function inferSourceType(url: string): string {
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { return 'web' }
  if (/(^|\.)robertsspaceindustries\.com$/.test(host)) return 'rsi'
  if (/(^|\.)reddit\.com$/.test(host) || host === 'redd.it') return 'reddit'
  if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') return 'youtube'
  return 'web'
}

const SOURCE_LABEL: Record<string, string> = { rsi: 'RSI', reddit: 'Reddit', youtube: 'YouTube', web: 'Web' }

/** All saved rows for an email, newest first, mapped to the feed's message shape. */
export async function listSaved(email: string): Promise<FeedMessage[]> {
  const rows = await db.select().from(saved)
    .where(eq(saved.accountEmail, email))
    .orderBy(desc(saved.created))
    .limit(100)
  return rows.map(r => {
    const iso = r.created.toISOString()
    return {
      id: String(r.id),
      title: r.title || r.url,
      url: r.url,
      source: SOURCE_LABEL[r.sourceType] ?? 'Web',
      timestamp: iso,
      ts_raw: iso,
      tag: 'SAVED',
    }
  })
}

/** Upsert a save for an email (unique on account_email+url, so re-saving is a no-op). */
export async function addSaved(email: string, url: string, title: string): Promise<{ ok: true; deduped?: boolean }> {
  const inserted = await db.insert(saved)
    .values({ accountEmail: email, url, title, sourceType: inferSourceType(url) })
    .onConflictDoNothing({ target: [saved.accountEmail, saved.url] })
    .returning({ id: saved.id })
  return inserted.length ? { ok: true } : { ok: true, deduped: true }
}

/** Remove a save — by record id OR by url — but only if it belongs to this email. */
export async function removeSaved(email: string, opts: { id?: string; url?: string }): Promise<void> {
  // Ownership is enforced by including account_email in the WHERE clause.
  if (opts.id) {
    const id = Number(opts.id)
    if (Number.isFinite(id)) await db.delete(saved).where(and(eq(saved.id, id), eq(saved.accountEmail, email)))
  } else if (opts.url) {
    await db.delete(saved).where(and(eq(saved.url, opts.url), eq(saved.accountEmail, email)))
  }
}
