import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Privacy — SC Feed',
  description: 'What SC Feed stores in your browser, what we send to our server, and what we don\'t do.',
}

export default function PrivacyPage() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-6 py-10 sm:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-[11px] font-label font-black uppercase tracking-widest text-on-surface-variant/60 hover:text-on-surface mb-8 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back to SC Feed
        </Link>

        <h1 className="text-3xl sm:text-4xl font-headline font-black text-on-surface mb-2">Privacy</h1>
        <p className="text-sm font-body text-on-surface-variant/70 mb-10">
          Last updated: May 2026
        </p>

        <Section title="TL;DR">
          <p>
            SC Feed stores your preferences in your browser. We use Google Analytics for anonymous,
            aggregate usage stats (which pages get visited, roughly how many people use the app) &mdash;
            but we don&apos;t sell your data, don&apos;t run ads, and don&apos;t build a profile on you.
            Push notifications are optional and only sent for new feed activity.
          </p>
        </Section>

        <Section title="What we store on your device">
          <p>
            SC Feed uses your browser&apos;s localStorage to remember preferences across visits.
            None of this leaves your computer.
          </p>
          <ul>
            <li><strong>Layout</strong> — column order, widths, heights, and which feeds are visible.</li>
            <li><strong>Read state</strong> — which messages you&apos;ve marked as read, plus your &ldquo;mark all read&rdquo; cutoff timestamp.</li>
            <li><strong>Custom feeds</strong> — the YouTube channels, Twitch streamers, and RSS URLs you&apos;ve added in Settings.</li>
            <li><strong>Display preferences</strong> — theme (dark/light), tab bar visibility, date format, leak reveal toggle, OmniFeed source filters.</li>
            <li><strong>GitHub widget cache</strong> — version/star/fork counts for the repo shown in the header, cached 1 hour to avoid re-hitting GitHub on every page load.</li>
            <li><strong>PWA install dismissal</strong> — if you dismissed the install prompt, we remember not to show it again.</li>
            <li><strong>Cookie acknowledgement</strong> — the fact that you clicked &ldquo;Got it&rdquo; on the storage notice.</li>
          </ul>
        </Section>

        <Section title="What we send to our server">
          <ul>
            <li>
              <strong>Push notifications (optional).</strong> If you enable them in Settings, your browser provides a push subscription endpoint
              from its push service (Firebase for Chrome/Edge, Mozilla autopush for Firefox, Apple push for Safari). We store this endpoint
              so we can deliver alerts. It&apos;s only used for SC Feed activity notifications. Toggle off in Settings → Push Notifications to stop.
            </li>
            <li>
              <strong>Standard web server logs.</strong> IP address, request path, timestamp. Used for debugging and abuse prevention.
              Rotated regularly. Not aggregated, not analyzed for marketing.
            </li>
          </ul>
        </Section>

        <Section title="Analytics">
          <p>
            SC Feed uses <strong>Google Analytics 4</strong> to understand how the app is used in aggregate
            &mdash; page views, rough visitor counts, browser and device type, approximate region. This helps
            decide what to build and fix next. Google sets a couple of cookies (<code>_ga</code>, <code>_ga_*</code>)
            and your browser loads its <code>gtag.js</code> script from <code>googletagmanager.com</code>.
          </p>
          <p>
            We don&apos;t enable Google&apos;s advertising features, don&apos;t use it to build an advertising
            profile, and don&apos;t share the data with anyone. You can block it with most ad/tracker blockers
            or your browser&apos;s &ldquo;Do Not Track&rdquo; / privacy settings, and SC Feed will work exactly the same.
          </p>
        </Section>

        <Section title="What we don't do">
          <ul>
            <li>No advertising networks, ad pixels, or retargeting</li>
            <li>No Google Analytics advertising features (no ad personalization, no Google Signals)</li>
            <li>No selling, sharing, renting, or licensing of any user data</li>
            <li>No fingerprinting, no cross-site tracking</li>
          </ul>
        </Section>

        <Section title="Third-party content">
          <p>SC Feed pulls public content from:</p>
          <ul>
            <li>Star Citizen Spectrum (Announcements, Patch Notes, MOTDs from public lobbies)</li>
            <li>Discord channels in publicly-listed Star Citizen community pipelines</li>
            <li>RSI status page</li>
            <li>YouTube channel RSS (Star Citizen + SubliminalsTV by default; you can add more)</li>
            <li>Twitch live status (SubliminalsTV by default; you can add more)</li>
            <li>Any RSS feeds you add yourself</li>
            <li><strong>GitHub public REST API</strong> — used by the small repo widget in the header to show release version, stars, and forks. Your browser fetches <code>api.github.com/repos/...</code> and the result is cached in your localStorage for 1 hour.</li>
          </ul>
          <p>
            When your browser loads images, video thumbnails, or audio attachments from these sources, the source server
            may see your IP address and standard browser headers. We don&apos;t add any extra tracking on top of those
            standard requests.
          </p>
        </Section>

        <Section title="Clearing your data">
          <ul>
            <li>Use your browser&apos;s &ldquo;Clear site data&rdquo; option for <code>sc-feed.subliminal.gg</code>.</li>
            <li>Or open DevTools → Application → Local Storage and clear entries prefixed <code>sc-feed-</code>.</li>
            <li>Or, for granular control, use the Settings panel inside SC Feed: remove individual custom feeds, mark all unread, or apply a layout preset.</li>
          </ul>
          <p>
            To stop push notifications: toggle off in Settings → Push Notifications, or revoke notification permission
            in your browser&apos;s site settings.
          </p>
        </Section>

        <Section title="Questions">
          <p>
            SC Feed is part of <a href="https://subliminal.gg" className="text-primary-container hover:underline">SubliminalsTV</a>,
            a personal project. For questions or to request data deletion, reach out at{' '}
            <a href="mailto:sub@subliminal.gg" className="text-primary-container hover:underline">sub@subliminal.gg</a>.
          </p>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-headline font-black text-on-surface mb-3 pb-2 border-b border-outline-variant/30">
        {title}
      </h2>
      <div className="space-y-3 text-sm font-body text-on-surface-variant leading-relaxed [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:list-disc [&_li]:marker:text-primary-container/40 [&_strong]:text-on-surface [&_code]:text-[12px] [&_code]:bg-surface-container-high [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-on-surface">
        {children}
      </div>
    </section>
  )
}
