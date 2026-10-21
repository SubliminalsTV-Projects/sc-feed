// Field encryption at rest for Discord-sourced SC Feed text (AES-256-GCM, node:crypto).
//
// Why: the ClaudeBot Message Content intent application (2026-10-16) says stored Discord
// message content is encrypted at rest, and the VPS disk is plain ext4. So the content
// fields of Discord-sourced rows in scfeed.sc_feed_messages are stored as envelopes:
//
//   enc:v1:<keyId>:<iv base64url>:<ciphertext||tag base64url>
//
// - 12-byte random IV per field per write; 16-byte GCM tag appended to the ciphertext.
// - AAD = table + msg_id + field, so an envelope copied onto another row or field fails.
// - keyId names the key, so keys can rotate: SCFEED_ENC_KEYS="k2:<b64>,k1:<b64>". The FIRST
//   entry encrypts new writes; every listed key can decrypt. Key = 32 random bytes, base64.
// - Plain values pass through decrypt untouched, so readers work on mixed tables (needed
//   during the migration, and for non-Discord sources, which stay plain).
// - A wrong key, an unknown key id or a tampered value THROWS (FeedDecryptError). Never
//   returns garbage.
//
// The key lives on the server, so this protects dumps, backups and disk images, not a
// compromise of the running app. Lose every copy of the key and the encrypted text is gone.
//
// 🔴 This file is copied verbatim into mission-control (lib/feed-crypt.ts) and subliminal-gg
// (lib/feed-crypt.ts), which read scfeed cross-schema. Change all three together; the
// known-answer vector in scripts/feedcrypt-test.ts checks a copy decrypts the same envelope.
//
// NO `import 'server-only'` (tsx runs this from scripts/, like lib/db.ts).

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto'

export const ENC_PREFIX = 'enc:v1:'

/** The content fields of sc_feed_messages that are encrypted on Discord-sourced rows. */
export const ENC_FIELDS = ['title', 'body', 'url', 'source', 'image'] as const
export type EncField = (typeof ENC_FIELDS)[number]

export class FeedDecryptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedDecryptError'
  }
}

export interface Keyring { activeId: string; keys: Map<string, Buffer> }

let cache: { raw: string; ring: Keyring | null } | undefined

/** Parse SCFEED_ENC_KEYS. null when unset; throws when set but malformed. */
export function parseKeyring(raw: string | undefined): Keyring | null {
  const s = (raw ?? '').trim().replace(/^['"]|['"]$/g, '') // Coolify may keep quotes literal
  if (!s) return null
  const keys = new Map<string, Buffer>()
  let activeId = ''
  for (const part of s.split(',')) {
    const i = part.indexOf(':')
    const id = part.slice(0, i).trim()
    const key = Buffer.from(part.slice(i + 1).trim(), 'base64')
    if (i < 1 || !/^[A-Za-z0-9_-]{1,16}$/.test(id)) throw new Error('SCFEED_ENC_KEYS: bad key id (want "id:base64,…")')
    if (key.length !== 32) throw new Error(`SCFEED_ENC_KEYS: key ${id} is ${key.length} bytes, want 32`)
    if (keys.has(id)) throw new Error(`SCFEED_ENC_KEYS: duplicate key id ${id}`)
    keys.set(id, key)
    if (!activeId) activeId = id
  }
  return { activeId, keys }
}

export function keyring(): Keyring | null {
  const raw = process.env.SCFEED_ENC_KEYS ?? ''
  if (cache?.raw !== raw) cache = { raw, ring: parseKeyring(raw) }
  return cache.ring
}

export function isEncrypted(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.startsWith(ENC_PREFIX)
}

export function aadFor(msgId: string, field: string): string {
  return `scfeed.sc_feed_messages:${msgId}:${field}`
}

const b64u = (b: Buffer) => b.toString('base64url')

export function encryptValue(plain: string, aad: string, ring: Keyring | null = keyring()): string {
  if (!plain) return plain
  if (isEncrypted(plain)) throw new Error('feed-crypt: value is already encrypted (a reader skipped decryptRow?)')
  if (!ring) throw new Error('feed-crypt: SCFEED_ENC_KEYS is not set')
  const key = ring.keys.get(ring.activeId)!
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final(), c.getAuthTag()])
  return `${ENC_PREFIX}${ring.activeId}:${b64u(iv)}:${b64u(ct)}`
}

export function decryptValue(v: string, aad: string, ring: Keyring | null = keyring()): string {
  if (!isEncrypted(v)) return v
  const parts = v.slice(ENC_PREFIX.length).split(':')
  if (parts.length !== 3) throw new FeedDecryptError(`feed-crypt: malformed envelope (${aad})`)
  const [id, ivS, ctS] = parts
  if (!ring) throw new FeedDecryptError(`feed-crypt: SCFEED_ENC_KEYS is not set but ${aad} is encrypted`)
  const key = ring.keys.get(id)
  if (!key) throw new FeedDecryptError(`feed-crypt: no key "${id}" in SCFEED_ENC_KEYS (${aad})`)
  const iv = Buffer.from(ivS, 'base64url')
  const ct = Buffer.from(ctS, 'base64url')
  if (iv.length !== 12 || ct.length < 16) throw new FeedDecryptError(`feed-crypt: malformed envelope (${aad})`)
  try {
    const d = createDecipheriv('aes-256-gcm', key, iv)
    d.setAAD(Buffer.from(aad, 'utf8'))
    d.setAuthTag(ct.subarray(ct.length - 16))
    return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString('utf8')
  } catch {
    throw new FeedDecryptError(`feed-crypt: authentication failed for ${aad} with key "${id}" (wrong key, or the value was altered)`)
  }
}

type RowFields = { [K in EncField]?: string | null }

/** Encrypt the content fields of a row about to be written. */
export function encryptRow<T extends RowFields>(row: T, msgId: string, ring: Keyring | null = keyring()): T {
  const out = { ...row }
  for (const f of ENC_FIELDS) {
    const v = out[f]
    if (typeof v === 'string' && v) (out as RowFields)[f] = encryptValue(v, aadFor(msgId, f), ring)
  }
  return out
}

/** Decrypt the content fields of a row read from the DB. Plain fields pass through. */
export function decryptRow<T extends RowFields>(row: T, msgId: string, ring: Keyring | null = keyring()): T {
  const out = { ...row }
  for (const f of ENC_FIELDS) {
    const v = out[f]
    if (isEncrypted(v)) (out as RowFields)[f] = decryptValue(v as string, aadFor(msgId, f), ring)
  }
  return out
}

/** Keyed hash for values that only need equality checks (the bot's dedupe keys), so they
 *  are not stored in clear either. Derived from the ACTIVE key: rotating the key changes
 *  every hash. null when no key is configured. */
export function blindHash(value: string, ring: Keyring | null = keyring()): string | null {
  if (!ring) return null
  const k = Buffer.from(hkdfSync('sha256', ring.keys.get(ring.activeId)!, Buffer.alloc(0), 'scfeed-blind-v1', 32))
  return 'h1:' + createHmac('sha256', k).update(value, 'utf8').digest('base64url').slice(0, 32)
}
