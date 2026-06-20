// Postgres (Timescale on the VPS) data layer — replaces the old PocketBase REST access.
// Drizzle ORM over postgres.js. Single shared instance so callers query the `scfeed`
// schema directly.
//
// NO `import 'server-only'` here — like the old lib/pb-admin / lib/sc-config, this is
// imported by scripts/local-cron.ts under tsx, where 'server-only' is unresolvable.

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { pgSchema, bigint, text, integer, timestamp } from 'drizzle-orm/pg-core'

const connectionString = process.env.DATABASE_URL ?? ''

// Reuse the client across HMR / warm lambdas so we don't leak connections.
const g = globalThis as unknown as { _scfeedSql?: ReturnType<typeof postgres> }
const client =
  g._scfeedSql ??
  postgres(connectionString, {
    max: 5,
    prepare: false,
    // Fail fast instead of hanging if DATABASE_URL is unset/wrong.
    connect_timeout: 10,
  })
if (process.env.NODE_ENV !== 'production') g._scfeedSql = client

export const db = drizzle(client)
export const sql = client

// ---------- schema: scfeed.* ----------

const scfeed = pgSchema('scfeed')

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const messages = scfeed.table('sc_feed_messages', {
  id:           bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  msgId:        text('msg_id').notNull().unique(),
  channelId:    text('channel_id').notNull(),
  channelLabel: text('channel_label').notNull().default(''),
  title:        text('title').notNull().default(''),
  body:         text('body').notNull().default(''),
  url:          text('url').notNull().default(''),
  source:       text('source').notNull().default(''),
  msgTimestamp: text('msg_timestamp').notNull().default(''),
  tsRaw:        ts('ts_raw').notNull(),
  image:        text('image').notNull().default(''),
  created:      ts('created').notNull().defaultNow(),
  updated:      ts('updated').notNull().defaultNow(),
})

export const config = scfeed.table('sc_feed_config', {
  id:         bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  key:        text('key').notNull().unique(),
  value:      text('value').notNull().default(''),
  updatedBy:  text('updated_by').notNull().default(''),
  updatedVia: text('updated_via').notNull().default(''),
  created:    ts('created').notNull().defaultNow(),
  updated:    ts('updated').notNull().defaultNow(),
})

export const saved = scfeed.table('sc_feed_saved', {
  id:           bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  accountEmail: text('account_email').notNull(),
  url:          text('url').notNull(),
  title:        text('title').notNull().default(''),
  sourceType:   text('source_type').notNull().default('web'),
  created:      ts('created').notNull().defaultNow(),
  updated:      ts('updated').notNull().defaultNow(),
})

export const kbSnapshots = scfeed.table('sc_feed_kb_snapshots', {
  id:             bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  articleId:      text('article_id').notNull().unique(),
  bodyNormalized: text('body_normalized').notNull().default(''),
  editedAt:       text('edited_at').notNull().default(''),
  title:          text('title').notNull().default(''),
  url:            text('url').notNull().default(''),
  created:        ts('created').notNull().defaultNow(),
  updated:        ts('updated').notNull().defaultNow(),
})

export const kbDiffs = scfeed.table('sc_feed_kb_diffs', {
  id:          bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  msgId:       text('msg_id').notNull().unique(),
  articleId:   text('article_id').notNull().default(''),
  stateSig:    text('state_sig').notNull().default(''),
  summary:     text('summary').notNull().default(''),
  added:       integer('added').notNull().default(0),
  removed:     integer('removed').notNull().default(0),
  diffHtml:    text('diff_html').notNull().default(''),
  previewHtml: text('preview_html').notNull().default(''),
  title:       text('title').notNull().default(''),
  url:         text('url').notNull().default(''),
  created:     ts('created').notNull().defaultNow(),
  updated:     ts('updated').notNull().defaultNow(),
})

export const pushSubscriptions = scfeed.table('sc_feed_push_subscriptions', {
  id:       bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  endpoint: text('endpoint').notNull().unique(),
  p256dh:   text('p256dh').notNull().default(''),
  auth:     text('auth').notNull().default(''),
  created:  ts('created').notNull().defaultNow(),
  updated:  ts('updated').notNull().defaultNow(),
})
