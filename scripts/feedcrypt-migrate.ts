/**
 * Encrypt (or decrypt) the Discord-sourced text already stored in scfeed — see lib/feed-crypt.ts.
 *
 *   npx tsx scripts/feedcrypt-migrate.ts            # dry run: counts only, writes nothing
 *   npx tsx scripts/feedcrypt-migrate.ts --apply    # encrypt plain fields + hash bot dedupe keys
 *   npx tsx scripts/feedcrypt-migrate.ts --verify   # decrypt every encrypted field; exit 1 on any failure
 *   npx tsx scripts/feedcrypt-migrate.ts --decrypt --apply   # ROLLBACK: back to plain text
 *   add --limit N to stop after N rows are changed (try a few first; re-run carries on)
 *
 * Env: DATABASE_URL (a role that can UPDATE scfeed.sc_feed_messages, and feedbot.deliveries for
 * the dedupe step) and SCFEED_ENC_KEYS (the same value the apps use).
 *
 * Safe to re-run at any point, and safe while the cron is writing:
 * - Idempotent: a field that is already in the target state is left alone.
 * - Resumable: rows are walked by id in batches, each row its own UPDATE. Stop it anywhere and
 *   run it again; it skips what is done.
 * - Race-safe: each UPDATE only applies if the row still holds the values it read. A row the
 *   cron rewrote meanwhile is counted as "raced" and picked up by the next run.
 * - Prints counts and row ids only, never message text.
 */
import { sql } from '../lib/db'
import { aadFor, blindHash, decryptValue, ENC_FIELDS, encryptValue, isEncrypted, keyring } from '../lib/feed-crypt'
import { DISCORD_SOURCED_CHANNELS } from '../app/api/cron/sc-feed/_shared'

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const DECRYPT = args.has('--decrypt')
const VERIFY = args.has('--verify')
const BATCH = 200
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > 0 ? Number(process.argv[i + 1]) : Infinity })()

type Row = { id: number; msg_id: string } & Record<(typeof ENC_FIELDS)[number], string>

async function main() {
  const ring = keyring()
  if (!ring) throw new Error('SCFEED_ENC_KEYS is not set')
  const channels = [...DISCORD_SOURCED_CHANNELS]
  console.log(`mode=${VERIFY ? 'verify' : DECRYPT ? 'decrypt' : 'encrypt'} apply=${APPLY} activeKey=${ring.activeId} channels=${channels.length}`)

  let after = 0
  const n = { rows: 0, changed: 0, raced: 0, alreadyDone: 0, encryptedFields: 0, plainFields: 0, failed: 0 }
  while (n.changed < LIMIT) {
    const rows = await sql<Row[]>`
      select id, msg_id, title, body, url, source, image from scfeed.sc_feed_messages
      where channel_id = any(${channels}) and id > ${after}
      order by id limit ${BATCH}`
    if (!rows.length) break
    for (const r of rows) {
      if (n.changed >= LIMIT) break
      after = r.id
      n.rows++
      const next: Partial<Row> = {}
      for (const f of ENC_FIELDS) {
        const v = r[f]
        if (!v) continue
        if (isEncrypted(v)) {
          n.encryptedFields++
          if (VERIFY || DECRYPT) {
            try {
              const plain = decryptValue(v, aadFor(r.msg_id, f), ring)
              if (DECRYPT) next[f] = plain
            } catch (e) {
              n.failed++
              console.error(`FAIL id=${r.id} msg_id=${r.msg_id} field=${f}: ${(e as Error).message}`)
            }
          }
        } else {
          n.plainFields++
          if (!VERIFY && !DECRYPT) next[f] = encryptValue(v, aadFor(r.msg_id, f), ring)
        }
      }
      const fields = Object.keys(next) as (typeof ENC_FIELDS)[number][]
      if (!fields.length) { n.alreadyDone++; continue }
      if (!APPLY) { n.changed++; continue }
      // Only write if the row still holds exactly what we read (the cron may have rewritten it).
      const res = await sql`
        update scfeed.sc_feed_messages set ${sql(next, ...fields)}
        where id = ${r.id} and title = ${r.title} and body = ${r.body} and url = ${r.url}
          and source = ${r.source} and image = ${r.image}`
      if (res.count === 1) n.changed++
      else n.raced++
    }
  }
  console.log(`messages: ${JSON.stringify(n)}`)

  // The public bot's delivery log keeps `url:…` / `title:…` dedupe keys for 45 days. Hash the
  // raw ones with the same keyed hash the bot now writes (bot/src/poller.ts). Not reversible,
  // and not needed for rollback: an unmatched key only means one possible repeat post in 48h.
  if (!VERIFY && !DECRYPT) {
    const raw = await sql<{ id: number; dedupe_key: string }[]>`
      select id, dedupe_key from feedbot.deliveries where dedupe_key not like 'h1:%'`.catch(e => {
      console.error(`deliveries: skipped (${(e as Error).message})`)
      return null
    })
    if (raw) {
      let hashed = 0
      if (APPLY) {
        for (const d of raw) {
          const res = await sql`update feedbot.deliveries set dedupe_key = ${blindHash(d.dedupe_key, ring)!}
            where id = ${d.id} and dedupe_key = ${d.dedupe_key}`
          hashed += res.count
        }
      }
      console.log(`deliveries: raw=${raw.length} hashed=${hashed}`)
    }
  }

  await sql.end()
  if (n.failed) process.exit(1)
  if (!APPLY && !VERIFY) console.log('dry run — nothing written. Re-run with --apply.')
}

main().catch(async e => {
  console.error(e instanceof Error ? e.message : e)
  await sql.end().catch(() => {})
  process.exit(1)
})
