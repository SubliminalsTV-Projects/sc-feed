# SC Feed — RSI Token Sync (browser extension)

Owner tool. Reads the `Rsi-Token` session cookie from robertsspaceindustries.com (where Sub
is logged in with the Evocati account) and pushes it to SC Feed's owner endpoint, so the
cron's `RSI_TOKEN` refreshes itself instead of the manual DevTools copy-paste.

**It only ever stores Sub's token.** The endpoint (`/api/owner/rsi-token`) is owner-gated and
writes a single locked PocketBase row; a non-owner can't push, and no per-user RSI cookies
are ever collected.

## Files
- `manifest.json` — Chrome / Edge (MV3, `background.service_worker`)
- `manifest.firefox.json` — Firefox / Zen (MV3, `background.scripts` + gecko id)
- `background.js`, `popup.html`, `popup.js` — shared, browser-agnostic

## Configure (popup)
- **Endpoint**: defaults to `https://sc-feed.subliminal.gg/api/owner/rsi-token`
- **Push secret**: paste `OWNER_PUSH_SECRET` (the headless fallback). Leave blank if you're
  signed into SC Feed as owner in the same browser — the push rides your session cookie.

## Install — Chrome / Edge
1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.

## Install — Firefox / Zen
Firefox requires signing for a *permanent* install.
- **Quick test (temporary):** `about:debugging` → This Firefox → **Load Temporary Add-on**
  → pick `manifest.firefox.json`. Rename it to `manifest.json` first (Firefox loads the file
  named `manifest.json`), or copy this folder and swap the manifest. Resets on restart.
- **Permanent:** sign as an **unlisted** add-on on addons.mozilla.org (free), then install
  the signed `.xpi`. Use `manifest.firefox.json` as the manifest in the packaged zip.

> One folder, two manifests: when packaging, use the right manifest as `manifest.json`.
> (A tiny `build.sh` could automate this later; kept manual for now.)

## Verify
Open the popup → **Push now**. Status should read `✓ token synced`. Then the SC Feed owner
endpoint `GET /api/owner/rsi-token` will report `{ set: true, updated_via: "extension" }`.
