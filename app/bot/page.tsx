import type { Metadata } from 'next'
import Link from 'next/link'
import { BOT_INVITE_URL, BotPage, Section } from './shared'

export const metadata: Metadata = {
  title: 'SC Feed for Discord',
  description: 'Add SC Feed to your Discord server and get Star Citizen news posted as it happens: patch notes, dev posts, RSI status and more.',
  alternates: { canonical: '/bot' },
}

export default function BotLandingPage() {
  return (
    <BotPage back={{ href: '/', label: 'Back to SC Feed' }} title="SC Feed for Discord">
      <p className="text-base font-body text-on-surface-variant mb-6 leading-relaxed">
        Star Citizen news in your server, posted as it happens. Pick a channel, pick what you want to hear about,
        and SC Feed does the rest.
      </p>
      <a
        href={BOT_INVITE_URL}
        className="inline-flex items-center gap-2 px-5 py-3 mb-12 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] text-white text-sm font-label font-black uppercase tracking-widest transition-colors"
      >
        Add to Discord
      </a>

      <Section title="What it posts">
        <ul>
          <li><strong>Star Citizen news</strong>: Comm-Links, This Week in Star Citizen, newsletters (via Pipeline)</li>
          <li><strong>Patch notes</strong>: LIVE and PTU</li>
          <li><strong>Dev tracker</strong>: CIG staff posts on Spectrum and Reddit, and Knowledge Base edits with what changed (via TrackerSC)</li>
          <li><strong>Spectrum announcements</strong></li>
          <li><strong>RSI on X</strong>: posts from @RobertsSpaceInd</li>
          <li><strong>Server status</strong>: RSI Status incidents and maintenance</li>
          <li><strong>Star Citizen YouTube</strong>: new videos on the official channel</li>
          <li><strong>Testing chat MOTD</strong>: PTU build status</li>
        </ul>
        <p>When the same story arrives from two sources, your channel gets it once.</p>
      </Section>

      <Section title="Setup">
        <p>After adding the bot, someone with <strong>Manage Server</strong> runs:</p>
        <ul>
          <li><code>/feed setup channel:#news</code>: start posting in a channel, then pick categories</li>
          <li><code>/feed role</code>: ping a role on each post, or a different role per category (optional; roles must be mentionable)</li>
          <li><code>/feed test</code>: post the newest item so you can see what it looks like</li>
          <li><code>/feed status</code> and <code>/feed remove</code></li>
        </ul>
        <p>
          The bot needs <strong>View Channel</strong>, <strong>Send Messages</strong> and <strong>Embed Links</strong> in
          the channel. It asks for nothing else and never reads your messages.
        </p>
      </Section>

      <Section title="The fine print">
        <p>
          <Link href="/bot/privacy">Privacy policy</Link> · <Link href="/bot/terms">Terms of service</Link>
        </p>
        <p>
          SC Feed is a fan project by <a href="https://subliminal.gg">SubliminalsTV</a> and is not affiliated with
          Cloud Imperium Games.
        </p>
      </Section>
    </BotPage>
  )
}
