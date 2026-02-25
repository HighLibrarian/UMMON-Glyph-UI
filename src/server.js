// ──────────────────────────────────────────────────────────────
// Ummon Glyph UI — Express server
// ──────────────────────────────────────────────────────────────


const express = require('express');
const path    = require('path');
const fs      = require('fs');
const config  = require('./config.js');
const state   = require('./state-manager.js');
const auth    = require('./auth.js');
const GlyphEngine = require('../public/js/glyph-engine.js');
const ha = require('./ha-integration.js');
const { renderPng, renderJpeg } = require('./png-renderer.js');

const app = express();

// ── Middleware (must be before routes) ─────────────────────────
app.use(express.json());

// ── Home Assistant Integration API ────────────────────────────
// GET /api/ha/config — load saved HA config (masked token)
app.get('/api/ha/config', auth.requireAuth, (_req, res) => {
  res.json(ha.getConfig());
});

// POST /api/ha/config — save HA connection config
app.post('/api/ha/config', auth.requireAuth, (req, res) => {
  const { host, token, labelName } = req.body || {};
  if (!host || !token) return res.status(400).json({ error: 'Host and token required' });
  ha.setConfig({ host, token, labelName });
  res.json({ ok: true });
});

// Step-by-step connection test
app.post('/api/ha/test', async (req, res) => {
  const { host, token } = req.body || {};
  try {
    const result = await ha.testConnection(host, token);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, steps: [
      { step: 'internal error', status: 'failed', error: err.message || 'Unknown error' }
    ] });
  }
});

// GET /api/ha/entities — fetch labeled entities (with overrides merged)
app.get('/api/ha/entities', auth.requireAuth, async (_req, res) => {
  try {
    const result = await ha.fetchLabeledEntities();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Unknown error', entities: [] });
  }
});

// GET /api/ha/all-entities — fetch all HA entities (for add-entity picker)
app.get('/api/ha/all-entities', auth.requireAuth, async (_req, res) => {
  try {
    const result = await ha.fetchAllEntities();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || 'Unknown error', entities: [] });
  }
});

// POST /api/ha/entity — save entity override
app.post('/api/ha/entity', auth.requireAuth, (req, res) => {
  const { entity_id, ...override } = req.body || {};
  if (!entity_id) return res.status(400).json({ error: 'entity_id required' });
  ha.saveEntityOverride(entity_id, override);
  res.json({ ok: true });
});

// DELETE /api/ha/entity/:id — delete entity override
app.delete('/api/ha/entity/:id', auth.requireAuth, (req, res) => {
  const entityId = req.params.id;
  if (!entityId) return res.status(400).json({ error: 'entity_id required' });
  ha.deleteEntityOverride(entityId);
  res.json({ ok: true });
});

// GET /api/ha/status — WebSocket connection status
app.get('/api/ha/status', auth.requireAuth, (_req, res) => {
  res.json({ status: ha.getConnectionStatus(), labelName: ha.getLabelName() });
});

// POST /api/ha/label — update label name
app.post('/api/ha/label', auth.requireAuth, (req, res) => {
  const { labelName } = req.body || {};
  if (!labelName) return res.status(400).json({ error: 'labelName required' });
  ha.setLabelName(labelName);
  res.json({ ok: true, labelName });
});

const CONFIG_DIR = process.env.UMMON_CONFIG_DIR
  ? path.resolve(process.env.UMMON_CONFIG_DIR)
  : path.join(__dirname, '..', 'config');

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// ── Copy default config files if missing ─────────────────────
// Docker copies config/ → config-defaults/; locally they're in config/
const configDefaultsPath = path.join(__dirname, '..', 'config-defaults');
const DEFAULT_CONFIG_DIR = fs.existsSync(configDefaultsPath)
  ? configDefaultsPath
  : path.join(__dirname, '..', 'config');
for (const file of ['domains.json', 'intents.json', 'quick-actions.json', 'style.json', 'moods.json']) {
  const target = path.join(CONFIG_DIR, file);
  const source = path.join(DEFAULT_CONFIG_DIR, file);
  if (!fs.existsSync(target) && fs.existsSync(source)) {
    fs.copyFileSync(source, target);
  }
}

// ── Apply env-var style seed if set and no seed configured ───
if (process.env.UMMON_STYLE_SEED) {
  const stylePath = path.join(CONFIG_DIR, 'style.json');
  try {
    const current = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
    if (!current.styleSeed) {
      current.styleSeed = process.env.UMMON_STYLE_SEED;
      fs.writeFileSync(stylePath, JSON.stringify(current, null, 2) + '\n', 'utf8');
    }
  } catch {
    fs.writeFileSync(stylePath, JSON.stringify({ styleSeed: process.env.UMMON_STYLE_SEED }, null, 2) + '\n', 'utf8');
  }
}

// ── Static files (block protected pages from being served directly) ───
const PROTECTED_PAGES = ['/admin.html', '/ha-admin.html'];
app.use((req, res, next) => {
  if (PROTECTED_PAGES.includes(req.path)) {
    // Don't serve these via static — let the auth-protected routes below handle them
    return next();
  }
  express.static(path.join(__dirname, '..', 'public'))(req, res, next);
});

// ── Auth routes (always available, behave based on auth state) ─
app.get('/login', (_req, res) => {
  if (!auth.isEnabled()) return res.redirect('/admin');
  // If already authenticated, skip login
  const token = auth.getSessionToken(_req);
  if (auth.isValidSession(token)) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});

app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const token = await auth.login(username, password);
  if (!token) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
  res.json({ ok: true });
});

app.post('/auth/logout', (req, res) => {
  const token = auth.getSessionToken(req);
  if (token) auth.logout(token);
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/auth/status', (_req, res) => {
  res.json({ authEnabled: auth.isEnabled(), apiKeyEnabled: auth.isApiKeyEnabled() });
});

// ── Protected admin routes ───────────────────────────────────
app.get('/admin', auth.requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

app.get('/admin.html', auth.requireAuth, (_req, res) => {
  res.redirect('/admin');
});

app.get('/ha-admin', auth.requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'ha-admin.html'));
});

app.get('/ha-admin.html', auth.requireAuth, (_req, res) => {
  res.redirect('/ha-admin');
});

// ── POST /glyph — set active glyph ──────────────────────────
app.post('/glyph', auth.requireApiKey, async (req, res) => {
  try {
    const metadata = req.body;
    if (!metadata || typeof metadata !== 'object') {
      return res.status(400).json({ error: 'Body must be a JSON object' });
    }
    const result = await state.setGlyph(metadata);
    if (!result.accepted) {
      return res.status(409).json({ error: result.reason });
    }
    const resp = {
      ok: true,
      priority: result.priority,
      expiresAt: result.expiresAt,
      seed: result.glyphData?.seed,
    };
    if (result.glyphData?.isError) {
      resp.warning = result.glyphData.errorMessage;
    }
    res.json(resp);
  } catch (err) {
    console.error('POST /glyph error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /clear — clear current glyph ───────────────────────
app.post('/clear', auth.requireApiKey, async (_req, res) => {
  try {
    await state.clearGlyph();
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /clear error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /glyph.png — latest rendered PNG ────────────────────
app.get('/glyph.png', (_req, res) => {
  const buf = state.getPng();
  if (!buf) return res.status(503).send('Not ready');
  res.set({
    'Content-Type': 'image/png',
    'Cache-Control': 'no-store',
  });
  res.send(buf);
});

// ── GET /glyph.mjpeg — MJPEG video stream ───────────────────
// Query params:  ?fps=2&quality=80&size=256
// Suitable for HA Generic Camera, OBS browser source, <img> tags, etc.
app.get('/glyph.mjpeg', (req, res) => {
  const fps     = Math.max(1, Math.min(30, parseInt(req.query.fps)     || 2));
  const quality = Math.max(1, Math.min(100, parseInt(req.query.quality) || 80));
  const sizeRaw = parseInt(req.query.size) || 0;
  const size    = [128, 256, 512, 1024].includes(sizeRaw) ? sizeRaw : null;

  const boundary = state.getMjpegBoundary();

  res.set({
    'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
    'Cache-Control': 'no-store, no-cache, must-revalidate, pre-check=0, post-check=0, max-age=0',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  state.addMjpegClient(res, size, quality, fps);
});

// ── GET /events — SSE stream ────────────────────────────────
app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Send current state immediately
  const cur = state.currentState();
  res.write(`event: glyph\ndata: ${JSON.stringify(cur)}\n\n`);

  state.sseClients.add(res);
  req.on('close', () => state.sseClients.delete(res));
});

// ── GET /api/state — current state ──────────────────────────
app.get('/api/state', (_req, res) => {
  res.json(state.currentState());
});

// ── GET /api/message — current display message (for Node-RED) ─
app.get('/api/message', (_req, res) => {
  const s = state.currentState();
  const m = s.metadata || {};
  const isIdle = m.domain === 'system' && m.status === 'idle';

  if (isIdle && m.moodName) {
    // Idle with mood
    return res.json({
      state: 'idle',
      message: 'IDLE // ' + m.moodName,
      mood: m.moodName,
    });
  }
  if (isIdle) {
    // Initial idle — no mood yet
    return res.json({
      state: 'idle',
      message: 'IDLE',
    });
  }

  // Active glyph
  const parts = [m.intent, m.device, m.status].filter(Boolean);
  return res.json({
    state: 'active',
    message: parts.join(' / '),
    domain: m.domain,
    device: m.device || null,
    status: m.status,
    intent: m.intent,
    urgency: m.urgency || 0,
  });
});

// ── GET /api/config — read config ───────────────────────────
app.get('/api/config', auth.requireAuth, (_req, res) => {
  res.json(state.getConfig());
});

// ── POST /api/config — update config ────────────────────────
app.post('/api/config', auth.requireAuth, (req, res) => {
  try {
    const updated = state.updateConfig(req.body);
    res.json({ ok: true, config: updated });
  } catch (err) {
    console.error('POST /api/config error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/history — recent event history ─────────────────
app.get('/api/history', auth.requireAuth, (_req, res) => {
  res.json(state.getHistory());
});

// ── GET /api/definitions — domains, intents, quick actions ──
app.get('/api/definitions', auth.requireAuth, (_req, res) => {
  try {
    const domains      = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'domains.json'), 'utf8'));
    const intents      = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'intents.json'), 'utf8'));
    const quickActions = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'quick-actions.json'), 'utf8'));
    res.json({ ...domains, ...intents, ...quickActions });
  } catch (err) {
    console.error('GET /api/definitions error:', err);
    res.status(500).json({ error: 'Failed to load definition files' });
  }
});

// ── GET /api/style — current style seed ─────────────────────
app.get('/api/style', auth.requireAuth, (_req, res) => {
  try {
    const stylePath = path.join(CONFIG_DIR, 'style.json');
    const style = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
    res.json(style);
  } catch (err) {
    res.json({ styleSeed: '' });
  }
});

// ── POST /api/style — save style seed ───────────────────────
app.post('/api/style', auth.requireAuth, async (req, res) => {
  try {
    const stylePath = path.join(CONFIG_DIR, 'style.json');
    const { styleSeed, pngResolution, gridSize } = req.body;
    const style = { styleSeed: styleSeed || '' };
    if (pngResolution && [128, 256, 512, 1024].includes(Number(pngResolution))) {
      style.pngResolution = Number(pngResolution);
    }
    if (gridSize && [8, 16, 32].includes(Number(gridSize))) {
      style.gridSize = Number(gridSize);
    } else {
      style.gridSize = 8;
    }
    fs.writeFileSync(stylePath, JSON.stringify(style, null, 2) + '\n', 'utf8');
    // Update the server-side theme (for PNG rendering + layout transforms)
    const theme = styleSeed ? GlyphEngine.deriveTheme(styleSeed) : null;
    await state.setStyleTheme(theme);
    // Update PNG resolution
    await state.setPngResolution(style.pngResolution || null);
    // Update grid size
    await state.setGridSize(style.gridSize || null);
    // Broadcast style change to all SSE clients
    state.broadcast('style', style);
    res.json({ ok: true, ...style });
  } catch (err) {
    console.error('POST /api/style error:', err);
    res.status(500).json({ error: 'Failed to save style' });
  }
});

// ── Start ────────────────────────────────────────────────────
(async () => {
  await auth.init(CONFIG_DIR);
  await state.init(renderPng, renderJpeg, CONFIG_DIR);

  // Initialize Home Assistant integration with glyph trigger callback
  ha.init(CONFIG_DIR, async (glyphPayload) => {
    try {
      await state.setGlyph(glyphPayload);
    } catch (err) {
      console.error('  ◆ HA glyph trigger error:', err.message);
    }
  });

  // Load initial style seed and apply theme
  try {
    const stylePath = path.join(CONFIG_DIR, 'style.json');
    if (fs.existsSync(stylePath)) {
      const styleData = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
      if (styleData.styleSeed) {
        const theme = GlyphEngine.deriveTheme(styleData.styleSeed);
        await state.setStyleTheme(theme);
        console.log(`  ◆ Style seed loaded: "${styleData.styleSeed}"`);
      }
      if (styleData.pngResolution) {
        await state.setPngResolution(styleData.pngResolution);
        console.log(`  ◆ PNG resolution: ${styleData.pngResolution}×${styleData.pngResolution}`);
      }
      if (styleData.gridSize && [8, 16, 32].includes(Number(styleData.gridSize))) {
        await state.setGridSize(Number(styleData.gridSize));
        console.log(`  ◆ Grid size: ${styleData.gridSize}×${styleData.gridSize}`);
      }
    }
  } catch (err) {
    console.error('  ◆ Failed to load style seed:', err.message);
  }

  app.listen(config.port, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║   Ummon Glyph UI — v2.0.0                ║`);
    console.log(`  ╠══════════════════════════════════════════╣`);
    console.log(`  ║   Display : http://localhost:${config.port}          ║`);
    console.log(`  ║   Admin   : http://localhost:${config.port}/admin     ║`);
    console.log(`  ║   PNG     : http://localhost:${config.port}/glyph.png ║`);
    console.log(`  ║   MJPEG   : http://localhost:${config.port}/glyph.mjpeg ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  });
})();
