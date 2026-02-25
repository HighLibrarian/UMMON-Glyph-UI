# ──────────────────────────────────────────────────────────────
# Ummon Glyph UI — Docker image
# Multi-stage build · Node.js 20 Alpine · Unraid-compatible
# Supports PUID / PGID / UMASK for proper file ownership
# ──────────────────────────────────────────────────────────────

FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy application code
COPY src/ ./src/
COPY public/ ./public/
COPY config/ ./config-defaults/

# ──────────────────────────────────────────────────────────────

FROM node:20-alpine

LABEL maintainer="HighLibrarian"
LABEL org.opencontainers.image.title="Ummon Glyph UI"
LABEL org.opencontainers.image.description="Deterministic visual glyph system for Home Assistant"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/HighLibrarian/UMMON-Glyph-ui"

# shadow for usermod/groupmod, su-exec for stepping down to non-root
RUN apk add --no-cache shadow su-exec

WORKDIR /app

# Copy built app from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/public ./public
COPY --from=build /app/config-defaults ./config-defaults

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Config volume — persists credentials, style, definitions
VOLUME /app/config

# ── Environment variables ─────────────────────────────────────
# PUID             — Run as this user ID  (default: 1000)
# PGID             — Run as this group ID (default: 1000)
# UMASK            — File creation mask   (default: 022)
# PORT             — Server port (default: 3000)
# UMMON_USERNAME   — Admin username (optional — omit to disable auth)
# UMMON_PASSWORD   — Admin password (optional — omit to disable auth)
# UMMON_API_KEY    — API key for glyph ingestion (optional)
# UMMON_CONFIG_DIR — Config directory (default: /app/config)
# UMMON_STYLE_SEED — Initial style seed (optional)
ENV PUID=1000
ENV PGID=1000
ENV UMASK=022
ENV PORT=3000
ENV UMMON_CONFIG_DIR=/app/config

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/api/state || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "src/server.js"]
