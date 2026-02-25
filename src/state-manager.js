// ──────────────────────────────────────────────────────────────
// Ummon Glyph UI — state manager
// Manages the active glyph, TTL timers, priorities, idle loop,
// SSE broadcasting, and history.
// ──────────────────────────────────────────────────────────────

const fs           = require('fs');
const path         = require('path');
const GlyphEngine  = require('../public/js/glyph-engine.js');
const config       = require('./config.js');

// ── Mood names (loaded from config dir during init) ──────────
let moodNames = [];
let idleMoodIndex = 0;   // cycles through moods sequentially

// ── SSE clients ──────────────────────────────────────────────
const sseClients = new Set();

// ── MJPEG clients ────────────────────────────────────────────
const mjpegClients = new Set();   // { res, size, quality }
let mjpegInterval  = null;
let mjpegFps       = 2;           // default frames per second
let renderJpeg     = null;        // injected by server
const ANIM_CYCLE_MS = 2083;       // ~2.08s animation cycle (matches client: 0.008 * 60fps ≈ 0.48/s)

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

// ── Priority resolution ──────────────────────────────────────
function resolvePriority(metadata) {
  const { domain, status, intent } = metadata;
  const patterns = [
    `${domain}/${status}/${intent}`,
    `${domain}/*/${intent}`,
    `${domain}/${status}/*`,
    `${domain}/*/*`,
    '*',
  ];
  for (const p of patterns) {
    if (config.priorities[p] !== undefined) return config.priorities[p];
  }
  return config.priorities['*'] ?? 5;
}

// ── State ────────────────────────────────────────────────────
const IDLE_META = { domain: 'system', status: 'idle', intent: 'idle', urgency: 0 };

let idleVariation = 0;     // variation counter for idle base glyph

function getIdleMeta() {
  const maxVariations = config.idle.idleVariations || 0;
  if (maxVariations > 0) {
    return { ...IDLE_META, _idleVariation: (idleVariation % maxVariations) + 1 };
  }
  return IDLE_META;
}

let activeGlyph  = null;   // { glyphData, metadata, priority, expiresAt }
let ttlTimer     = null;
let idleTimer    = null;
let pngBuffer    = null;   // pre-rendered PNG of the current glyph
let renderPng    = null;   // will be injected by server
let currentTheme = null;   // derived theme from style seed
let pngResolution = null;  // custom PNG resolution (null = use config default)
let currentGridSize = null; // custom grid size (null = use config default)

const history = [];         // last N events
const MAX_HISTORY = 50;

function pushHistory(entry) {
  history.unshift({ ...entry, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) history.pop();
}

function getHistory() {
  return history;
}

function currentState() {
  if (activeGlyph) {
    return {
      glyphData: activeGlyph.glyphData,
      metadata:  activeGlyph.metadata,
      priority:  activeGlyph.priority,
      expiresAt: activeGlyph.expiresAt,
    };
  }
  // Idle glyph (pass theme for layout transforms + grid size)
  const gs = currentGridSize || undefined;
  const idleMeta = getIdleMeta();
  const glyphData = GlyphEngine.generateGlyph(idleMeta, currentTheme, gs);
  return { glyphData, metadata: idleMeta, priority: 0, expiresAt: null };
}

async function updatePng() {
  if (!renderPng) return;
  const state = currentState();
  pngBuffer = await renderPng(state.glyphData, pngResolution || undefined, currentTheme);
}

function getPng() {
  return pngBuffer;
}

// ── Set glyph ────────────────────────────────────────────────
async function setGlyph(metadata) {
  const priority = resolvePriority(metadata);
  const gs = currentGridSize || undefined;
  const glyphData = GlyphEngine.generateGlyph(metadata, currentTheme, gs);

  // If a higher-priority glyph is active, reject (unless this is equal or higher)
  if (activeGlyph && priority < activeGlyph.priority) {
    return { accepted: false, reason: 'lower priority than current glyph' };
  }

  // Clear existing TTL timer
  if (ttlTimer) { clearTimeout(ttlTimer); ttlTimer = null; }

  const ttlSec = metadata.ttl || config.defaults.ttl || 30;
  const ttlMs  = ttlSec * 1000;
  const expiresAt = Date.now() + ttlMs;

  activeGlyph = { glyphData, metadata, priority, expiresAt };

  // Set TTL timer
  ttlTimer = setTimeout(() => expireGlyph(), ttlMs);

  // Stop idle timer while a real glyph is showing
  stopIdleTimer();

  await updatePng();
  pushHistory({ action: 'set', metadata, priority });
  broadcast('glyph', { glyphData, metadata, priority, expiresAt });

  return { accepted: true, glyphData, priority, expiresAt };
}

// ── Clear / expire ───────────────────────────────────────────
async function clearGlyph() {
  if (ttlTimer) { clearTimeout(ttlTimer); ttlTimer = null; }
  activeGlyph = null;

  // Advance idle variation counter
  idleVariation++;
  const idleMeta = getIdleMeta();

  // Generate the idle glyph server-side so all clients receive the same data
  const gs = currentGridSize || undefined;
  const idleGlyph = GlyphEngine.generateGlyph(idleMeta, currentTheme, gs);
  await updatePng();
  pushHistory({ action: 'clear' });
  broadcast('clear', { metadata: idleMeta, glyphData: idleGlyph });
  startIdleTimer();
}

async function expireGlyph() {
  ttlTimer = null;
  activeGlyph = null;

  // Advance idle variation counter
  idleVariation++;
  const idleMeta = getIdleMeta();

  // Generate the idle glyph server-side so all clients receive the same data
  const gs = currentGridSize || undefined;
  const idleGlyph = GlyphEngine.generateGlyph(idleMeta, currentTheme, gs);
  await updatePng();
  pushHistory({ action: 'expire' });
  broadcast('clear', { metadata: idleMeta, glyphData: idleGlyph });
  startIdleTimer();
}

// ── Idle loop ────────────────────────────────────────────────
function randomIdleDelay() {
  const minMs = (config.idle.minIntervalSec || 60) * 1000;
  const maxMs = (config.idle.maxIntervalSec || 300) * 1000;
  return minMs + Math.random() * (maxMs - minMs);
}

function startIdleTimer() {
  if (!config.idle.enabled) return;
  stopIdleTimer();
  idleTimer = setTimeout(async () => {
    if (activeGlyph) return; // something else took over
    const totalMoods = config.idle.moods || 8;
    const moodIdx = idleMoodIndex % totalMoods;
    idleMoodIndex = (idleMoodIndex + 1) % totalMoods;
    const moodName = moodNames.length > 0
      ? moodNames[moodIdx % moodNames.length]
      : null;
    const meta = {
      domain: 'system',
      status: 'idle',
      intent: 'idle',
      urgency: 0,
      mood: moodIdx,
      moodCount: totalMoods,
      moodName: moodName,
      ttl: config.idle.displayDurationSec || 5,
    };
    await setGlyph(meta);
  }, randomIdleDelay());
}

function stopIdleTimer() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

// ── Config API ───────────────────────────────────────────────
function getConfig() {
  return {
    priorities: { ...config.priorities },
    idle: { ...config.idle },
    defaults: { ...config.defaults },
  };
}

function updateConfig(patch) {
  if (patch.priorities) Object.assign(config.priorities, patch.priorities);
  if (patch.idle)       Object.assign(config.idle, patch.idle);
  if (patch.defaults)   Object.assign(config.defaults, patch.defaults);
  broadcast('config', getConfig());
  return getConfig();
}

// ── Initialise ───────────────────────────────────────────────
async function init(pngRenderer, jpegRenderer, configDir) {
  renderPng  = pngRenderer;
  renderJpeg = jpegRenderer || null;

  // Load mood names from the active config directory
  if (configDir) {
    try {
      const moodsPath = path.join(configDir, 'moods.json');
      moodNames = JSON.parse(fs.readFileSync(moodsPath, 'utf8'));
      console.log(`  ◆ Loaded ${moodNames.length} mood names`);
    } catch (e) {
      console.warn('  ◆ Could not load moods.json:', e.message);
    }
  }

  await updatePng();
  startIdleTimer();
}

// ── MJPEG streaming ──────────────────────────────────────────
const MJPEG_BOUNDARY = 'ummonframe';

function addMjpegClient(res, size, quality, fps) {
  const clientFps = Math.max(1, Math.min(30, fps || 2));
  const client = { res, size, quality, fps: clientFps, intervalMs: Math.round(1000 / clientFps), lastFrame: 0 };
  mjpegClients.add(client);

  // Send initial frame immediately
  pushMjpegFrame(client).catch(() => {});

  // Recalculate loop speed and (re)start
  recalcMjpegLoop();

  res.on('close', () => {
    mjpegClients.delete(client);
    if (mjpegClients.size === 0) stopMjpegLoop();
    else recalcMjpegLoop();
  });
}

async function pushMjpegFrame(client) {
  if (!renderJpeg) return;
  try {
    const st = currentState();
    // Compute animation phase for smooth MJPEG animations
    const animation = st.glyphData && st.glyphData.animation;
    const animPhase = (animation && animation !== 'none')
      ? (Date.now() % ANIM_CYCLE_MS) / ANIM_CYCLE_MS
      : undefined;
    const jpegBuf = await renderJpeg(
      st.glyphData,
      client.size || pngResolution || undefined,
      currentTheme,
      client.quality || 80,
      animPhase
    );
    if (!client.res.writable) return;
    client.res.write(`--${MJPEG_BOUNDARY}\r\n`);
    client.res.write(`Content-Type: image/jpeg\r\n`);
    client.res.write(`Content-Length: ${jpegBuf.length}\r\n`);
    client.res.write(`\r\n`);
    client.res.write(jpegBuf);
    client.res.write(`\r\n`);
  } catch (err) {
    // Client likely disconnected — remove them
    mjpegClients.delete(client);
  }
}

async function pushMjpegAllClients() {
  const now = Date.now();
  for (const client of mjpegClients) {
    if (now - client.lastFrame >= client.intervalMs) {
      client.lastFrame = now;
      pushMjpegFrame(client).catch(() => {});
    }
  }
}

function recalcMjpegLoop() {
  // Run the shared loop at the fastest client's FPS
  let maxFps = 2;
  for (const c of mjpegClients) {
    if (c.fps > maxFps) maxFps = c.fps;
  }
  mjpegFps = maxFps;
  startMjpegLoop();
}

function startMjpegLoop() {
  stopMjpegLoop();
  const intervalMs = Math.max(33, Math.round(1000 / mjpegFps));
  mjpegInterval = setInterval(() => {
    pushMjpegAllClients();
  }, intervalMs);
}

function stopMjpegLoop() {
  if (mjpegInterval) {
    clearInterval(mjpegInterval);
    mjpegInterval = null;
  }
}

function getMjpegBoundary() { return MJPEG_BOUNDARY; }
function getMjpegClientCount() { return mjpegClients.size; }

/**
 * Update the active theme and re-render the PNG.
 * Re-generates the active glyph grid with the new layout transforms.
 * Called by the server when the style seed changes.
 */
async function setStyleTheme(theme) {
  currentTheme = theme || null;
  const gs = currentGridSize || undefined;
  // Re-generate the active (or idle) glyph with new layout transforms
  if (activeGlyph && activeGlyph.metadata) {
    activeGlyph.glyphData = GlyphEngine.generateGlyph(activeGlyph.metadata, currentTheme, gs);
    broadcast('glyph', {
      glyphData: activeGlyph.glyphData,
      metadata:  activeGlyph.metadata,
      priority:  activeGlyph.priority,
      expiresAt: activeGlyph.expiresAt,
    });
  } else {
    // Idle: broadcast the re-generated idle glyph so clients update layout
    const idleMeta = getIdleMeta();
    const idleGlyph = GlyphEngine.generateGlyph(idleMeta, currentTheme, gs);
    broadcast('glyph', {
      glyphData: idleGlyph,
      metadata:  idleMeta,
      priority:  0,
      expiresAt: null,
    });
  }
  await updatePng();
}

/**
 * Update the PNG resolution. Null = use config default.
 */
async function setPngResolution(size) {
  pngResolution = size || null;
  await updatePng();
}

/**
 * Update the grid size. Null = use config default.
 * Re-generates the active glyph and broadcasts to all clients.
 */
async function setGridSize(size) {
  const valid = [8, 16];
  currentGridSize = (size && valid.includes(Number(size))) ? Number(size) : null;
  // Also update the engine's default grid size
  if (currentGridSize) GlyphEngine.setGridSize(currentGridSize);
  else GlyphEngine.setGridSize(8);
  // Re-generate active or idle glyph with new grid size
  const gs = currentGridSize || undefined;
  if (activeGlyph && activeGlyph.metadata) {
    activeGlyph.glyphData = GlyphEngine.generateGlyph(activeGlyph.metadata, currentTheme, gs);
    broadcast('glyph', {
      glyphData: activeGlyph.glyphData,
      metadata:  activeGlyph.metadata,
      priority:  activeGlyph.priority,
      expiresAt: activeGlyph.expiresAt,
    });
  } else {
    const idleMeta = getIdleMeta();
    const idleGlyph = GlyphEngine.generateGlyph(idleMeta, currentTheme, gs);
    broadcast('glyph', {
      glyphData: idleGlyph,
      metadata:  idleMeta,
      priority:  0,
      expiresAt: null,
    });
  }
  await updatePng();
}

// ── Exports ──────────────────────────────────────────────────
module.exports = {
  sseClients,
  broadcast,
  currentState,
  setGlyph,
  clearGlyph,
  getConfig,
  updateConfig,
  getHistory,
  getPng,
  init,
  setStyleTheme,
  setPngResolution,
  setGridSize,
  addMjpegClient,
  getMjpegBoundary,
  getMjpegClientCount,
};
