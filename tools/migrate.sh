#!/bin/sh
#
# Full WordPress → Astro migration pipeline.
#
#   1. scan    — read the dump, list the media that has to be optimised
#   2. media   — re-encode every referenced upload to WebP (responsive widths)
#   3. export  — write the content collections + manifests + redirect map
#   4. clean   — take the third-party advertising pitch out of the posts
#   5. build   — astro build (+ Cloudflare _redirects)
#   6. verify  — every local reference must resolve, copy must be clean
#
# Usage:  sh tools/migrate.sh
#
set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

echo "── 1/6  scan ────────────────────────────────────────────"
python3 tools/export_content.py --scan-only

echo
echo "── 2/6  media ───────────────────────────────────────────"
cd "$ROOT/site"
npm run media
cd "$ROOT"

echo
echo "── 3/6  export ──────────────────────────────────────────"
python3 tools/export_content.py

echo
echo "── 4/6  clean ───────────────────────────────────────────"
# The imported bodies carry an advertising pitch for a third-party agency.
# It runs here so a re-export can never quietly put it back.
python3 tools/strip_agency_pitch.py

echo
echo "── 5/6  build ───────────────────────────────────────────"
cd "$ROOT/site"
npm run build
cd "$ROOT"

echo
echo "── 6/6  verify ──────────────────────────────────────────"
python3 tools/strip_agency_pitch.py --report
python3 tools/check_refs.py
python3 tools/check_copy.py

echo
echo "migration pipeline finished."
