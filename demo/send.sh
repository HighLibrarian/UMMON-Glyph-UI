#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Send a demo glyph payload to the Ummon Glyph UI server.
#
# Usage:
#   ./send.sh <payload.json>          # send one file
#   ./send.sh --all                   # send all, 3s apart
#   ./send.sh --clear                 # clear / reset to idle
#
# Defaults to http://localhost:3000. Override with UMMON_URL env var.
# ──────────────────────────────────────────────────────────────

URL="${UMMON_URL:-http://localhost:3000}"
DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$1" = "--clear" ]; then
  echo "→ Clearing glyph…"
  curl -s -X POST "$URL/clear" | cat
  echo ""
  exit 0
fi

if [ "$1" = "--all" ]; then
  DELAY="${2:-3}"
  for f in "$DIR"/*.json; do
    NAME=$(basename "$f")
    echo "→ Sending $NAME"
    curl -s -X POST "$URL/glyph" \
      -H "Content-Type: application/json" \
      -d @"$f" | cat
    echo ""
    sleep "$DELAY"
  done
  echo "✓ All payloads sent."
  exit 0
fi

if [ -z "$1" ]; then
  echo "Usage: $0 <payload.json> | --all | --clear"
  exit 1
fi

FILE="$1"
if [ ! -f "$FILE" ]; then
  FILE="$DIR/$1"
fi

echo "→ Sending $FILE"
curl -s -X POST "$URL/glyph" \
  -H "Content-Type: application/json" \
  -d @"$FILE" | cat
echo ""
