// SC Feed public Discord bot — entry point.
//
// Env:
//   DISCORD_TOKEN      bot token of the "SC Feed" Discord application (BW: see bot/README.md)
//   DATABASE_URL       postgres://feedbot_app:…@<timescale>:5432/subliminal
//   FEEDBOT_GUILD_IDS  optional, comma-separated. When set the bot ONLY serves these servers
//                      (commands answer "not available" elsewhere, nothing is posted elsewhere).
//                      Used for testing in Sub's server; unset in production.

import { Client, Events, GatewayIntentBits } from 'discord.js'
import { eq, sql as dsql } from 'drizzle-orm'
import { db, sql } from '../../lib/db'
import { guilds, migrate, subscriptions } from './schema'
import { commandData, handleInteraction } from './commands'
import { startPoller } from './poller'

const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[bot]', ...a)
// Event handlers touch the DB; a blip must be logged, not become an unhandled rejection.
const safe = <A extends unknown[]>(fn: (...a: A) => Promise<void>) => (...a: A) => { fn(...a).catch(err => log('handler failed:', err)) }

const token = process.env.DISCORD_TOKEN?.trim().replace(/^Bot\s+/i, '')
if (!token) throw new Error('DISCORD_TOKEN is not set')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
const allowlist = (process.env.FEEDBOT_GUILD_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)

// Guilds is the only intent needed: slash commands arrive as interactions, and it carries the
// guild/channel/role events we react to. No privileged intents — keeps verification simple.
const client = new Client({ intents: [GatewayIntentBits.Guilds] })
let stopPoller: (() => void) | null = null

client.once(Events.ClientReady, async c => {
  log(`logged in as ${c.user.tag} in ${c.guilds.cache.size} server(s)${allowlist.length ? ` — allowlist ${allowlist.join(',')}` : ''}`)
  await c.application.commands.set([commandData])
  for (const g of c.guilds.cache.values()) {
    await db.insert(guilds).values({ guildId: g.id, name: g.name })
      .onConflictDoUpdate({ target: guilds.guildId, set: { name: g.name, leftAt: null } })
  }
  stopPoller = startPoller(c.rest, allowlist)
})

client.on(Events.GuildCreate, safe(async g => {
  log(`joined ${g.id} (${g.name}, ${g.memberCount} members)`)
  await db.insert(guilds).values({ guildId: g.id, name: g.name })
    .onConflictDoUpdate({ target: guilds.guildId, set: { name: g.name, joinedAt: dsql`now()`, leftAt: null } })
}))

client.on(Events.GuildDelete, safe(async g => {
  log(`removed from ${g.id} (${g.name})`)
  await db.delete(subscriptions).where(eq(subscriptions.guildId, g.id))
  await db.update(guilds).set({ leftAt: new Date() }).where(eq(guilds.guildId, g.id))
}))

client.on(Events.ChannelDelete, safe(async ch => {
  await db.delete(subscriptions).where(eq(subscriptions.channelId, ch.id))
}))

client.on(Events.InteractionCreate, i => { void handleInteraction(i, client.rest, allowlist) })

async function shutdown(signal: string) {
  log(`${signal} — shutting down`)
  stopPoller?.()
  await client.destroy()
  await sql.end({ timeout: 5 })
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

async function main() {
  await migrate()
  await client.login(token)
}
main().catch(err => { console.error(err); process.exit(1) })
