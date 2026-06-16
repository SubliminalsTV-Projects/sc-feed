import 'server-only'
import { pbAdminFetch } from './pb-admin'

// Accessor for the locked `sc_feed_config` singleton store (admin-only PB collection, one
// row per `key` enforced by a unique index). Today it holds exactly one key: `rsi_token` —
// Sub's RSI session cookie, pushed by the browser extension. By construction there is no
// per-user storage here: setConfigValue always upserts THE row for a key, never a new one.

export type ConfigMeta = { updated_by?: string; updated_via?: string }
export type ConfigStatus = { set: boolean; updated?: string; updated_by?: string; updated_via?: string }

type Row = { id: string; key: string; value?: string; updated?: string; updated_by?: string; updated_via?: string }

async function findRow(key: string): Promise<Row | null> {
  const res = await pbAdminFetch(
    `/api/collections/sc_feed_config/records?perPage=1&filter=${encodeURIComponent(`key="${key}"`)}`,
  )
  if (!res.ok) throw new Error(`PB read failed: ${res.status}`)
  const j = (await res.json()) as { items: Row[] }
  return j.items[0] ?? null
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
  return { set: !!row.value, updated: row.updated, updated_by: row.updated_by, updated_via: row.updated_via }
}

/** Upsert THE single row for `key`. Creates it on first write, patches it thereafter. */
export async function setConfigValue(key: string, value: string, meta: ConfigMeta = {}): Promise<void> {
  const row = await findRow(key)
  const body = JSON.stringify({ key, value, updated_by: meta.updated_by ?? '', updated_via: meta.updated_via ?? '' })
  const res = row
    ? await pbAdminFetch(`/api/collections/sc_feed_config/records/${row.id}`, { method: 'PATCH', body })
    : await pbAdminFetch(`/api/collections/sc_feed_config/records`, { method: 'POST', body })
  if (!res.ok) throw new Error(`PB write failed: ${res.status} ${await res.text().catch(() => '')}`)
}
