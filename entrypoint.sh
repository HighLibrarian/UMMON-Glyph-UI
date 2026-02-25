#!/bin/sh
# ──────────────────────────────────────────────────────────────
# Ummon Glyph UI — Docker entrypoint
# Creates a non-root user with PUID/PGID, applies UMASK,
# then drops privileges via su-exec.
# ──────────────────────────────────────────────────────────────

PUID=${PUID:-1000}
PGID=${PGID:-1000}
UMASK=${UMASK:-022}

# Create group if it doesn't exist
if ! getent group ummon >/dev/null 2>&1; then
  addgroup -g "$PGID" ummon
else
  groupmod -g "$PGID" ummon 2>/dev/null || true
fi

# Create user if it doesn't exist
if ! getent passwd ummon >/dev/null 2>&1; then
  adduser -D -u "$PUID" -G ummon -h /app -s /bin/sh ummon
else
  usermod -u "$PUID" ummon 2>/dev/null || true
fi

# Set umask
umask "$UMASK"

# Ensure config directory exists and has correct ownership
mkdir -p /app/config
chown -R "$PUID:$PGID" /app/config

# Fix ownership of app directory
chown -R "$PUID:$PGID" /app

echo "  ◆ Running as UID=$PUID GID=$PGID UMASK=$UMASK"

# Drop to non-root user and exec the CMD
exec su-exec ummon "$@"
