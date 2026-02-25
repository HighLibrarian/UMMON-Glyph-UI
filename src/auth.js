// ──────────────────────────────────────────────────────────────
// Ummon Glyph UI — authentication module
// Optional username/password for admin portal.
// Optional API key for external integrations (Node-RED, etc.).
// Credentials stored bcrypt-hashed in config/auth.json.
// Delete auth.json to reset credentials on next startup.
// ──────────────────────────────────────────────────────────────

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const SALT_ROUNDS = 10;
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const COOKIE_NAME = 'ummon_session';

// In-memory session store (simple — survives only while process runs)
const sessions = new Map();

let authEnabled  = false;
let apiKeyHash   = null;   // bcrypt hash of the API key (null = no API key required)
let authFile     = null;

/**
 * Initialise authentication.
 * @param {string} configDir — path to config directory
 * @returns {{ enabled: boolean }}
 */
async function init(configDir) {
  authFile = path.join(configDir, 'auth.json');

  const envUser   = process.env.UMMON_USERNAME;
  const envPass   = process.env.UMMON_PASSWORD;
  const envApiKey = process.env.UMMON_API_KEY;

  // Load existing auth.json if present
  let stored = null;
  if (fs.existsSync(authFile)) {
    try { stored = JSON.parse(fs.readFileSync(authFile, 'utf8')); } catch { stored = {}; }
  }

  // ── Admin credentials ────────────────────────────────────
  if (stored && stored.passwordHash) {
    authEnabled = true;
    // Update if env vars differ
    if (envUser && envPass && stored.username !== envUser) {
      await saveCredentials(envUser, envPass, stored);
    }
    console.log('  ◆ Admin auth enabled (credentials in auth.json)');
  } else if (envUser && envPass) {
    await saveCredentials(envUser, envPass, stored || {});
    authEnabled = true;
    console.log('  ◆ Admin auth enabled (created from environment variables)');
  } else {
    authEnabled = false;
    console.log('  ◆ Admin auth disabled (no credentials configured)');
  }

  // ── API key ──────────────────────────────────────────────
  // Re-read stored (saveCredentials may have written it)
  if (fs.existsSync(authFile)) {
    try { stored = JSON.parse(fs.readFileSync(authFile, 'utf8')); } catch { stored = {}; }
  }

  if (envApiKey) {
    // Always overwrite API key hash when env var is set
    if (!stored) stored = {};
    stored.apiKeyHash = await bcrypt.hash(envApiKey, SALT_ROUNDS);
    fs.writeFileSync(authFile, JSON.stringify(stored, null, 2) + '\n', 'utf8');
    apiKeyHash = stored.apiKeyHash;
    console.log('  ◆ API key enabled (from environment variable)');
  } else if (stored && stored.apiKeyHash) {
    apiKeyHash = stored.apiKeyHash;
    console.log('  ◆ API key enabled (from auth.json)');
  } else {
    apiKeyHash = null;
    console.log('  ◆ API key disabled (no key configured)');
  }

  return { authEnabled, apiKeyEnabled: !!apiKeyHash };
}

async function saveCredentials(username, password, existing) {
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const data = { ...(existing || {}), username, passwordHash: hash };
  fs.writeFileSync(authFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Validate username + password against stored credentials.
 * @returns {string|null} session token on success, null on failure
 */
async function login(username, password) {
  if (!authEnabled || !authFile) return null;

  try {
    const stored = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    if (username !== stored.username) return null;

    const match = await bcrypt.compare(password, stored.passwordHash);
    if (!match) return null;

    // Create session
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { username, createdAt: Date.now() });
    return token;
  } catch (err) {
    console.error('Auth login error:', err);
    return null;
  }
}

/**
 * Check if a session token is valid.
 */
function isValidSession(token) {
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/**
 * Destroy a session.
 */
function logout(token) {
  sessions.delete(token);
}

/**
 * Parse the session cookie from a request.
 */
function getSessionToken(req) {
  const cookies = req.headers.cookie;
  if (!cookies) return null;
  const match = cookies.split(';').find(c => c.trim().startsWith(COOKIE_NAME + '='));
  if (!match) return null;
  return match.split('=')[1].trim();
}

/**
 * Express middleware — protects admin routes when auth is enabled.
 * Public routes (display, glyph API, SSE, PNG) are NOT protected.
 */
function requireAuth(req, res, next) {
  if (!authEnabled) return next();

  const token = getSessionToken(req);
  if (isValidSession(token)) return next();

  // If it's an API call, return 401 JSON
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Otherwise redirect to login page
  res.redirect('/login');
}

function isEnabled() {
  return authEnabled;
}

/**
 * Extract API key from request headers.
 * Accepts: Authorization: Bearer <key> or X-API-Key: <key>
 */
function getApiKey(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return req.headers['x-api-key'] || null;
}

/**
 * Express middleware — protects ingestion routes (POST /glyph, POST /clear)
 * when an API key is configured.  Accepts the key via:
 *   Authorization: Bearer <key>
 *   X-API-Key: <key>
 *
 * Also allows requests from authenticated admin sessions (browser UI)
 * so the admin page can send glyphs without needing the API key.
 */
async function requireApiKey(req, res, next) {
  if (!apiKeyHash) return next(); // no key configured — open access

  // Allow authenticated admin sessions (covers browser-based admin UI)
  if (!authEnabled) return next(); // no admin auth — open admin access
  const token = getSessionToken(req);
  if (isValidSession(token)) return next();

  const key = getApiKey(req);
  if (!key) {
    return res.status(401).json({ error: 'API key required. Send via Authorization: Bearer <key> or X-API-Key header.' });
  }

  const match = await bcrypt.compare(key, apiKeyHash);
  if (!match) {
    return res.status(403).json({ error: 'Invalid API key' });
  }
  next();
}

function isApiKeyEnabled() {
  return !!apiKeyHash;
}

module.exports = {
  init,
  login,
  logout,
  requireAuth,
  requireApiKey,
  isValidSession,
  getSessionToken,
  isEnabled,
  isApiKeyEnabled,
  COOKIE_NAME,
};
