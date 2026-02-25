// Ummon Glyph UI — configuration

const config = {
  port: process.env.PORT || 3000,

  grid: {
    size: 8,
    pngSize: 256,
    cellGap: 2,
  },

  // Priority: higher number = higher priority.
  // Pattern: "domain/status/intent" — use * as wildcard.
  priorities: {
    'system/idle/idle': 0,
    'system/*/idle': 1,
    'appliance/*/notification': 10,
    'climate/*/notification': 10,
    'media/*/notification': 10,
    'security/*/notification': 20,
    'voice/listening/voice': 30,
    'voice/responding/voice': 30,
    'system/error/*': 40,
    '*': 5,
  },

  idle: {
    enabled: true,
    minIntervalSec: 60,
    maxIntervalSec: 300,
    displayDurationSec: 5,
    moods: 8,             // number of distinct idle mood patterns (1–32)
    idleVariations: 0,    // number of idle base variations (0 = off, static idle)
  },

  defaults: {
    ttl: 30,
  },
};

module.exports = config;
