// /feed slash commands. Server-side setup only — Manage Server required, guilds only.
//
//   /feed setup channel [role]   create or edit a news channel, then pick categories
//   /feed role channel [category] [role] [mute]
//                                set the role pinged on each post — for every category, or
//                                just one (overrides the default; mute = no ping for it)
//   /feed test channel           post the newest item so admins see what it looks like
//   /feed remove channel         stop posting there
//   /feed status                 list this server's news channels

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, InteractionContextType,
  ApplicationIntegrationType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, StringSelectMenuBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type GuildBasedChannel, type Interaction,
  type REST, type Role, type StringSelectMenuInteraction,
} from 'discord.js'
import { and, count, eq } from 'drizzle-orm'
import { db } from '../../lib/db'
import { subscriptions } from './schema'
import { CATEGORIES, CATEGORY_IDS, categoryById, type CategoryId } from './sources'
import { sendTestPost } from './poller'
import { SITE_URL } from './embed'

const MAX_CHANNELS_PER_GUILD = 5
const BRAND_COLOR = 0x0ea5e9
const REQUIRED = [
  [PermissionFlagsBits.ViewChannel, 'View Channel'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
] as const

type Subscription = typeof subscriptions.$inferSelect

const channelOpt = (o: import('discord.js').SlashCommandChannelOption) =>
  o.setName('channel').setDescription('The channel that receives news')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)

export const commandData = new SlashCommandBuilder()
  .setName('feed')
  .setDescription('Star Citizen news from SC Feed')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
  .addSubcommand(s => s.setName('setup').setDescription('Post news in a channel, or change what it gets')
    .addChannelOption(channelOpt)
    .addRoleOption(o => o.setName('role').setDescription('Optional role to ping on each post')))
  .addSubcommand(s => s.setName('role').setDescription('Choose which role each post pings, for all categories or one')
    .addChannelOption(channelOpt)
    .addStringOption(o => o.setName('category').setDescription('Leave empty to set the default for every category')
      .addChoices({ name: 'All categories (default)', value: 'all' }, ...CATEGORIES.map(c => ({ name: c.label, value: c.id }))))
    .addRoleOption(o => o.setName('role').setDescription('Leave empty to clear (a category then uses the default)'))
    .addBooleanOption(o => o.setName('mute').setDescription('Never ping for this category, even if there is a default')))
  .addSubcommand(s => s.setName('test').setDescription('Post the newest item so you can see what it looks like')
    .addChannelOption(channelOpt))
  .addSubcommand(s => s.setName('remove').setDescription('Stop posting news in a channel')
    .addChannelOption(channelOpt))
  .addSubcommand(s => s.setName('status').setDescription("List this server's news channels"))
  .toJSON()

// ---------- helpers ----------

function missingPerms(channel: GuildBasedChannel): string[] {
  const me = channel.guild.members.me
  const perms = me ? channel.permissionsFor(me) : null
  return REQUIRED.filter(([bit]) => !perms?.has(bit)).map(([, name]) => name)
}

function roleWarning(channel: GuildBasedChannel, role: Role | null): string {
  if (!role || role.mentionable) return ''
  const me = channel.guild.members.me
  if (me && channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone)) return ''
  return `\n⚠️ ${role} is not mentionable, so posts will show it without pinging anyone. ` +
    'Turn on **Allow anyone to @mention this role** in Server Settings → Roles.'
}

function describeSub(sub: Subscription): string {
  const cats = sub.categories.map(c => categoryById.get(c as CategoryId)?.label ?? c).join(', ')
  const lines = [`**<#${sub.channelId}>** — ${cats}`]
  const overrides = Object.entries(sub.categoryRoles)
    .map(([c, r]) => `${categoryById.get(c as CategoryId)?.label ?? c} → ${r ? `<@&${r}>` : 'no ping'}`)
  if (sub.roleId || overrides.length) {
    lines.push(`Pings: ${sub.roleId ? `<@&${sub.roleId}> (default)` : 'none by default'}${overrides.length ? ` · ${overrides.join(' · ')}` : ''}`)
  }
  if (sub.paused) lines.push(`⏸️ Paused after repeated errors: \`${sub.lastError}\`. Fix the permissions, then run \`/feed setup\` again.`)
  return lines.join('\n')
}

function editor(sub: Subscription, note = '') {
  const embed = new EmbedBuilder().setColor(BRAND_COLOR).setTitle('SC Feed news channel')
    .setDescription(describeSub(sub) + note + '\n\nPick the categories this channel gets:')
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`feed:cats:${sub.id}`)
    .setMinValues(1).setMaxValues(CATEGORIES.length)
    .addOptions(CATEGORIES.map(c => ({
      label: c.label, value: c.id, description: c.description, default: sub.categories.includes(c.id),
    })))
  const buttons = new ButtonBuilder().setCustomId(`feed:test:${sub.id}`).setStyle(ButtonStyle.Secondary).setLabel('Send a test post')
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(buttons),
    ],
  }
}

async function subForChannel(channelId: string, guildId: string): Promise<Subscription | null> {
  const r = await db.select().from(subscriptions)
    .where(and(eq(subscriptions.channelId, channelId), eq(subscriptions.guildId, guildId))).limit(1)
  return r[0] ?? null
}

async function subById(id: number, guildId: string): Promise<Subscription | null> {
  const r = await db.select().from(subscriptions)
    .where(and(eq(subscriptions.id, id), eq(subscriptions.guildId, guildId))).limit(1)
  return r[0] ?? null
}

const ephemeral = { flags: MessageFlags.Ephemeral } as const

// ---------- handlers ----------

async function onCommand(i: ChatInputCommandInteraction<'cached'>, rest: REST) {
  const sub = i.options.getSubcommand()

  if (sub === 'status') {
    const subs = await db.select().from(subscriptions).where(eq(subscriptions.guildId, i.guildId))
    const text = subs.length ? subs.map(describeSub).join('\n\n') : 'No news channels yet. Run `/feed setup` to add one.'
    await i.reply({ ...ephemeral, embeds: [new EmbedBuilder().setColor(BRAND_COLOR).setTitle('SC Feed').setDescription(text)
      .setFooter({ text: SITE_URL.replace('https://', '') })] })
    return
  }

  const channel = i.options.getChannel('channel', true) as GuildBasedChannel
  const existing = await subForChannel(channel.id, i.guildId)

  if (sub === 'setup') {
    const missing = missingPerms(channel)
    if (missing.length) {
      await i.reply({ ...ephemeral, content: `I can't post in ${channel} yet. Give me **${missing.join(', ')}** there, then try again.` })
      return
    }
    const role = i.options.getRole('role')
    let row: Subscription
    if (existing) {
      row = (await db.update(subscriptions).set({
        ...(role ? { roleId: role.id } : {}), paused: false, errorCount: 0, lastError: '', updated: new Date(),
      }).where(eq(subscriptions.id, existing.id)).returning())[0]
    } else {
      const [{ n }] = await db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.guildId, i.guildId))
      if (n >= MAX_CHANNELS_PER_GUILD) {
        await i.reply({ ...ephemeral, content: `This server already has ${MAX_CHANNELS_PER_GUILD} news channels. Remove one with \`/feed remove\` first.` })
        return
      }
      row = (await db.insert(subscriptions).values({
        guildId: i.guildId, channelId: channel.id, categories: [...CATEGORY_IDS], roleId: role?.id ?? null, createdBy: i.user.id,
      }).returning())[0]
    }
    await i.reply({ ...ephemeral, ...editor(row, roleWarning(channel, role)) })
    return
  }

  if (!existing) {
    await i.reply({ ...ephemeral, content: `${channel} isn't a news channel. Run \`/feed setup\` first.` })
    return
  }

  if (sub === 'role') {
    const role = i.options.getRole('role')
    const mute = i.options.getBoolean('mute') ?? false
    const cat = (i.options.getString('category') ?? 'all') as CategoryId | 'all'
    let content: string
    if (cat === 'all') {
      await db.update(subscriptions).set({ roleId: role?.id ?? null, updated: new Date() }).where(eq(subscriptions.id, existing.id))
      content = role ? `Posts in ${channel} ping ${role} by default.` : `Posts in ${channel} no longer ping a default role.`
    } else {
      const label = categoryById.get(cat)!.label
      const categoryRoles = { ...existing.categoryRoles }
      if (mute) categoryRoles[cat] = ''
      else if (role) categoryRoles[cat] = role.id
      else delete categoryRoles[cat]
      await db.update(subscriptions).set({ categoryRoles, updated: new Date() }).where(eq(subscriptions.id, existing.id))
      content = mute ? `${label} posts in ${channel} won't ping anyone.`
        : role ? `${label} posts in ${channel} ping ${role}.`
        : `${label} posts in ${channel} use the default ping${existing.roleId ? ` (<@&${existing.roleId}>)` : ' (none set)'}.`
    }
    await i.reply({ ...ephemeral, content: content + (mute ? '' : roleWarning(channel, role)), allowedMentions: { parse: [] } })
  } else if (sub === 'test') {
    await i.deferReply(ephemeral)
    try {
      await sendTestPost(rest, channel.id, existing.categories as CategoryId[])
      await i.editReply(`Test post sent to ${channel}.`)
    } catch (err) {
      await i.editReply(`Couldn't post in ${channel}: ${String((err as Error).message ?? err)}`)
    }
  } else if (sub === 'remove') {
    await db.delete(subscriptions).where(eq(subscriptions.id, existing.id))
    await i.reply({ ...ephemeral, content: `Stopped posting news in ${channel}.` })
  }
}

async function onSelect(i: StringSelectMenuInteraction<'cached'>) {
  const sub = await subById(Number(i.customId.split(':')[2]), i.guildId)
  if (!sub) { await i.update({ content: 'That news channel was removed.', embeds: [], components: [] }); return }
  const categories = i.values.filter((v): v is CategoryId => (CATEGORY_IDS as string[]).includes(v))
  const [row] = await db.update(subscriptions).set({ categories, updated: new Date() })
    .where(eq(subscriptions.id, sub.id)).returning()
  await i.update(editor(row, '\n✅ Saved.'))
}

async function onButton(i: ButtonInteraction<'cached'>, rest: REST) {
  const sub = await subById(Number(i.customId.split(':')[2]), i.guildId)
  if (!sub) { await i.reply({ ...ephemeral, content: 'That news channel was removed.' }); return }
  await i.deferReply(ephemeral)
  try {
    await sendTestPost(rest, sub.channelId, sub.categories as CategoryId[])
    await i.editReply(`Test post sent to <#${sub.channelId}>.`)
  } catch (err) {
    await i.editReply(`Couldn't post in <#${sub.channelId}>: ${String((err as Error).message ?? err)}`)
  }
}

export async function handleInteraction(i: Interaction, rest: REST, allowlist: string[]) {
  if (!i.inCachedGuild()) return
  if (allowlist.length && !allowlist.includes(i.guildId)) {
    if (i.isRepliable()) await i.reply({ ...ephemeral, content: 'SC Feed is not available in this server yet.' })
    return
  }
  // Manage Server is the command's default gate, but menus and buttons bypass command
  // permissions entirely — so enforce it here for every interaction.
  if (!i.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    if (i.isRepliable()) await i.reply({ ...ephemeral, content: 'You need **Manage Server** to change SC Feed settings.' })
    return
  }
  if (i.isChatInputCommand() || i.isMessageComponent()) {
    const what = i.isChatInputCommand() ? `/feed ${i.options.getSubcommand()}` : i.customId
    console.log(new Date().toISOString(), '[commands]', `${what} in ${i.guildId} by ${i.user.id}`)
  }
  try {
    if (i.isChatInputCommand() && i.commandName === 'feed') await onCommand(i, rest)
    else if (i.isStringSelectMenu() && i.customId.startsWith('feed:cats:')) await onSelect(i)
    else if (i.isButton() && i.customId.startsWith('feed:test:')) await onButton(i, rest)
  } catch (err) {
    console.error(new Date().toISOString(), '[commands]', err)
    const msg = { ...ephemeral, content: 'Something went wrong. Try again in a minute.' }
    if (i.isRepliable()) await (i.deferred || i.replied ? i.followUp(msg) : i.reply(msg)).catch(() => {})
  }
}
