export type PatchNoteSection = {
  heading?: string
  items: string[]
}

export type PatchNote = {
  version: string
  date: string
  title?: string
  intro?: string
  sections: PatchNoteSection[]
}

export const PATCH_NOTES: PatchNote[] = [
  {
    version: '0.1.2',
    date: '2026-09-16',
    title: 'Your dashboard, your way',
    intro:
      'The biggest update since launch. Arrange the dashboard however you like, take it to every device, and read more without leaving the page.',
    sections: [
      {
        heading: "What's new",
        items: [
          '**Drag and resize panels** — grab a panel by its header to move it, or drag any edge to resize it. Panels snap to a grid, always fill the height of your screen, and scroll sideways when you add more. Width and height menus are gone; the layout is the menu now.',
          '**Your setup on every device** — sign in with Google, Discord or Twitch and your layout, presets, settings, custom feeds and read state follow you. Mark something read on your phone and it is read on your PC. Signing in is optional.',
          '**Save for later** — signed in, hit the bookmark on any card and it lands in your Saved feed.',
          '**Read it right here** — click a card to open it in a reader instead of a new tab. Comm-Links come with their hero image and full formatted article.',
          '**See what changed in the Knowledge Base** — when CIG updates a KB article, the card shows exactly which lines changed. Repeat pings for the same edit collapse into one card.',
          '**Dev replies with context** — Dev Tracker posts from Spectrum and Reddit now show what the dev was replying to, and Spectrum posts keep their headings, lists and emoji.',
          '**Layout presets you can share** — export your layout as text and import it anywhere. The 16:9 and 9:16 presets are still one click away.',
          '**Reworked header and Settings** — Settings slides in from the left in six sections, notifications slide in from the right, and the theme follows your system by default. The notification sound has mute and volume controls.',
          '**A month of history** — SC Feed moved to a new database and now keeps 30 days of posts instead of 15.',
          '**More reliable MOTDs** — the SC and Evocati MOTDs are captured a new way, so they stay current.',
          '**Better link previews** — sharing SC Feed on Discord or X now shows a proper preview card.',
        ],
      },
      {
        heading: 'Privacy update',
        items: [
          '**Signing in stores settings on your account** — if you sign in, your settings, read state and saved items are kept against your account email so they can sync. Signed out, everything stays in your browser like before.',
          '**Self-hosted analytics** — alongside Google Analytics, SC Feed now uses Umami, which we host ourselves. It sets no cookies and never shares data with anyone. Bots are filtered out of both. Full details on the [privacy page](/privacy).',
        ],
      },
    ],
  },
  {
    version: '0.1.1',
    date: '2026-06-15',
    title: 'New feed, faster loads, cleaner UI',
    intro:
      'More signal with less clutter — a new official source, a snappier dashboard, and a tidied-up interface.',
    sections: [
      {
        heading: "What's new",
        items: [
          '**RSI Twitter feed** — official @RobertsSpaceInd posts now flow straight into the feed, alongside Spectrum and the Discord pipelines.',
          '**Faster loads** — feed data is cached at the CDN edge, so the dashboard paints quicker and refreshes lighter.',
          '**Restructured header + unified notifications** — the two notification systems are merged into one, with a new Star Citizen community shortcut.',
          '**Tidier cards** — removed source pills and overflow clutter for a cleaner read.',
        ],
      },
      {
        heading: 'Privacy update',
        items: [
          '**Analytics added (and disclosed)** — SC Feed now uses Google Analytics for anonymous, aggregate page-view stats so we can see which feeds matter. No personal data is collected, and your preferences and read-state still live only in your browser. Full details on the [privacy page](/privacy).',
        ],
      },
    ],
  },
  {
    version: '0.1.0',
    date: '2026-05-01',
    title: 'Welcome to SC Feed',
    intro:
      'A real-time Star Citizen news dashboard — every official announcement, patch note, MOTD, and community signal in one place.',
    sections: [
      {
        heading: "What's in this release",
        items: [
          '**Live multi-source feed** — Spectrum (Announcements, Patch Notes, EVO + LIVE MOTDs), Discord community pipelines (CIG News, Pipeline, TrackerSC), RSI Status, YouTube channels, Twitch live status. Refreshes every 10 minutes.',
          '**Add your own feeds** — wire in any YouTube channel, Twitch streamer, or RSS URL from Settings.',
          '**Push notifications** — opt in for new posts on any source; works on desktop, Android, and iOS PWA.',
          '**Install as an app** — full PWA with offline-capable shell and a home-screen icon.',
          '**Customize the layout** — drag column order, resize widths and heights, hide feeds you don\'t care about. Save layouts as named presets.',
          '**Read-state tracking** — per-message read marks and a "mark all read" cutoff that survives reloads.',
          '**Spotlight search** — Cmd/Ctrl+K or / to search across every visible feed.',
          '**Light + dark themes** + short/long date formatting.',
          '**Privacy-first** — all preferences stored locally in your browser.',
        ],
      },
    ],
  },
]

export const CURRENT_VERSION = PATCH_NOTES[0].version
export const PATCH_NOTES_SEEN_KEY = 'sc-feed-patch-notes-seen'
