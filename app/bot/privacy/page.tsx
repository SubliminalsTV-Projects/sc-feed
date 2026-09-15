import type { Metadata } from 'next'
import { BotPage, Section } from '../shared'

export const metadata: Metadata = {
  title: 'Discord Bot Privacy — SC Feed',
  description: 'What the SC Feed Discord bot stores about your server, and what it never touches.',
  alternates: { canonical: '/bot/privacy' },
}

// Keep this in step with bot/src/schema.ts: every stored field must be listed here.
export default function BotPrivacyPage() {
  return (
    <BotPage back={{ href: '/bot', label: 'SC Feed for Discord' }} title="Discord bot privacy" updated="September 2026">
      <Section title="TL;DR">
        <p>
          The SC Feed bot stores only what it needs to post news where your server asked for it. It does not read
          messages, does not see your member list, does not send DMs, and does not sell or share anything.
        </p>
      </Section>

      <Section title="What the bot stores">
        <ul>
          <li><strong>Your server</strong>: its ID and name, and when the bot joined or was removed.</li>
          <li>
            <strong>News channel settings</strong>: the channel ID, the categories you picked, the role to ping (if any),
            and the ID of the person who ran <code>/feed setup</code>.
          </li>
          <li>
            <strong>Delivery log</strong>: which news items were posted to which channel, with the ID of the posted
            message. This is what stops the bot posting the same item twice. Entries are deleted after 45 days.
          </li>
          <li>
            <strong>Errors</strong>: if posting fails (for example, a missing permission), the error text, so
            <code>/feed status</code> can show you what to fix.
          </li>
        </ul>
      </Section>

      <Section title="What the bot never touches">
        <ul>
          <li>Message content. The bot does not have the Message Content intent and cannot read your chat.</li>
          <li>Your member list or anyone&apos;s presence. It does not have those intents either.</li>
          <li>Direct messages. It never sends or reads DMs.</li>
          <li>Anything outside the channels you set up, beyond the channel and role names Discord shows it.</li>
        </ul>
      </Section>

      <Section title="Removing your data">
        <ul>
          <li><code>/feed remove</code> deletes that channel&apos;s settings and its delivery log immediately.</li>
          <li>
            Removing the bot from your server deletes all of that server&apos;s channel settings and delivery logs
            immediately. The server ID, name and join/leave dates are kept as a record of past installs.
          </li>
          <li>
            To have that record deleted too, email <a href="mailto:sub@subliminal.gg">sub@subliminal.gg</a> with your
            server ID.
          </li>
        </ul>
      </Section>

      <Section title="Where it lives">
        <p>
          The bot and its database run on a server operated by SubliminalsTV. Discord processes your use of the bot
          under <a href="https://discord.com/privacy">Discord&apos;s own privacy policy</a>. News content comes from
          public sources; see the <a href="/privacy">SC Feed privacy page</a> for the website.
        </p>
      </Section>

      <Section title="Questions">
        <p>
          Email <a href="mailto:sub@subliminal.gg">sub@subliminal.gg</a>.
        </p>
      </Section>
    </BotPage>
  )
}
