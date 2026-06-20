import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, kbDiffs } from '@/lib/db'

// Serves the frozen diff for a single Knowledge Base [Updated] card on demand
// (the card only ships a small summary; the full diff_html is fetched when the
// user opens the "What Changed" detail view).

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const msgId = new URL(request.url).searchParams.get('msg_id')
  if (!msgId) return NextResponse.json({ error: 'msg_id required' }, { status: 400 })

  try {
    const d = (await db.select().from(kbDiffs).where(eq(kbDiffs.msgId, msgId)).limit(1))[0]
    if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 })

    return NextResponse.json(
      {
        msg_id:    d.msgId,
        title:     d.title,
        url:       d.url,
        summary:   d.summary,
        added:     d.added,
        removed:   d.removed,
        diff_html: d.diffHtml,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    )
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
