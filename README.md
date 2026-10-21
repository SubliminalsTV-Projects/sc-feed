<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="public/logos/[SCFeed][Logo][White][Color].svg" />
  <img src="public/logos/[SCFeed][Logo][Black][Color].svg" alt="SC Feed" width="280" />
</picture>

# SC Feed

**Real-time Star Citizen news dashboard.** Every official announcement, patch note, MOTD, and community signal in one place.

[**Live → sc-feed.subliminal.gg**](https://sc-feed.subliminal.gg)

</div>

---

## What it is

SC Feed pulls from the canonical Star Citizen sources (Spectrum, RSI Status, Discord pipelines, RSI on X, YouTube, Twitch) and renders them as a TweetDeck-style multi-column dashboard. It refreshes every 10 minutes, supports push notifications and installs as a PWA. Your preferences stay in your browser unless you choose to sign in, which syncs them across devices.

There is also a **Discord bot** that posts the same news into your own server — see [Discord bot](#discord-bot).

It's part of [SubliminalsTV](https://subliminal.gg). Built for SC pilots who want the news without checking eight different tabs.

## Sources

| Source | What it pulls |
|---|---|
| **Spectrum** | Announcements, Patch Notes, EVO MOTD, LIVE MOTD |
| **Discord pipelines** | CIG News, Pipeline, TrackerSC, dev-replied threads |
| **RSI Status** | RSS feed of incidents, latest 5 + per-incident detail |
| **RSI on X** | Posts from @RobertsSpaceInd |
| **YouTube** | Star Citizen channel + SubliminalsTV by default; add any other channel from Settings |
| **Twitch** | SubliminalsTV live status by default; add any other streamer from Settings |
| **Custom RSS** | Add your own RSS feeds from Settings |

## Features

- **Live multi-column dashboard** — drag panels by their header, resize them from any edge, hide feeds you don't care about, save layouts as named presets and export/import them as text
- **OmniFeed** — single merged feed across every active source, with per-source toggle pills
- **Reader** — click a card to read it in place; Comm-Links include their hero image and full article
- **Knowledge Base diffs** — when CIG edits a KB article, the card shows which lines changed
- **Optional sign-in** (Google, Discord, Twitch) — syncs layout, settings, read state and a Saved list across devices
- **Read-state tracking** — per-message read marks plus a "mark all read" cutoff that survives reloads
- **Spotlight search** — `Cmd/Ctrl+K` or `/` to search across every visible feed
- **Push notifications** — opt in for new posts on any source; works on desktop, Android, and iOS PWA
- **Installable as a PWA** with offline-capable shell and home-screen icon
- **Light + dark themes**, short/long date formatting
- **Mobile-responsive** — tab bar swiper on mobile, hamburger menu, full-bleed cards
- **Privacy** — no ad cookies or trackers. Page-view analytics (Google Analytics plus self-hosted Umami, bots filtered out). Signed out, all preferences stay in `localStorage`. See [Privacy](https://sc-feed.subliminal.gg/privacy)

## Discord bot

Invite it from [sc-feed.subliminal.gg/bot](https://sc-feed.subliminal.gg/bot), then run `/feed setup` in a channel and pick the categories to follow: news, patch notes, dev tracker, Spectrum announcements, RSI on X, server status, the official YouTube channel and the PTU MOTD. `/feed role` sets role pings per channel or per category. Each item is posted once, linking to the original source.

The bot lives in [`bot/`](bot/README.md) (TypeScript + discord.js). It reads the same database as the site, read-only, and runs as a separate outbound-only worker.

## Tech stack

| Layer | Stack |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| State | React + `localStorage`, synced to your account when signed in |
| Auth | NextAuth v5 (Google, Discord, Twitch) |
| Data store | PostgreSQL (TimescaleDB) via Drizzle ORM |
| Cron | Host crontab → the app's cron endpoints |
| Hosting | Docker on a VPS, deployed with Coolify |
| Package manager | npm |

## Architecture

```
┌─ Browser ──────────────────────┐        ┌─ VPS (sc-feed.subliminal.gg) ────┐
│  - Next.js client              │        │                                  │
│  - PWA shell + service worker  │◄──────►│  GET  /api/sc-feed     (read)    │
│  - localStorage prefs          │        │  GET  /api/cron/sc-feed/*        │
└────────────────────────────────┘        │       (5 endpoints, secret-gated)│
                                          └─────────────┬────────────────────┘
                                                        │
                            ┌───────────────────────────┴───────────────────┐
                            │                                               │
                       ┌────▼─────┐                              ┌──────────▼──────────┐
                       │ Sources  │                              │ PostgreSQL          │
                       │ Spectrum │                              │ (scfeed schema)     │
                       │ Discord  │                              │                     │
                       │ YouTube  │                              │ Messages, KB diffs, │
                       │ Twitch   │                              │ push subs, settings │
                       │ RSI Stat │                              └──────────▲──────────┘
                       └──────────┘                                         │ read-only
                                                                 ┌──────────┴──────────┐
                                                                 │ Discord bot (bot/)  │
                                                                 │ posts to servers    │
                                                                 └─────────────────────┘
```

The 5 cron endpoints are fired every 10 minutes by a host crontab on the VPS. Each endpoint is independent so a single source failing doesn't block the others.

| Cron endpoint | Typical runtime | Push? |
|---|---|---|
| `/api/cron/sc-feed/discord` | 27–35s | yes |
| `/api/cron/sc-feed/spectrum` | 25–70s | forums yes, MOTDs no |
| `/api/cron/sc-feed/status` | 1–10s | no |
| `/api/cron/sc-feed/youtube` | 1–2s | yes |
| `/api/cron/sc-feed/prune` | <1s | no (deletes >30-day-old non-YT messages) |

## Project structure

```
sc-feed/
├── app/
│   ├── layout.tsx              # Root layout — fonts, manifest, themeColor
│   ├── page.tsx                # Renders <ScFeedView />
│   ├── privacy/page.tsx        # Privacy + cookies disclosure
│   ├── globals.css
│   └── api/
│       ├── sc-feed/route.ts                # Reads Postgres, returns FeedChannel[]
│       ├── sc-feed/rsi-history/route.ts    # RSI Status RSS, top 5
│       ├── sc-feed/spectrum-health/route.ts# RSI_TOKEN validity check
│       ├── sc-feed/youtube-proxy/route.ts  # User-added YouTube channels
│       ├── sc-feed/rss-proxy/route.ts      # User-added RSS feeds
│       ├── sc-feed/twitch-proxy/route.ts   # User-added Twitch streamers
│       ├── sc-feed/push-subscribe/route.ts # Web Push VAPID
│       └── cron/sc-feed/
│           ├── _shared.ts                  # Helpers, parsers, fetchers
│           ├── discord/route.ts            # 4 Discord pipeline channels
│           ├── spectrum/route.ts           # Spectrum forums + MOTDs
│           ├── status/route.ts             # RSI Status RSS
│           ├── youtube/route.ts            # 2 branded YouTube feeds
│           └── prune/route.ts              # Old-message cleanup
├── bot/                        # Discord bot (separate worker, own Dockerfile)
├── components/sc-feed/         # Feed view, message card, settings, notifications
├── extension/                  # Owner's browser extension (RSI session push, MOTD courier)
├── lib/                        # Drizzle schema (db.ts), Twitch client, patch notes data
├── public/                     # Logos, icons, sponsor logos, sw.js, manifest
├── Dockerfile
└── package.json
```

## Self-hosting

SC Feed runs as a Docker container next to a PostgreSQL database. The hard dependencies are Node 20+, Postgres, and the env vars below. Adapt to your own infra as needed.

### 1. Provision PostgreSQL

Create a database and a `scfeed` schema, then create the tables from the Drizzle definitions in `lib/db.ts` (messages, KB snapshots and diffs, saved items, push subscriptions, config).

### 2. Install + configure

```bash
git clone https://github.com/SubliminalsTV-Projects/sc-feed.git
cd sc-feed
npm install
cp .env.example .env.local
# fill in values (see env vars below)
npm run dev
```

### 3. Required environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `CRON_SECRET` | Shared secret for `?secret=` query gate on cron endpoints |
| `RSI_TOKEN` | Spectrum session token (Evocati-tier account required for MOTD lobbies) |
| `DISCORD_BOT_TOKEN` | Bot token with read access to the public SC pipeline channels |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch app credentials for live-status polling |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push VAPID keypair (`npx web-push generate-vapid-keys`) |
| `AUTH_SECRET`, `AUTH_GOOGLE_*`, `DISCORD_OAUTH_*` | Optional sign-in (NextAuth v5). See `.env.example` |
| `SCFEED_ENC_KEYS` | Optional. `id:base64,…` AES-256 keys; Discord-sourced feed text is encrypted at rest with the first, any can decrypt. Unset = stored plain |

### 4. Deploy

Build the root `Dockerfile` and run it with the same env vars. Production uses Coolify, but any Docker host works.

### 5. Wire up the cron

The 5 endpoints are public but gated by `?secret=$CRON_SECRET`. Fire them every 10 minutes from any cron-capable host:

```cron
*/10 * * * * curl -s "https://your-domain/api/cron/sc-feed/discord?secret=YOUR_SECRET" \
            && curl -s "https://your-domain/api/cron/sc-feed/spectrum?secret=YOUR_SECRET" \
            && curl -s "https://your-domain/api/cron/sc-feed/status?secret=YOUR_SECRET"   \
            && curl -s "https://your-domain/api/cron/sc-feed/youtube?secret=YOUR_SECRET"  \
            && curl -s "https://your-domain/api/cron/sc-feed/prune?secret=YOUR_SECRET"
```

## Local development

```bash
npm install
npm run dev      # http://localhost:3000 (Turbopack)
npm run build    # production build (validates types + lint)
```

A real `next build` is more thorough than `tsc --noEmit` alone — run it before pushing if you've touched anything non-trivial.

## Contributing

Contributions are welcome. The repo is open-source so other SC pilots can fork it, file issues, propose features, or send PRs.

### Good contribution candidates

- **New sources** — additional Discord pipelines, fan sites with RSS, etc.
- **Parser improvements** — Discord/Spectrum content extraction is a moving target; better parsing for embedded patch notes, MOTD blocks, or dev replies is always useful
- **UI/UX polish** — accessibility, mobile improvements, theming
- **Performance** — bundle-size cuts, image lazy-loading, render optimizations
- **Bug reports** — open an issue with a screenshot + repro steps

### Before you start

For non-trivial changes, **open an issue first** so we can talk through the approach. Avoid hours of work on a PR I might not merge.

### Setup + workflow

1. Fork the repo and clone your fork
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill it (you'll need at least your own Postgres `DATABASE_URL` + a `CRON_SECRET` to test)
4. Make your changes on a feature branch
5. Run `npm run build` to validate
6. Open a PR against `main` with a clear description of what + why

### Style

- Match the existing code patterns — look at neighboring files
- TypeScript everywhere
- Tailwind utility classes; no separate CSS unless it's in `globals.css` already
- Keep components in `components/sc-feed/` and split when files cross ~800 lines
- Don't add dependencies for things that already exist in-repo

### Communication

Most ongoing discussion happens in the **#sc-feed** channel on the [SubliminalsTV Discord](https://discord.subliminal.gg). Drop in for quick questions or feedback.

## What you won't find here

This is a single-purpose dashboard for one community. It is **not**:

- A general-purpose news aggregator framework
- A whitelabel SaaS product
- A drop-in MMO news template

If your needs match SC Feed's, fork away. If they don't, the architecture is simple enough to learn from but you'll save time building from scratch.

## License

[GPL-3.0](LICENSE) — fork freely, modifications must be shared back if you redistribute.

## Acknowledgments

- The Star Citizen community pipeline maintainers (CIG News, Pipeline, TrackerSC) — the Discord side of this app would be far less useful without them
- RSI for keeping Spectrum publicly readable
- Everyone who's filed a bug or feature request

---

<div align="center">

Made by [SubliminalsTV](https://subliminal.gg) for the SC community.

</div>
