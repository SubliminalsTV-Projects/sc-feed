// The bot's own tables, in schema `feedbot` (same Timescale DB as scfeed). The role
// `feedbot_app` owns this schema and only has SELECT on the scfeed tables it reads —
// see bot/README.md for the one-time role setup.

import { pgSchema, bigint, text, integer, boolean, timestamp, unique, index, jsonb } from 'drizzle-orm/pg-core'
import { eq } from 'drizzle-orm'
import { db, sql } from '../../lib/db'
import { LEGACY_CATEGORIES } from './sources'

const feedbot = pgSchema('feedbot')
const ts = (name: string) => timestamp(name, { withTimezone: true })

// One row per Discord channel that receives news. A server may have a few (e.g. patch
// notes to #patches, the rest to #news).
export const subscriptions = feedbot.table('subscriptions', {
  id:         bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  guildId:    text('guild_id').notNull(),
  channelId:  text('channel_id').notNull().unique(),
  categories: text('categories').array().notNull(),
  roleId:     text('role_id'),   // default ping for every category ("All")
  // Per-category overrides: category → role id, or '' for "no ping". A missing key uses roleId.
  categoryRoles: jsonb('category_roles').$type<Record<string, string>>().notNull().default({}),
  paused:     boolean('paused').notNull().default(false),
  errorCount: integer('error_count').notNull().default(0),
  lastError:  text('last_error').notNull().default(''),
  createdBy:  text('created_by').notNull().default(''),
  created:    ts('created').notNull().defaultNow(),
  updated:    ts('updated').notNull().defaultNow(),
}, t => [index('subscriptions_guild_idx').on(t.guildId)])

// Delivery log. The (subscription, msg_id) unique key is what makes a double post
// impossible: a row is claimed BEFORE the send, so a crash can drop a post but never repeat one.
export const deliveries = feedbot.table('deliveries', {
  id:               bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  subscriptionId:   bigint('subscription_id', { mode: 'number' }).notNull()
                      .references(() => subscriptions.id, { onDelete: 'cascade' }),
  msgId:            text('msg_id').notNull(),
  dedupeKey:        text('dedupe_key').notNull(),
  discordMessageId: text('discord_message_id'),
  error:            text('error').notNull().default(''),
  created:          ts('created').notNull().defaultNow(),
}, t => [
  unique('deliveries_sub_msg_uq').on(t.subscriptionId, t.msgId),
  index('deliveries_sub_key_idx').on(t.subscriptionId, t.dedupeKey, t.created),
])

export const guilds = feedbot.table('guilds', {
  guildId:  text('guild_id').primaryKey(),
  name:     text('name').notNull().default(''),
  joinedAt: ts('joined_at').notNull().defaultNow(),
  leftAt:   ts('left_at'),
})

// The self-serve ping menu, one per server: the pinned message, and the role the bot made for
// each feed. While a server has one, posts ping the feed's role here instead of the
// /feed role mapping (which stays as the fallback for servers without Manage Roles).
export const menus = feedbot.table('menus', {
  guildId:   text('guild_id').primaryKey(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull(),
  roles:     jsonb('roles').$type<Record<string, string>>().notNull().default({}),
  createdBy: text('created_by').notNull().default(''),
  updated:   ts('updated').notNull().defaultNow(),
})

// Key/value: `cursor` (last scfeed.sc_feed_messages.id processed), `heartbeat`.
export const state = feedbot.table('state', {
  key:     text('key').primaryKey(),
  value:   text('value').notNull().default(''),
  updated: ts('updated').notNull().defaultNow(),
})

// Idempotent DDL, applied at startup. Mirrors the Drizzle definitions above — keep in step.
export async function migrate(allowlist: string[] = []) {
  await sql.unsafe(`
    SET client_min_messages = warning;  -- silence "already exists, skipping" on every boot
    CREATE TABLE IF NOT EXISTS feedbot.subscriptions (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      guild_id    text NOT NULL,
      channel_id  text NOT NULL UNIQUE,
      categories  text[] NOT NULL,
      role_id     text,
      paused      boolean NOT NULL DEFAULT false,
      error_count integer NOT NULL DEFAULT 0,
      last_error  text NOT NULL DEFAULT '',
      created_by  text NOT NULL DEFAULT '',
      created     timestamptz NOT NULL DEFAULT now(),
      updated     timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS subscriptions_guild_idx ON feedbot.subscriptions (guild_id);
    ALTER TABLE feedbot.subscriptions ADD COLUMN IF NOT EXISTS category_roles jsonb NOT NULL DEFAULT '{}'::jsonb;

    CREATE TABLE IF NOT EXISTS feedbot.deliveries (
      id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      subscription_id    bigint NOT NULL REFERENCES feedbot.subscriptions(id) ON DELETE CASCADE,
      msg_id             text NOT NULL,
      dedupe_key         text NOT NULL,
      discord_message_id text,
      error              text NOT NULL DEFAULT '',
      created            timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT deliveries_sub_msg_uq UNIQUE (subscription_id, msg_id)
    );
    CREATE INDEX IF NOT EXISTS deliveries_sub_key_idx ON feedbot.deliveries (subscription_id, dedupe_key, created);

    CREATE TABLE IF NOT EXISTS feedbot.guilds (
      guild_id  text PRIMARY KEY,
      name      text NOT NULL DEFAULT '',
      joined_at timestamptz NOT NULL DEFAULT now(),
      left_at   timestamptz
    );

    CREATE TABLE IF NOT EXISTS feedbot.state (
      key     text PRIMARY KEY,
      value   text NOT NULL DEFAULT '',
      updated timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS feedbot.menus (
      guild_id   text PRIMARY KEY,
      channel_id text NOT NULL,
      message_id text NOT NULL,
      roles      jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by text NOT NULL DEFAULT '',
      updated    timestamptz NOT NULL DEFAULT now()
    );
  `)
  await migrateCategories(allowlist)
}

// 2026-11-16: categories were split per row (sources.ts LEGACY_CATEGORIES). Rewrite any
// subscription still holding an old id, in `categories` and in the `category_roles` keys, so
// every server keeps every feed it followed. Idempotent: new ids never include an old one.
export function upgradeCategories(cats: string[]): string[] {
  return [...new Set(cats.flatMap(c => LEGACY_CATEGORIES[c] ?? [c]))]
}

export function upgradeCategoryRoles(roles: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [c, r] of Object.entries(roles)) if (!LEGACY_CATEGORIES[c]) out[c] = r
  // An explicit setting on a new id wins over one carried over from an old id.
  for (const [c, r] of Object.entries(roles)) for (const n of LEGACY_CATEGORIES[c] ?? []) if (!(n in out)) out[n] = r
  return out
}

async function migrateCategories(allowlist: string[]) {
  const rows = await db.select().from(subscriptions)
  for (const s of rows) {
    // A test copy (FEEDBOT_GUILD_IDS set) must not rewrite other servers' settings: the
    // production bot still running the old code would then miss their feeds.
    if (allowlist.length && !allowlist.includes(s.guildId)) continue
    if (!s.categories.some(c => LEGACY_CATEGORIES[c]) && !Object.keys(s.categoryRoles).some(c => LEGACY_CATEGORIES[c])) continue
    const categories = upgradeCategories(s.categories)
    const categoryRoles = upgradeCategoryRoles(s.categoryRoles)
    await db.update(subscriptions).set({ categories, categoryRoles }).where(eq(subscriptions.id, s.id))
    console.log(new Date().toISOString(), '[migrate]', `subscription ${s.id}: ${s.categories.join(',')} → ${categories.join(',')}`)
  }
}
