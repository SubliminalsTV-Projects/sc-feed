// The self-serve ping menu (Sub, 2026-11-16). One pinned message per server: a dropdown of
// feeds and three buttons. Each feed is a role the bot creates; saving gives the member
// exactly the roles they ticked, and each news post mentions its feed's role.
//
// Discord limits that shape this file:
// - A button press does not carry what the member ticked in the dropdown. So the dropdown's
//   own interaction is remembered per member (PENDING_TTL) and "Save my pings" applies it.
// - Roles need Manage Roles. Without it, /feed menu explains what is missing and servers keep
//   using /feed role (posts fall back to that whenever a server has no menu).
// - The bot can only ping a role that is mentionable, unless it has Mention Everyone. So the
//   roles are made mentionable only when it lacks that permission.

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, DiscordAPIError, EmbedBuilder, MessageFlags,
  PermissionFlagsBits, StringSelectMenuBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type Guild, type GuildBasedChannel,
  type GuildMember, type StringSelectMenuInteraction,
} from 'discord.js'
import { eq } from 'drizzle-orm'
import { db } from '../../lib/db'
import { menus, subscriptions } from './schema'
import { CATEGORIES, CATEGORY_IDS, GROUPS, categoryById, type CategoryId } from './sources'

const BRAND_COLOR = 0x0ea5e9
const ROLE_PREFIX = 'SC Feed · '
const PENDING_TTL = 15 * 60 * 1000
export const MENU_PREFIX = 'feedmenu:'

const ephemeral = { flags: MessageFlags.Ephemeral } as const
type Menu = typeof menus.$inferSelect

// ---------- the message ----------

function menuMessage(newsChannels: string[], menuChannelId: string) {
  const where = !newsChannels.length || (newsChannels.length === 1 && newsChannels[0] === menuChannelId)
    ? 'this channel' : newsChannels.map(c => `<#${c}>`).join(', ')
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('Choose your SC Feed pings')
    .setDescription(`Every SC Feed post lands in ${where}. Pick the feeds you want to be pinged for, then press **Save my pings**.`)
    .addFields(GROUPS.map(g => ({
      name: g, inline: true,
      value: CATEGORIES.filter(c => c.group === g).map(c => c.label).join('\n'),
    })))
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${MENU_PREFIX}pick`)
    .setPlaceholder('Pick the feeds that ping you')
    .setMinValues(0).setMaxValues(CATEGORIES.length)
    .addOptions(CATEGORIES.map(c => ({
      label: c.label, value: c.id, description: `${c.group} · ${c.description}`.slice(0, 100),
    })))
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${MENU_PREFIX}save`).setStyle(ButtonStyle.Primary).setLabel('Save my pings'),
    new ButtonBuilder().setCustomId(`${MENU_PREFIX}all`).setStyle(ButtonStyle.Secondary).setLabel('Ping me for everything'),
    new ButtonBuilder().setCustomId(`${MENU_PREFIX}none`).setStyle(ButtonStyle.Secondary).setLabel('No pings'),
  )
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select), buttons],
    allowedMentions: { parse: [] },
  }
}

// ---------- roles ----------

/** Create any missing feed roles (and keep their mentionable flag right). Returns the map. */
async function ensureRoles(guild: Guild, existing: Record<string, string>): Promise<{ roles: Record<string, string>, created: number }> {
  const me = guild.members.me!
  const mentionable = !me.permissions.has(PermissionFlagsBits.MentionEveryone)
  const roles: Record<string, string> = {}
  let created = 0
  for (const c of CATEGORIES) {
    const current = existing[c.id] ? guild.roles.cache.get(existing[c.id]) : undefined
    if (current) {
      if (current.mentionable !== mentionable && current.editable) {
        await current.setMentionable(mentionable, 'SC Feed ping menu')
      }
      roles[c.id] = current.id
      continue
    }
    const role = await guild.roles.create({
      name: `${ROLE_PREFIX}${c.label}`.slice(0, 100), mentionable, permissions: [],
      reason: 'SC Feed ping menu: members pick the feeds that ping them',
    })
    roles[c.id] = role.id
    created++
  }
  return { roles, created }
}

// ---------- /feed menu ----------

export async function menuCommand(i: ChatInputCommandInteraction<'cached'>, channel: GuildBasedChannel, missingPerms: string[]) {
  const guild = i.guild
  const existing = (await db.select().from(menus).where(eq(menus.guildId, guild.id)).limit(1))[0] ?? null

  if (i.options.getBoolean('remove')) {
    if (!existing) { await i.reply({ ...ephemeral, content: 'This server has no ping menu.' }); return }
    await deleteMenuMessage(guild, existing)
    await db.delete(menus).where(eq(menus.guildId, guild.id))
    await i.reply({ ...ephemeral, content: 'Ping menu removed. Posts go back to your `/feed role` settings. ' +
      `The ${ROLE_PREFIX.trim()} roles are still there; delete them in Server Settings → Roles if you don't want them.` })
    return
  }

  const me = guild.members.me
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await i.reply({ ...ephemeral, content:
      'The ping menu needs the **Manage Roles** permission: I create one role per feed and give members the ones they pick.\n' +
      "Give my role **Manage Roles** in Server Settings → Roles (or re-invite me from sc-feed.subliminal.gg/bot), then run this again.\n" +
      'Until then, `/feed role` still lets you choose which of your own roles each category pings.' })
    return
  }
  if (missingPerms.length) {
    await i.reply({ ...ephemeral, content: `I can't post in ${channel} yet. Give me **${missingPerms.join(', ')}** there, then try again.` })
    return
  }
  if (!channel.isTextBased()) return

  await i.deferReply(ephemeral)
  const { roles, created } = await ensureRoles(guild, existing?.roles ?? {})
  const subs = await db.select().from(subscriptions).where(eq(subscriptions.guildId, guild.id))
  const body = menuMessage(subs.map(s => s.channelId), channel.id)

  let messageId: string | null = null
  if (existing?.channelId === channel.id) {
    try { messageId = (await channel.messages.edit(existing.messageId, body)).id } catch { messageId = null }
  } else if (existing) {
    await deleteMenuMessage(guild, existing)
  }
  const notes: string[] = []
  if (!messageId) {
    const msg = await channel.send(body)
    messageId = msg.id
    try { await msg.pin('SC Feed ping menu') } catch {
      notes.push('I couldn\'t pin it. Pin it yourself, or give me **Pin Messages** in that channel.')
    }
  }

  await db.insert(menus).values({ guildId: guild.id, channelId: channel.id, messageId, roles, createdBy: i.user.id })
    .onConflictDoUpdate({ target: menus.guildId, set: { channelId: channel.id, messageId, roles, updated: new Date() } })

  if (created) notes.unshift(`Created ${created} role${created === 1 ? '' : 's'} named **${ROLE_PREFIX}…**. Members only get the ones they pick.`)
  if (!me.permissions.has(PermissionFlagsBits.MentionEveryone)) {
    notes.push('The roles are mentionable so my posts can ping them, which means members can ping them too. ' +
      'To stop that, give me **Mention @everyone, @here and All Roles** and run `/feed menu` again: I\'ll lock them.')
  }
  if (subs.some(s => s.roleId || Object.keys(s.categoryRoles).length)) {
    notes.push('While the menu is up, posts ping its roles. Your `/feed role` settings are kept for if you remove it.')
  }
  const missingFeeds = CATEGORY_IDS.filter(f => !subs.some(s => s.categories.includes(f)))
  if (subs.length && missingFeeds.length) {
    notes.push(`No news channel here carries ${missingFeeds.map(f => categoryById.get(f)!.label).join(', ')}, ` +
      'so those roles won\'t be pinged. Add them with `/feed setup`.')
  }
  if (!subs.length) notes.push('There\'s no news channel yet. Run `/feed setup` so posts have somewhere to land.')
  await i.editReply({ content: [`Ping menu ${existing ? 'refreshed' : 'posted'} in ${channel}.`, ...notes].join('\n'), allowedMentions: { parse: [] } })
}

async function deleteMenuMessage(guild: Guild, menu: Menu) {
  const ch = guild.channels.cache.get(menu.channelId)
  if (ch?.isTextBased()) await ch.messages.delete(menu.messageId).catch(() => {})
}

// ---------- members using the menu ----------

const pending = new Map<string, { feeds: CategoryId[], at: number }>()

function remember(key: string, feeds: CategoryId[]) {
  const now = Date.now()
  for (const [k, v] of pending) if (now - v.at > PENDING_TTL) pending.delete(k)
  pending.set(key, { feeds, at: now })
}

/** Give the member exactly the menu roles for these feeds. Returns what applied and what failed. */
async function applyFeeds(member: GuildMember, menu: Menu, feeds: CategoryId[]) {
  const failed: string[] = []
  for (const c of CATEGORIES) {
    const roleId = menu.roles[c.id]
    const role = roleId ? member.guild.roles.cache.get(roleId) : undefined
    const want = feeds.includes(c.id)
    if (!role) { if (want) failed.push(c.label); continue }
    const has = member.roles.cache.has(role.id)
    try {
      if (want && !has) await member.roles.add(role, 'SC Feed ping menu')
      else if (!want && has) await member.roles.remove(role, 'SC Feed ping menu')
    } catch (err) {
      if (want) failed.push(c.label)
      if (!(err instanceof DiscordAPIError)) throw err
    }
  }
  return failed
}

export async function handleMenuInteraction(i: StringSelectMenuInteraction<'cached'> | ButtonInteraction<'cached'>) {
  const action = i.customId.slice(MENU_PREFIX.length)
  const key = `${i.guildId}:${i.user.id}`

  if (i.isStringSelectMenu()) {
    remember(key, i.values.filter((v): v is CategoryId => (CATEGORY_IDS as string[]).includes(v)))
    await i.deferUpdate()
    return
  }

  let feeds: CategoryId[]
  if (action === 'all') feeds = [...CATEGORY_IDS]
  else if (action === 'none') feeds = []
  else {
    const p = pending.get(key)
    if (!p || Date.now() - p.at > PENDING_TTL) {
      await i.reply({ ...ephemeral, content: 'Tick the feeds you want in the menu first, then press **Save my pings**.' })
      return
    }
    feeds = p.feeds
  }

  const menu = (await db.select().from(menus).where(eq(menus.guildId, i.guildId)).limit(1))[0]
  if (!menu) { await i.reply({ ...ephemeral, content: 'This menu is no longer in use.' }); return }

  await i.deferReply(ephemeral)
  const failed = await applyFeeds(i.member, menu, feeds)
  pending.delete(key)
  const got = CATEGORIES.filter(c => feeds.includes(c.id) && !failed.includes(c.label)).map(c => c.label)
  const lines = [got.length ? `You'll be pinged for: ${got.join(', ')}.` : "You won't be pinged for any SC Feed posts. They still show up in the channel."]
  if (failed.length) {
    lines.push(`I couldn't give you ${failed.join(', ')}. A server admin can fix it by running \`/feed menu\` again ` +
      '(and keeping my role above the SC Feed roles).')
  }
  await i.editReply(lines.join('\n'))
}
