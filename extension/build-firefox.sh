#!/usr/bin/env bash
# Build a Firefox/Zen-ready copy of the extension. Same shared files, but the Firefox
# manifest is placed as manifest.json (web-ext and AMO load the file literally named
# manifest.json — the Chrome and Firefox manifests differ in the background key).
set -euo pipefail
cd "$(dirname "$0")"
OUT="dist-firefox"
rm -rf "$OUT" && mkdir -p "$OUT"
cp background.js content.js popup.html popup.js "$OUT"/
cp manifest.firefox.json "$OUT"/manifest.json
echo "Built ./$OUT"
echo "Sign it (unlisted) with:"
echo "  web-ext sign --source-dir=$OUT --channel=unlisted --api-key=<ISSUER> --api-secret=<SECRET>"
