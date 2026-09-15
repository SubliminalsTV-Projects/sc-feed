import type { Metadata } from 'next'
import { BotPage, Section } from '../shared'

export const metadata: Metadata = {
  title: 'Discord Bot Terms — SC Feed',
  description: 'Terms of service for the SC Feed Discord bot.',
  alternates: { canonical: '/bot/terms' },
}

export default function BotTermsPage() {
  return (
    <BotPage back={{ href: '/bot', label: 'SC Feed for Discord' }} title="Discord bot terms" updated="September 2026">
      <Section title="The short version">
        <p>
          The SC Feed bot is free. Use it in your server as much as you like. It comes with no guarantees, and it may
          change or stop at any time.
        </p>
      </Section>

      <Section title="Using the bot">
        <ul>
          <li>You must follow <a href="https://discord.com/terms">Discord&apos;s Terms of Service</a> and Community Guidelines.</li>
          <li>
            Don&apos;t use the bot to break Discord&apos;s rules, and don&apos;t try to disrupt the service, for example by
            overloading it or probing it for weaknesses.
          </li>
          <li>We may stop serving a server that misuses the bot.</li>
        </ul>
      </Section>

      <Section title="The news it posts">
        <ul>
          <li>
            News items link back to where they came from: RSI, Spectrum, Reddit, YouTube, X, and community curators
            such as Pipeline and TrackerSC. That content belongs to its authors.
          </li>
          <li>
            SC Feed collects it automatically and can be late, incomplete or wrong. Always check the original source
            before acting on it.
          </li>
          <li>
            Star Citizen and Roberts Space Industries are trademarks of Cloud Imperium Games. SC Feed is a fan project
            and is not affiliated with or endorsed by Cloud Imperium Games.
          </li>
        </ul>
      </Section>

      <Section title="No warranty">
        <p>
          The bot is provided &ldquo;as is&rdquo;, without warranty of any kind. To the extent the law allows, SubliminalsTV
          is not liable for any loss or damage that comes from using it, or from it being unavailable.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          These terms may change. The date at the top shows the latest version. Continuing to use the bot after a
          change means you accept it.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Email <a href="mailto:sub@subliminal.gg">sub@subliminal.gg</a>.
        </p>
      </Section>
    </BotPage>
  )
}
