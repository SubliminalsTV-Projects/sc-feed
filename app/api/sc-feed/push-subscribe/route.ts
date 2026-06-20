import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, pushSubscriptions } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const { endpoint, p256dh, auth } = await request.json() as { endpoint: string; p256dh: string; auth: string }
    if (!endpoint || !p256dh || !auth)
      return NextResponse.json({ error: 'missing fields' }, { status: 400 })

    await db.insert(pushSubscriptions)
      .values({ endpoint, p256dh, auth, updated: new Date() })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh, auth, updated: new Date() } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { endpoint } = await request.json() as { endpoint: string }
    if (!endpoint)
      return NextResponse.json({ error: 'missing endpoint' }, { status: 400 })

    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
