/**
 * Self-test for lib/feed-crypt.ts. No DB, no env needed.
 *
 *   npx tsx scripts/feedcrypt-test.ts [path/to/feed-crypt.ts]
 *
 * The optional path tests a COPY (mission-control and subliminal-gg each carry one): the
 * known-answer vector proves the copy decrypts what this one encrypts.
 */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

// Fixed TEST key and an envelope it produced. Not a real key — never use it in an app.
const TEST_KEYS = 'kat:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
const KAT_AAD = 'scfeed.sc_feed_messages:1234567890:title'
const KAT_PLAIN = 'Star Citizen Alpha 4.10 — patch notes ✨'
const KAT_ENVELOPE = 'enc:v1:kat:tL339Z5foBsAa0ND:NEU-XGDn8LkvXBr6PHbal5_DxWU3oFgDw5diiTq-GgQvBBTvcLsfg26pJuMdTOi-zNqNem0VndESAmo'

async function main() {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '../lib/feed-crypt.ts')
  const fc = await import(pathToFileURL(target).href) as typeof import('../lib/feed-crypt')
  const ring = fc.parseKeyring(TEST_KEYS)!
  const other = fc.parseKeyring('kat:' + Buffer.alloc(32, 7).toString('base64'))!
  const rotated = fc.parseKeyring('k2:' + Buffer.alloc(32, 9).toString('base64') + ',' + TEST_KEYS)!
  let n = 0
  const ok = (name: string) => { n++; console.log(`  ok  ${name}`) }

  // round-trip, incl. unicode and long text
  for (const p of ['hello', KAT_PLAIN, 'x'.repeat(200_000)]) {
    const e = fc.encryptValue(p, KAT_AAD, ring)
    assert.ok(e.startsWith('enc:v1:kat:'))
    assert.equal(fc.decryptValue(e, KAT_AAD, ring), p)
  }
  ok('round-trip (ascii, unicode, 200k chars)')

  assert.notEqual(fc.encryptValue('same', KAT_AAD, ring), fc.encryptValue('same', KAT_AAD, ring))
  ok('fresh IV per write (same plaintext -> different envelopes)')

  assert.equal(fc.decryptValue('plain text', KAT_AAD, ring), 'plain text')
  assert.equal(fc.decryptValue('plain text', KAT_AAD, null), 'plain text')
  assert.equal(fc.encryptValue('', KAT_AAD, ring), '')
  ok('plain values pass through; empty stays empty')

  const env = fc.encryptValue('secret', KAT_AAD, ring)
  assert.throws(() => fc.decryptValue(env, KAT_AAD, other), (e: Error) => e.name === 'FeedDecryptError' && /authentication failed/.test(e.message))
  ok('wrong key -> FeedDecryptError (not garbage)')

  assert.throws(() => fc.decryptValue(env, 'scfeed.sc_feed_messages:999:title', ring), /authentication failed/)
  assert.throws(() => fc.decryptValue(env, 'scfeed.sc_feed_messages:1234567890:body', ring), /authentication failed/)
  ok('envelope moved to another row or field -> fails')

  const parts = env.split(':')
  const ct = Buffer.from(parts[4], 'base64url'); ct[0] ^= 1
  assert.throws(() => fc.decryptValue([...parts.slice(0, 4), ct.toString('base64url')].join(':'), KAT_AAD, ring), /authentication failed/)
  ok('tampered ciphertext -> fails')

  assert.throws(() => fc.decryptValue(env.replace(':kat:', ':nope:'), KAT_AAD, ring), /no key "nope"/)
  assert.throws(() => fc.decryptValue(env, KAT_AAD, null), /SCFEED_ENC_KEYS is not set/)
  assert.throws(() => fc.decryptValue('enc:v1:kat:zz', KAT_AAD, ring), /malformed/)
  ok('unknown key id / no keys / malformed -> fail')

  assert.throws(() => fc.encryptValue(env, KAT_AAD, ring), /already encrypted/)
  assert.throws(() => fc.encryptValue('x', KAT_AAD, null), /not set/)
  ok('refuses double-encrypt and keyless encrypt')

  const e2 = fc.encryptValue('rotate me', KAT_AAD, rotated)
  assert.ok(e2.startsWith('enc:v1:k2:'))
  assert.equal(fc.decryptValue(env, KAT_AAD, rotated), 'secret')
  assert.equal(fc.decryptValue(e2, KAT_AAD, rotated), 'rotate me')
  ok('rotation: first key encrypts, older keys still decrypt')

  for (const bad of ['k1:short', ':' + Buffer.alloc(32).toString('base64'), 'a b:' + Buffer.alloc(32).toString('base64'),
    `k:${Buffer.alloc(32).toString('base64')},k:${Buffer.alloc(32).toString('base64')}`]) {
    assert.throws(() => fc.parseKeyring(bad))
  }
  assert.equal(fc.parseKeyring(''), null)
  assert.equal(fc.parseKeyring(`'${TEST_KEYS}'`)!.activeId, 'kat')
  ok('keyring parsing (rejects bad ids/lengths/dupes, strips Coolify quotes)')

  const row = { title: 'T', body: '', url: 'https://x.test/a', source: 'S', image: '', other: 'keep' }
  const enc = fc.encryptRow(row, '42', ring)
  assert.equal(enc.other, 'keep'); assert.equal(enc.body, ''); assert.ok(fc.isEncrypted(enc.title))
  assert.deepEqual(fc.decryptRow(enc, '42', ring), row)
  ok('encryptRow/decryptRow touch only the content fields')

  assert.equal(fc.blindHash('url:x', ring), fc.blindHash('url:x', ring))
  assert.notEqual(fc.blindHash('url:x', ring), fc.blindHash('url:y', ring))
  assert.notEqual(fc.blindHash('url:x', ring), fc.blindHash('url:x', other))
  assert.equal(fc.blindHash('url:x', null), null)
  ok('blindHash deterministic per key')

  if (KAT_ENVELOPE.endsWith('REPLACE_ME')) {
    console.log('  KAT envelope to paste:', fc.encryptValue(KAT_PLAIN, KAT_AAD, ring))
  } else {
    assert.equal(fc.decryptValue(KAT_ENVELOPE, KAT_AAD, ring), KAT_PLAIN)
    ok('known-answer vector decrypts')
  }
  console.log(`${n} checks passed (${path.relative(process.cwd(), target)})`)
}

main().catch(e => { console.error(e); process.exit(1) })
