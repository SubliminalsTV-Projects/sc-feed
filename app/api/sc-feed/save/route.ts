import { NextResponse } from 'next/server'
import { resolveCaller, addSaved, removeSaved } from '@/lib/sc-saved'

// Per-user "Saved" list write API. POST saves a page (URL + title); DELETE unsaves it.
// Caller identity = NextAuth session email (owner or guest) OR the owner push secret used by
// the browser extension's "Send to SC Feed" context menu. Reads live on GET /api/sc-feed/saved.

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const email = await resolveCaller(req)
  if (!email) return NextResponse.json({ error: 'sign in to save' }, { status: 401 })

  let url = '', title = ''
  try {
    const b = (await req.json()) as { url?: unknown; title?: unknown }
    url = String(b.url ?? '').trim()
    title = String(b.title ?? '').trim()
  } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  // Must be a real http(s) URL; cap the title so a runaway page can't bloat the row.
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol')
  } catch { return NextResponse.json({ error: 'valid http(s) url required' }, { status: 422 }) }
  if (!title) title = url
  if (title.length > 300) title = title.slice(0, 300)

  try {
    const r = await addSaved(email, url, title)
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  const email = await resolveCaller(req)
  if (!email) return NextResponse.json({ error: 'sign in to unsave' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id') ?? undefined
  const url = searchParams.get('url') ?? undefined
  if (!id && !url) return NextResponse.json({ error: 'id or url required' }, { status: 400 })

  try {
    await removeSaved(email, { id, url })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = String(e)
    return NextResponse.json({ error: msg }, { status: msg.includes('forbidden') ? 403 : 500 })
  }
}
