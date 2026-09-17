# SC Feed Companion (browser extension)

Owner tool. **Chrome is the maintained target** — see "Firefox build (frozen)" below. Three jobs:

1. **RSI token courier** — reads the `Rsi-Token` cookie from robertsspaceindustries.com
   (where Sub is logged in as the Evocati account) and pushes it to SC Feed's owner endpoint on
   every cookie change and every 6h. The VPS cron uses it to call `getMotd` for both testing
   lobbies itself, so MOTD keeps updating while the PC is off. It only ever stores Sub's token —
   the endpoint is owner-gated and writes one locked row.
   ⚠️ Periodic alarms are created only when missing (`ensureAlarm`). `alarms.create()` re-arms an
   existing alarm, and the service worker's top level re-runs on every 5-min wake — creating them
   unconditionally meant the 6h push never fired (dead 2026-08-03 → 2026-09-16).
2. **MOTD scrape (fallback)** — used only while the server's own fetch is failing; the alarm scan
   skips itself when `GET /api/owner/motd` reports the fetch healthy, and the server ignores scraped
   pushes in that state. Two paths:
   - *passive* — `content.js` catches changes instantly while you're browsing Spectrum;
   - *active* — every 15 min the background worker ensures a **pinned background tab** for each
     testing-chat lobby (`38230` → `motd-sc`, `1355241` → `motd-evo`), reviving it if Chrome's
     Memory Saver discarded it, and injects the extractor via `chrome.scripting`.

   Every scrape POSTs to `/api/owner/motd` **even when the text is unchanged**. The server
   compares signatures: a change writes a new MOTD card, an unchanged scrape only stamps the
   `motd_scan_<channel>` heartbeat. That heartbeat is what the watchdog watches — it is the only
   thing that tells "scraper alive, MOTD just quiet" apart from "scraper dead".
3. **Feed awareness** — polls `/api/sc-feed` every 5 min, shows the unread count on the toolbar
   badge, and fires a desktop notification when new items land (even with SC Feed closed). The
   popup shows the latest items, an **Open SC Feed** button, and a **Capture window** button
   (clean 1280×720 popup for stream window-capture).

> ⚠️ **Keep RSI signed in on ONE browser only.** RSI allows a single session per account, so a
> second signed-in browser silently invalidates the token this extension just pushed — which
> reads exactly like "the extension keeps resetting my token / logging me out."

## Files
- `manifest.json` — Chrome / Edge (MV3, `background.service_worker`) — **the live one**
- `manifest.firefox.json` — Firefox / Zen (MV3, `background.scripts` + gecko id) — frozen
- `background.js`, `content.js`, `popup.html`, `popup.js` — shared
- `build-firefox.sh` — assembles `dist-firefox/` (Firefox manifest as `manifest.json`) for signing

## Configure (popup → Settings)
- **SC Feed URL** — prefilled with `https://sc-feed.subliminal.gg`; the token push endpoint is derived
  from it (`/api/owner/rsi-token`) and is no longer a setting — it could only ever hold one value.
- **Push secret** — `OWNER_PUSH_SECRET` (from Bitwarden: `bw-lookup --raw "API - SCFeed Owner Push Secret"`).
  The only field that actually needs filling in.
- **Desktop notifications** — on/off

## Install — Chrome / Edge
`chrome://extensions` → Developer mode → **Load unpacked** → select this folder. No build step —
`manifest.json` is already the Chrome manifest. After an edit, hit **Reload** on the card.

## Firefox build (frozen)
`manifest.firefox.json` is pinned at **0.2.5** and is no longer kept in sync — it predates the
`scripting` permission and the active MOTD scan, so a build from it will run the passive scrape
only. The files stay for revival; to bring it back, mirror the Chrome manifest's `version` and
`permissions`, then follow the signing steps below.

Firefox/Zen require a signed add-on for permanent install. Sign it **unlisted** on AMO (free):

```bash
git clone https://github.com/SubliminalsTV-Projects/sc-feed.git
cd sc-feed/extension
./build-firefox.sh                      # → dist-firefox/
npm install -g web-ext                  # one-time
# Get API creds at https://addons.mozilla.org/developers/addon/api/key/
web-ext sign --source-dir=dist-firefox --channel=unlisted \
  --api-key=<ISSUER> --api-secret=<SECRET>
```

`web-ext sign` outputs a signed `.xpi` under `web-ext-artifacts/`. In Zen: `about:addons` →
gear icon → **Install Add-on From File…** → pick the `.xpi`. Permanent, survives restarts.

(Quick test without signing: `about:debugging` → This Firefox → **Load Temporary Add-on** →
pick `dist-firefox/manifest.json`. Resets on restart.)

## Verify
- Popup → **Push token now** → status reads `✓ token synced`. The owner backend at `/owner`
  shows `{ set: true, updated_via: "extension" }`.
- Popup → **Scan MOTD now** → takes up to ~40s (it waits for the SPA to render), then the popup
  shows a line per lobby, e.g. `MOTD scan 0m ago — sc ✓ · evo ✓ new`. On `/owner`, the two MOTD
  rows go green and their age column now reads **time since last scrape**, not since last change
  (hover for both clocks).
- New feed items raise the toolbar badge + a notification.
