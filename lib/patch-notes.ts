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
