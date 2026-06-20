import { eq } from 'drizzle-orm'
import { db, config } from './db'

// Accessor for the `sc_feed_config` key/value store (scfeed schema). Today it holds exactly
// one key: `rsi_token` — Sub's RSI session cookie, pushed by the browser extension. By
// construction there is no per-user storage here: setConfigValue always upserts THE row for
// a key, never a new one.
//
// NO `import 'server-only'` here — breaks the tsx runner used by scripts/local-cron.ts.

export type ConfigMeta = { updated_by?: string; updated_via?: string }
export type ConfigStatus = { set: boolean; updated?: string; updated_by?: string; updated_via?: string }

async function findRow(key: string) {
  return (await db.select().from(config).where(eq(config.key, key)).limit(1))[0] ?? null
}

/** Current value for a config key, or '' if unset. */
export async function getConfigValue(key: string): Promise<string> {
  const row = await findRow(key)
  return row?.value ?? ''
}

/** Status WITHOUT the secret value — safe to return to the owner UI / extension popup. */
export async function getConfigStatus(key: string): Promise<ConfigStatus> {
  const row = await findRow(key)
  if (!row) return { set: false }
  return { set: !!row.value, updated: row.updated?.toISOString(), updated_by: row.updatedBy, updated_via: row.updatedVia }
}

/** Upsert THE single row for `key`. Creates it on first write, patches it thereafter. */
export async function setConfigValue(key: string, value: string, meta: ConfigMeta = {}): Promise<void> {
  const fields = { value, updatedBy: meta.updated_by ?? '', updatedVia: meta.updated_via ?? '', updated: new Date() }
  await db.insert(config).values({ key, ...fields }).onConflictDoUpdate({ target: config.key, set: fields })
}
