/**
 * One-off, idempotent: create the `sc_feed_saved` PocketBase collection.
 *
 * Per-user "Saved" bookmark list. Admin-only rules (like `sc_feed_config`) — NOT open writes —
 * so one user's saves stay private; all access is server-side via lib/pb-admin.ts keyed on the
 * caller's NextAuth email.
 *
 * Run:  npx tsx --env-file ~/monitarr/.env.mission-control \
 *                   --env-file ~/monitarr/.env.sc-feed-cron-overrides \
 *                   scripts/create-saved-collection.ts
 */
import { pbAdminFetch } from '../lib/pb-admin'

const NAME = 'sc_feed_saved'

async function main() {
  // Already there? Done.
  const existing = await pbAdminFetch(`/api/collections/${NAME}`)
  if (existing.ok) {
    console.log(`[saved] collection "${NAME}" already exists — nothing to do`)
    return
  }

  // Mirror the running PB's field format by reading a known collection first, so this works
  // across PB versions (older "schema" key vs newer "fields").
  const ref = await pbAdminFetch('/api/collections/sc_feed_config')
  if (!ref.ok) throw new Error(`could not read reference collection sc_feed_config: ${ref.status}`)
  const refJson = await ref.json() as Record<string, unknown>
  const fieldsKey = Array.isArray(refJson.fields) ? 'fields' : 'schema'
  console.log(`[saved] PB uses "${fieldsKey}" for collection fields`)

  const textField = (name: string, opts: Record<string, unknown> = {}) => ({
    name, type: 'text', required: false, presentable: false,
    ...(fieldsKey === 'fields' ? { hidden: false, max: 0, min: 0, pattern: '' } : { options: {} }),
    ...opts,
  })

  const body: Record<string, unknown> = {
    name: NAME,
    type: 'base',
    // null rules = superuser-only (admin token via pbAdminFetch). Private per-user data.
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    [fieldsKey]: [
      textField('account_email'),
      textField('url'),
      textField('title'),
      textField('source_type'),
      // Newer PB does NOT auto-add created/updated — declare them so `sort=-created` works.
      { name: 'created', type: 'autodate', onCreate: true, onUpdate: false, presentable: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true, presentable: false },
    ],
    indexes: [
      `CREATE INDEX idx_${NAME}_email ON ${NAME} (account_email)`,
      `CREATE UNIQUE INDEX idx_${NAME}_email_url ON ${NAME} (account_email, url)`,
    ],
  }

  const res = await pbAdminFetch('/api/collections', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`create failed: ${res.status} ${await res.text()}`)
  console.log(`[saved] created collection "${NAME}" (admin-only, indexed on account_email + unique account_email+url)`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
