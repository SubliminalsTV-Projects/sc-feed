// The bot's own tables, in schema `feedbot` (same Timescale DB as scfeed). The role
// `feedbot_app` owns this schema and only has SELECT on the scfeed tables it reads —
// see bot/README.md for the one-time role setup.

import { pgSchema, bigint, text, integer, boolean, timestamp, unique, index } from 'drizzle-orm/pg-core'
import { sql } from '../../lib/db'

const feedbot = pgSchema('feedbot')
const ts = (name: string) => timestamp(name, { withTimezone: true })

// One row per Discord channel that receives news. A server may have a few (e.g. patch
// notes to #patches, the rest to #news).
export const subscriptions = feedbot.table('subscriptions', {
  id:         bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  guildId:    text('guild_id').notNull(),
  channelId:  text('channel_id').notNull().unique(),
  categories: text('categories').array().notNull(),
  roleId:     text('role_id'),
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

// Key/value: `cursor` (last scfeed.sc_feed_messages.id processed), `heartbeat`.
export const state = feedbot.table('state', {
  key:     text('key').primaryKey(),
  value:   text('value').notNull().default(''),
  updated: ts('updated').notNull().defaultNow(),
})

// Idempotent DDL, applied at startup. Mirrors the Drizzle definitions above — keep in step.
export async function migrate() {
  await sql.unsafe(`
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
  `)
}
