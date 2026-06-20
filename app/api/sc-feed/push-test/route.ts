import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, pushSubscriptions } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Sends a test push to the caller's own subscription (matched by endpoint).
// Used by the "Send test" button in Settings → Push Notifications to verify
// the full chain end-to-end (VAPID keys → web-push → push service → device).
export async function POST(request: Request) {
  try {
    const { endpoint } = await request.json() as { endpoint?: string }
    if (!endpoint) {
      return NextResponse.json({ error: 'missing endpoint' }, { status: 400 })
    }

    const vapidPublic = process.env.VAPID_PUBLIC_KEY
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY
    if (!vapidPublic || !vapidPrivate) {
      return NextResponse.json({ error: 'VAPID keys not configured on server' }, { status: 500 })
    }

    const sub = (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1))[0]
    if (!sub) {
      return NextResponse.json({ error: 'subscription not registered server-side — toggle push off and back on' }, { status: 404 })
    }

    const webpush = (await import('web-push')).default
    webpush.setVapidDetails('mailto:sub@subliminal.gg', vapidPublic, vapidPrivate)

    const payload = JSON.stringify({
      title: 'SC Feed test notification',
      body: 'If you see this, push delivery is working end-to-end.',
      url: '/',
    })

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60 }
      )
      return NextResponse.json({ ok: true })
    } catch (err) {
      const status = (typeof err === 'object' && err !== null && 'statusCode' in err)
        ? (err as { statusCode: number }).statusCode
        : null
      return NextResponse.json(
        { error: `push send failed${status ? ` (HTTP ${status})` : ''}: ${String(err)}` },
        { status: 500 },
      )
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
