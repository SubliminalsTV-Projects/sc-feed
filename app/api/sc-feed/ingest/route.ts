import { NextResponse } from 'next/server'
import { upsertMessage } from '@/app/api/cron/sc-feed/_shared'

// Authenticated single-message ingest. External writers (e.g. Sub's Minion, which relays
// @RobertsSpaceInd tweets into the `twitter-rsi` channel) POST a message here instead of
// writing the database directly — Timescale stays private; this is the only write path in.
// Gated by ?secret=CRON_SECRET, same as the cron endpoints.

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  try {
    const b = await request.json() as {
      channel_id?: string; channel_label?: string; msg_id?: string; title?: string
      body?: string; url?: string; source?: string; msg_timestamp?: string; ts_raw?: string; image?: string
    }
    if (!b.msg_id || !b.channel_id) {
      return NextResponse.json({ error: 'msg_id and channel_id required' }, { status: 400 })
    }
    const isNew = await upsertMessage(b.channel_id, b.channel_label ?? '', {
      msg_id:        b.msg_id,
      title:         b.title ?? '',
      body:          b.body ?? '',
      url:           b.url ?? '',
      source:        b.source ?? '',
      msg_timestamp: b.msg_timestamp ?? '',
      ts_raw:        b.ts_raw || new Date().toISOString(),
      image:         b.image ?? '',
    })
    return NextResponse.json({ ok: true, isNew })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
