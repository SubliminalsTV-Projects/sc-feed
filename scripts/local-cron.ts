/**
 * Local sc-feed cron runner.
 *
 * Executes the SAME ingest that the Vercel cron endpoints run, but on this host
 * (Monitarr today, OVH later), writing straight to PocketBase. This moves the
 * 24/7 Active-CPU load off Vercel without changing freshness.
 *
 * It invokes the route GET handlers directly, so there is exactly ONE copy of the
 * ingest logic — the route files themselves, shared with the Vercel deployment.
 * No forked logic to drift.
 *
 * Run:  npx tsx scripts/local-cron.ts
 * Env:  the wrapper (fire-local-sc-feed.sh) sources .env.mission-control and
 *       overrides POCKETBASE_URL to the public host. Env MUST be set before this
 *       module is imported — _shared.ts reads RSI_TOKEN/DISCORD_BOT_TOKEN at load.
 */
import { GET as discord } from '../app/api/cron/sc-feed/discord/route'
import { GET as spectrum } from '../app/api/cron/sc-feed/spectrum/route'
import { GET as status } from '../app/api/cron/sc-feed/status/route'
import { GET as youtube } from '../app/api/cron/sc-feed/youtube/route'
import { GET as prune } from '../app/api/cron/sc-feed/prune/route'

const SECRET = process.env.CRON_SECRET ?? ''
const ONLY = process.argv[2] // optional: run a single source, e.g. `tsx local-cron.ts discord`

const steps: Array<[string, (req: Request) => Promise<Response>]> = [
  ['discord', discord],
  ['spectrum', spectrum],
  ['status', status],
  ['youtube', youtube],
  ['prune', prune],
]

function makeRequest() {
  return new Request(`http://local/?secret=${encodeURIComponent(SECRET)}`)
}

async function run() {
  let failures = 0
  for (const [name, handler] of steps) {
    if (ONLY && ONLY !== name) continue
    const t0 = Date.now()
    try {
      const res = await handler(makeRequest())
      const body = await res.json().catch(() => ({}))
      const secs = ((Date.now() - t0) / 1000).toFixed(1)
      const summary = JSON.stringify(body).slice(0, 300)
      console.log(`[${new Date().toISOString()}] ${name.padEnd(8)} HTTP ${res.status} ${secs}s ${summary}`)
      if (!res.ok) failures++
    } catch (err) {
      failures++
      console.error(`[${new Date().toISOString()}] ${name.padEnd(8)} THREW ${String(err)}`)
    }
  }
  return failures
}

run().then(f => process.exit(f > 0 ? 1 : 0))
