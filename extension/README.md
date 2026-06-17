# SC Feed Companion (browser extension)

Owner tool, Chrome + Firefox/Zen. Two jobs:

1. **RSI token sync** — reads the HttpOnly `Rsi-Token` cookie from robertsspaceindustries.com
   (where Sub is logged in as the Evocati account) and pushes it to SC Feed's owner endpoint,
   so the cron's `RSI_TOKEN` refreshes itself instead of the manual DevTools copy-paste.
   It only ever stores Sub's token — the endpoint is owner-gated and writes one locked PB row.
2. **Feed awareness** — polls `/api/sc-feed` every 5 min, shows the unread count on the toolbar
   badge, and fires a desktop notification when new items land (even with SC Feed closed). The
   popup shows the latest items, an **Open SC Feed** button, and a **Capture window** button
   (clean 1280×720 popup for stream window-capture).

## Files
- `manifest.json` — Chrome / Edge (MV3, `background.service_worker`)
- `manifest.firefox.json` — Firefox / Zen (MV3, `background.scripts` + gecko id)
- `background.js`, `popup.html`, `popup.js` — shared
- `build-firefox.sh` — assembles `dist-firefox/` (Firefox manifest as `manifest.json`) for signing

## Configure (popup → Settings)
- **SC Feed URL** — default `https://sc-feed.subliminal.gg`
- **Token push endpoint** — default `…/api/owner/rsi-token`
- **Push secret** — `OWNER_PUSH_SECRET` (from Bitwarden: `bw-lookup --raw "API - SCFeed Owner Push Secret"`)
- **Desktop notifications** — on/off

## Install — Chrome / Edge
`chrome://extensions` → Developer mode → **Load unpacked** → select this folder.

## Install — Firefox / Zen (permanent, signed)
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
Popup → **Push token now** → status reads `✓ token synced`. The owner backend at
`/owner` shows `{ set: true, updated_via: "extension" }`. New feed items raise the toolbar
badge + a notification.
