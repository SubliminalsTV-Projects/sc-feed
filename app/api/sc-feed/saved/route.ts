import { NextResponse } from 'next/server'
import { resolveCaller, listSaved } from '@/lib/sc-saved'

// Per-user "Saved" list read API. Returns the caller's own saved items as { messages },
// matching the shape the client's virtual-feed fan-out expects (like youtube-proxy/rss-proxy).
// Empty for anonymous visitors. NEVER CDN-cached (per-user) — no-store, force-dynamic.

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const email = await resolveCaller(req)
  if (!email) return NextResponse.json({ messages: [] }, { headers: { 'Cache-Control': 'no-store' } })
  try {
    const messages = await listSaved(email)
    return NextResponse.json({ messages }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ messages: [], error: String(e) }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
