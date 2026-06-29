import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { auth } from '@/auth'
import { upsertMessage, SPECTRUM_MOTDS } from '@/app/api/cron/sc-feed/_shared'

// Owner-only endpoint that ingests a Spectrum MOTD scraped by the browser extension's content
// script. RSI made `getMotd` moderator-only (denied even to a logged-in Evocati member from a
// non-browser context), so the cron can no longer fetch the MOTD — but it's rendered in the
// lobby page, where the extension reads it and POSTs the text here. Owner-gated exactly like
// /api/owner/rsi-token: an owner NextAuth session OR the owner push secret.

export const dynamic = 'force-dynamic'

// channelId → label, from the single source of truth. Also the allow-list of valid channels.
const LABELS: Record<string, string> = Object.fromEntries(SPECTRUM_MOTDS.map(m => [m.channelId, m.label]))

function secretOk(req: Request): boolean {
  const secret = process.env.OWNER_PUSH_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization') ?? ''
  const presented = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!presented) return false
  const a = Buffer.from(presented), b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function authorized(req: Request): Promise<boolean> {
  const session = await auth().catch(() => null)
  if (session?.user?.role === 'owner') return true
  return secretOk(req)
}

// Cheap content signature — same algorithm as the extension, so a re-push of identical content
// maps to the same msg_id (idempotent) and a real change makes a new card.
function hashStr(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16)
}

export async function POST(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  let b: { channelId?: string; body?: string; url?: string; sig?: string }
  try { b = await req.json() as typeof b } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const channelId = String(b.channelId ?? '')
  const body = String(b.body ?? '').trim()
  if (!LABELS[channelId]) return NextResponse.json({ error: 'unknown channelId' }, { status: 400 })
  if (body.length < 4) return NextResponse.json({ error: 'empty MOTD body' }, { status: 422 })

  const sig = (b.sig && /^[a-f0-9]{1,16}$/.test(b.sig)) ? b.sig : hashStr(body)
  const title = body.replace(/\s+/g, ' ').trim().slice(0, 150)
  const nowIso = new Date().toISOString()

  try {
    const isNew = await upsertMessage(channelId, LABELS[channelId], {
      msg_id:        `motd-${channelId}-${sig}`,
      title,
      body,
      url:           String(b.url ?? ''),
      source:        'CIG',
      msg_timestamp: nowIso,
      ts_raw:        nowIso,
      image:         '',
    })
    return NextResponse.json({ ok: true, isNew })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
