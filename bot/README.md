# SC Feed Discord bot

A public Discord bot. Servers invite it, pick a channel and categories with `/feed setup`, and it
posts an embed for every new Star Citizen news item that reaches SC Feed.

- **Discord app:** "SC Feed", id `1484283647027712232` (the bot user is `SC News#7087`; renaming a
  verified app's bot needs Discord support). Guild install only, scopes `bot applications.commands`,
  permissions `19456` (View Channels, Send Messages, Embed Links). No privileged intents.
- **Invite:** https://discord.com/oauth2/authorize?client_id=1484283647027712232 (also on `/bot`).
- **Public pages:** `/bot`, `/bot/privacy`, `/bot/terms` on sc-feed.subliminal.gg (in `app/bot/`).

## How it works

`src/poller.ts` reads `scfeed.sc_feed_messages` every 60s with a cursor on the identity `id`, and
fans each new row out to the channels that follow its category. The file header explains each guard:
the settle delay, the 12h freshness window, the claim-before-send delivery log (never posts twice),
and the cross-source dedupe key.

| File | Job |
|---|---|
| `src/index.ts` | Client, events (join/leave/channel delete), shutdown |
| `src/poller.ts` | Cursor loop, fan-out, dedupe, test posts |
| `src/commands.ts` | `/feed setup · role · test · remove · status`, category picker |
| `src/embed.ts` | Row → embed + "Open in SC Feed" button |
| `src/sources.ts` | Which scfeed channels are carried, and their categories and colours |
| `src/schema.ts` | `feedbot.*` tables (Drizzle) + idempotent startup DDL |

Imports sc-feed's Drizzle schema from `../lib/db.ts`. A column rename there breaks `npm run
bot:typecheck` instead of silently breaking the bot.

## Env

| Var | Value |
|---|---|
| `DISCORD_TOKEN` | BW `API - SC Feed Bot` (single raw line) |
| `DATABASE_URL` | BW `API - Feedbot Database` (`postgres://feedbot_app:…@te7082rmeabjlnwzimhtdg9h:5432/subliminal`) |
| `FEEDBOT_GUILD_IDS` | Optional. Comma-separated. When set, the bot only serves these servers. Leave unset in production. |

## Database role (one-time, done 2026-09-15)

Run as `tsadmin` in the Timescale container. The bot creates its own tables at startup.

```sql
CREATE ROLE feedbot_app LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE subliminal TO feedbot_app;
CREATE SCHEMA feedbot AUTHORIZATION feedbot_app;
GRANT USAGE ON SCHEMA scfeed TO feedbot_app;
GRANT SELECT ON scfeed.sc_feed_messages, scfeed.sc_feed_kb_diffs TO feedbot_app;
```

## Run locally

The DB is private to the VPS, so open a tunnel to the Timescale container first (its IP on the
`coolify` network was `10.0.1.10`; check with `docker inspect`):

```bash
ssh -N -L 55432:10.0.1.10:5432 vps
```

Then run with `DATABASE_URL` pointing at `127.0.0.1:55432` and `FEEDBOT_GUILD_IDS` set to the test
server:

```bash
npm run bot:dev
```

🔴 Stop it when you're done. Two running copies with the same token both answer commands, and both
post news.

## Checks

```bash
npm run bot:typecheck   # tsc -p bot
npm run bot:build       # esbuild → bot/dist/index.js (one file, no node_modules needed)
```

## Deploy (Coolify on the VPS)

New application from this repo, branch `timescale-migration`:

- Build pack **Dockerfile**, base directory `/`, Dockerfile location **`/bot/Dockerfile`**.
- **No domain, no exposed port.** It's an outbound-only worker, like Minion.
- Env: `DISCORD_TOKEN`, `DATABASE_URL` (above). Don't set `FEEDBOT_GUILD_IDS`.
- Coolify auto-deploy doesn't fire for sc-feed. Trigger deploys by hand, as for the site.

Only one instance may run at a time. Stop the local test copy before the Coolify one starts.
