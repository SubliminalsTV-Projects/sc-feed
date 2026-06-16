import { NextResponse } from 'next/server'

// Serves the frozen diff for a single Knowledge Base [Updated] card on demand
// (the card only ships a small summary; the full diff_html is fetched when the
// user opens the "What Changed" detail view).

const PB_URL = process.env.POCKETBASE_URL ?? 'https://mc-db.subliminal.gg'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const msgId = new URL(request.url).searchParams.get('msg_id')
  if (!msgId) return NextResponse.json({ error: 'msg_id required' }, { status: 400 })

  try {
    const res = await fetch(
      `${PB_URL}/api/collections/sc_feed_kb_diffs/records?filter=msg_id%3D"${encodeURIComponent(msgId)}"&perPage=1`,
      { headers: { 'Content-Type': 'application/json' }, next: { revalidate: 0 } }
    )
    if (!res.ok) throw new Error(`PB ${res.status}`)
    const data = await res.json()
    const d = data.items?.[0]
    if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 })

    return NextResponse.json(
      {
        msg_id:    d.msg_id,
        title:     d.title,
        url:       d.url,
        summary:   d.summary,
        added:     d.added,
        removed:   d.removed,
        diff_html: d.diff_html,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    )
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
