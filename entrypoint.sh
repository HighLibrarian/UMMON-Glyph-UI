#!/bin/sh
# ──────────────────────────────────────────────────────────────
# Ummon Glyph UI — Docker entrypoint
# Creates a non-root user with PUID/PGID, applies UMASK,
# then drops privileges via su-exec.
# ──────────────────────────────────────────────────────────────

PUID=${PUID:-1000}
PGID=${PGID:-1000}
UMASK=${UMASK:-022}

# Resolve or create the group for PGID
# (GID may already be in use by a system group, e.g. GID 100 = 'users' on Alpine)
EXISTING_GROUP=$(getent group "$PGID" | cut -d: -f1)
if [ -z "$EXISTING_GROUP" ]; then
  addgroup -g "$PGID" ummon
  EXISTING_GROUP=ummon
fi

# Create user 'ummon' if it doesn't exist, assigned to whichever group owns PGID
if ! getent passwd ummon >/dev/null 2>&1; then
  adduser -D -u "$PUID" -G "$EXISTING_GROUP" -h /app -s /bin/sh ummon
else
  usermod -u "$PUID" -g "$EXISTING_GROUP" ummon 2>/dev/null || true
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
