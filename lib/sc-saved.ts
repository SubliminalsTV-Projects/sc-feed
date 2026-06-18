import { timingSafeEqual } from 'node:crypto'
import { auth } from '@/auth'
import { pbAdminFetch } from './pb-admin'
import type { FeedMessage } from '@/app/api/sc-feed/route'

// Server helpers for the per-user "Saved" list (`sc_feed_saved`, admin-only collection).
// A save is attributed to an email: a signed-in NextAuth user (owner OR guest) → their own
// email; the browser extension authenticates with the owner push secret → the owner email.
// All reads/writes go through the superuser client (lib/pb-admin) and filter by that email,
// so one user's bookmarks are never visible to another.
//
// NO `import 'server-only'` here — like lib/pb-admin / lib/sc-config, that breaks the tsx
// runner used by scripts/local-cron.ts.

const COLLECTION = 'sc_feed_saved'
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

const f = (key: string, val: string) => `${key}="${val.replace(/"/g, '\\"')}"`

/** All saved rows for an email, newest first, mapped to the feed's message shape. */
export async function listSaved(email: string): Promise<FeedMessage[]> {
  const res = await pbAdminFetch(
    `/api/collections/${COLLECTION}/records?perPage=100&sort=-created&filter=${encodeURIComponent(f('account_email', email))}`,
  )
  if (!res.ok) throw new Error(`PB read failed: ${res.status}`)
  const j = (await res.json()) as { items: SavedRow[] }
  return j.items.map(r => ({
    id: r.id,
    title: r.title || r.url,
    url: r.url,
    source: SOURCE_LABEL[r.source_type] ?? 'Web',
    timestamp: r.created,
    ts_raw: r.created,
    tag: 'SAVED',
  }))
}

/** Upsert a save for an email (unique on account_email+url, so re-saving is a no-op). */
export async function addSaved(email: string, url: string, title: string): Promise<{ ok: true; deduped?: boolean }> {
  const body = JSON.stringify({ account_email: email, url, title, source_type: inferSourceType(url) })
  const res = await pbAdminFetch(`/api/collections/${COLLECTION}/records`, { method: 'POST', body })
  if (res.ok) return { ok: true }
  // 400 with the unique index hit means it's already saved — treat as success.
  if (res.status === 400) {
    const txt = await res.text().catch(() => '')
    if (/unique|account_email/i.test(txt)) return { ok: true, deduped: true }
    throw new Error(`PB write failed: 400 ${txt}`)
  }
  throw new Error(`PB write failed: ${res.status} ${await res.text().catch(() => '')}`)
}

/** Remove a save — by record id OR by url — but only if it belongs to this email. */
export async function removeSaved(email: string, opts: { id?: string; url?: string }): Promise<void> {
  let id = opts.id
  if (!id && opts.url) {
    const res = await pbAdminFetch(
      `/api/collections/${COLLECTION}/records?perPage=1&filter=${encodeURIComponent(`${f('account_email', email)} && ${f('url', opts.url)}`)}`,
    )
    if (!res.ok) throw new Error(`PB read failed: ${res.status}`)
    id = ((await res.json()) as { items: SavedRow[] }).items[0]?.id
  }
  if (!id) return // nothing to delete
  // Ownership check: only delete if the row belongs to this email.
  const row = await pbAdminFetch(`/api/collections/${COLLECTION}/records/${id}`)
  if (!row.ok) return
  const r = (await row.json()) as SavedRow
  if (r.account_email?.toLowerCase() !== email.toLowerCase()) throw new Error('forbidden')
  const del = await pbAdminFetch(`/api/collections/${COLLECTION}/records/${id}`, { method: 'DELETE' })
  if (!del.ok && del.status !== 404) throw new Error(`PB delete failed: ${del.status}`)
}
