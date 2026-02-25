// src/ha-integration.js
// Home Assistant integration backend for Ummon UI
// Handles connection, entity fetching, persistence, and state monitoring

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ── Runtime state ────────────────────────────────────────────
let haConfig = { host: '', token: '' };
let labelName = 'glyph';
let entityOverrides = {};   // keyed by entity_id
let configDir = '';          // set via init()
let glyphCallback = null;   // called when a rule triggers a glyph
let wsConnection = null;    // WebSocket connection to HA
let wsReconnectTimer = null;
let wsMsgId = 1;
let wsSubscribed = false;
let wsEntitySubscriptions = new Set(); // entity_ids we care about

// ── File helpers ─────────────────────────────────────────────
function haConfigPath()    { return path.join(configDir, 'ha-config.json'); }
function haEntitiesPath()  { return path.join(configDir, 'ha-entities.json'); }

function loadFromDisk() {
  try {
    if (fs.existsSync(haConfigPath())) {
      const data = JSON.parse(fs.readFileSync(haConfigPath(), 'utf8'));
      haConfig.host = data.host || '';
      haConfig.token = data.token || '';
      labelName = data.labelName || 'glyph';
    }
  } catch (err) {
    console.error('  ◆ Failed to load HA config:', err.message);
  }
  try {
    if (fs.existsSync(haEntitiesPath())) {
      entityOverrides = JSON.parse(fs.readFileSync(haEntitiesPath(), 'utf8'));
    }
  } catch (err) {
    console.error('  ◆ Failed to load HA entities:', err.message);
  }
}

function saveConfigToDisk() {
  try {
    fs.writeFileSync(haConfigPath(), JSON.stringify({
      host: haConfig.host,
      token: haConfig.token,
      labelName,
    }, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('  ◆ Failed to save HA config:', err.message);
  }
}

function saveEntitiesToDisk() {
  try {
    fs.writeFileSync(haEntitiesPath(), JSON.stringify(entityOverrides, null, 2) + '\n', 'utf8');
  } catch (err) {
    console.error('  ◆ Failed to save HA entities:', err.message);
  }
}

// ── Initialization ───────────────────────────────────────────
function init(cfgDir, onGlyph) {
  configDir = cfgDir;
  glyphCallback = onGlyph || null;
  loadFromDisk();
  // Auto-connect if config is present
  if (haConfig.host && haConfig.token) {
    connectWebSocket();
  }
}

// ── Config accessors ─────────────────────────────────────────
function getConfig() {
  return { host: haConfig.host, token: haConfig.token ? '••••••••' : '', labelName };
}

function setConfig({ host, token, labelName: ln }) {
  if (host !== undefined) haConfig.host = host;
  if (token !== undefined) haConfig.token = token;
  if (ln !== undefined) labelName = ln;
  saveConfigToDisk();
  // Reconnect WebSocket with new credentials
  disconnectWebSocket();
  if (haConfig.host && haConfig.token) {
    connectWebSocket();
  }
}

function getLabelName() { return labelName; }

function setLabelName(name) {
  labelName = name || 'glyph';
  saveConfigToDisk();
}

// ── Connection test ──────────────────────────────────────────
async function testConnection(overrideHost, overrideToken) {
  const host = overrideHost || haConfig.host;
  const token = overrideToken || haConfig.token;

  if (!host || !token) return { ok: false, steps: [
    { step: 'contacting server', status: 'failed', error: 'Missing host or token' }
  ]};

  const steps = [];

  // Step 1: Contact server (no auth — a 401 means the server is reachable)
  try {
    await axios.get(`${host}/api/`, { timeout: 5000 });
    steps.push({ step: 'contacting server', status: 'success' });
  } catch (err) {
    if (err.response && (err.response.status === 401 || err.response.status === 403)) {
      // Server responded — it's reachable, just requires auth (expected)
      steps.push({ step: 'contacting server', status: 'success' });
    } else {
      let msg = err.message || 'Unknown error';
      if (err.response) msg = `HTTP ${err.response.status}: ${err.response.statusText}`;
      steps.push({ step: 'contacting server', status: 'failed', error: msg });
      return { ok: false, steps };
    }
  }

  // Step 2: Authentication + entity access (use /api/states which is what we actually need)
  try {
    const res = await axios.get(`${host}/api/states`, {
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000
    });
    if (res.status === 200 && Array.isArray(res.data)) {
      steps.push({ step: 'authentication', status: 'success' });
      steps.push({ step: 'getting entities', status: 'success', count: res.data.length });
      return { ok: true, steps };
    } else {
      steps.push({ step: 'authentication', status: 'success' });
      steps.push({ step: 'getting entities', status: 'failed', error: 'Unexpected response' });
      return { ok: false, steps };
    }
  } catch (err) {
    let msg = err.message || 'Unknown error';
    if (err.response) msg = `HTTP ${err.response.status}: ${err.response.statusText}`;
    if (err.response && (err.response.status === 401 || err.response.status === 403)) {
      steps.push({ step: 'authentication', status: 'failed', error: msg });
    } else {
      steps.push({ step: 'authentication', status: 'success' });
      steps.push({ step: 'getting entities', status: 'failed', error: msg });
    }
    return { ok: false, steps };
  }
}

// ── WebSocket command helper ─────────────────────────────────
// Sends a single command over a temporary WebSocket connection and returns the result.
function wsCommand(host, token, cmdType, extraFields) {
  return new Promise((resolve, reject) => {
    let WebSocket;
    try { WebSocket = require('ws'); } catch { return reject(new Error('ws package not installed')); }

    const wsUrl = host.replace(/^http/, 'ws') + '/api/websocket';
    const ws = new WebSocket(wsUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    let msgId = 1;
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; ws.close(); reject(new Error('WebSocket command timeout')); }
    }, 15000);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth_required') {
          ws.send(JSON.stringify({ type: 'auth', access_token: token }));
        } else if (msg.type === 'auth_ok') {
          const id = msgId++;
          ws.send(JSON.stringify({ id, type: cmdType, ...extraFields }));
        } else if (msg.type === 'auth_invalid') {
          if (!settled) { settled = true; clearTimeout(timeout); ws.close(); reject(new Error('Auth invalid')); }
        } else if (msg.type === 'result') {
          if (!settled) {
            settled = true; clearTimeout(timeout); ws.close();
            if (msg.success) resolve(msg.result);
            else reject(new Error(msg.error?.message || 'Command failed'));
          }
        }
      } catch { /* ignore parse errors */ }
    });
    ws.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(err); }
    });
    ws.on('close', () => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error('WebSocket closed')); }
    });
  });
}

// ── Fetch labeled entities from Home Assistant ───────────────
async function fetchLabeledEntities() {
  if (!haConfig.host || !haConfig.token) {
    return { ok: false, error: 'Not configured', entities: [] };
  }

  const headers = { 'Authorization': `Bearer ${haConfig.token}` };
  let allEntities = [];
  let labeledEntityIds = new Set();
  let targetLabelId = null;
  let labelFound = false;

  // Step 1: Fetch labels via WebSocket to find the label ID
  try {
    const labels = await wsCommand(haConfig.host, haConfig.token, 'config/label_registry/list', {});
    if (Array.isArray(labels)) {
      for (const label of labels) {
        if ((label.name || '').toLowerCase() === labelName.toLowerCase() ||
            (label.label_id || '').toLowerCase() === labelName.toLowerCase()) {
          targetLabelId = label.label_id;
          labelFound = true;
          break;
        }
      }
    }
  } catch (err) {
    console.log('  ◆ HA labels fetch failed:', err.message);
  }

  // Step 2: Fetch entity registry via WebSocket to find entities with the label
  if (targetLabelId) {
    try {
      const registry = await wsCommand(haConfig.host, haConfig.token, 'config/entity_registry/list', {});
      if (Array.isArray(registry)) {
        for (const ent of registry) {
          if (Array.isArray(ent.labels) && ent.labels.includes(targetLabelId)) {
            labeledEntityIds.add(ent.entity_id);
          }
        }
      }
    } catch (err) {
      console.log('  ◆ HA entity registry fetch failed:', err.message);
    }
  }

  // Also include any entities we already have overrides for
  for (const eid of Object.keys(entityOverrides)) {
    labeledEntityIds.add(eid);
  }

  // Step 3: Fetch full state for all entities (REST API works fine for this)
  try {
    const statesRes = await axios.get(`${haConfig.host}/api/states`, {
      headers, timeout: 10000
    });
    if (Array.isArray(statesRes.data)) {
      allEntities = statesRes.data;
    }
  } catch (err) {
    return { ok: false, error: 'Failed to fetch states: ' + (err.message || 'unknown'), entities: [] };
  }

  // Build entity list — only include labeled entities + overrides
  // If no label was found and no overrides exist, return empty (don't dump all entities)
  const entities = [];

  for (const state of allEntities) {
    if (!labeledEntityIds.has(state.entity_id)) continue;

    const override = entityOverrides[state.entity_id] || {};
    const haDomain = state.entity_id.split('.')[0];
    entities.push({
      entity_id: state.entity_id,
      friendly_name: (state.attributes && state.attributes.friendly_name) || state.entity_id,
      ha_domain: haDomain,
      current_state: state.state,
      // Glyph overrides (user-configured)
      domain: override.domain || '',
      device: override.device || '',
      intent: override.intent || '',
      urgency: override.urgency !== undefined ? override.urgency : 0,
      ttl: override.ttl !== undefined ? override.ttl : 30,
      triggers: override.triggers || [],
      enabled: override.enabled !== false,
    });
  }

  // Update WebSocket subscriptions
  wsEntitySubscriptions = new Set(
    Object.keys(entityOverrides).filter(eid => entityOverrides[eid].enabled !== false && (entityOverrides[eid].triggers || []).length > 0)
  );

  return { ok: true, entities, labelFound, labelName };
}

// ── Fetch all HA entities (for "Add Entity" picker) ──────────
async function fetchAllEntities() {
  if (!haConfig.host || !haConfig.token) {
    return { ok: false, error: 'Not configured', entities: [] };
  }
  const headers = { 'Authorization': `Bearer ${haConfig.token}` };
  try {
    const res = await axios.get(`${haConfig.host}/api/states`, {
      headers, timeout: 10000
    });
    if (!Array.isArray(res.data)) return { ok: false, error: 'Unexpected response', entities: [] };
    const entities = res.data.map(s => ({
      entity_id: s.entity_id,
      friendly_name: (s.attributes && s.attributes.friendly_name) || s.entity_id,
      ha_domain: s.entity_id.split('.')[0],
      current_state: s.state,
    }));
    return { ok: true, entities };
  } catch (err) {
    return { ok: false, error: err.message || 'Unknown error', entities: [] };
  }
}

// ── Entity override management ───────────────────────────────
function getEntityOverrides() {
  return entityOverrides;
}

function getEntityOverride(entityId) {
  return entityOverrides[entityId] || null;
}

function saveEntityOverride(entityId, override) {
  entityOverrides[entityId] = { ...override, entity_id: entityId };
  saveEntitiesToDisk();
  // Update subscriptions
  wsEntitySubscriptions = new Set(
    Object.keys(entityOverrides).filter(eid => entityOverrides[eid].enabled !== false && (entityOverrides[eid].triggers || []).length > 0)
  );
}

function deleteEntityOverride(entityId) {
  delete entityOverrides[entityId];
  saveEntitiesToDisk();
  wsEntitySubscriptions.delete(entityId);
}

function saveAllOverrides(overrides) {
  entityOverrides = overrides;
  saveEntitiesToDisk();
  wsEntitySubscriptions = new Set(
    Object.keys(entityOverrides).filter(eid => entityOverrides[eid].enabled !== false && (entityOverrides[eid].triggers || []).length > 0)
  );
}

// ── Rule evaluation ──────────────────────────────────────────
function evaluateRules(entityId, newState) {
  const override = entityOverrides[entityId];
  if (!override || override.enabled === false) return null;
  if (!override.triggers || override.triggers.length === 0) return null;

  for (const trigger of override.triggers) {
    const { stateType, operator, value } = trigger;
    let matches = false;

    if (stateType === 'number') {
      const numState = parseFloat(newState);
      const numValue = parseFloat(value);
      if (isNaN(numState) || isNaN(numValue)) continue;
      switch (operator) {
        case '=':  matches = numState === numValue; break;
        case '!=': matches = numState !== numValue; break;
        case '<':  matches = numState < numValue; break;
        case '>':  matches = numState > numValue; break;
        case '<=': matches = numState <= numValue; break;
        case '>=': matches = numState >= numValue; break;
      }
    } else {
      // String comparison
      const strState = String(newState).toLowerCase();
      const strValue = String(value).toLowerCase();
      switch (operator) {
        case '=':  matches = strState === strValue; break;
        case '!=': matches = strState !== strValue; break;
      }
    }

    if (matches) {
      // Build glyph payload from override config
      return {
        domain: override.domain || 'system',
        device: override.device || override.friendly_name || entityId,
        status: trigger.glyphStatus || 'notification',
        intent: override.intent || 'notification',
        urgency: override.urgency !== undefined ? Number(override.urgency) : 0,
        ttl: override.ttl !== undefined ? Number(override.ttl) : 30,
        _source: 'ha-integration',
        _entity_id: entityId,
        _trigger: trigger,
      };
    }
  }
  return null;
}

// ── WebSocket connection for real-time state updates ─────────
function connectWebSocket() {
  if (wsConnection) return;
  if (!haConfig.host || !haConfig.token) return;

  let WebSocket;
  try {
    WebSocket = require('ws');
  } catch {
    console.log('  ◆ HA WebSocket: ws package not installed, polling mode only');
    return;
  }

  const wsUrl = haConfig.host.replace(/^http/, 'ws') + '/api/websocket';
  console.log(`  ◆ HA WebSocket: connecting to ${wsUrl}`);

  try {
    wsConnection = new WebSocket(wsUrl, {
      headers: { 'Authorization': `Bearer ${haConfig.token}` }
    });
  } catch (err) {
    console.error('  ◆ HA WebSocket: failed to connect:', err.message);
    scheduleReconnect();
    return;
  }

  wsMsgId = 1;
  wsSubscribed = false;

  wsConnection.on('open', () => {
    console.log('  ◆ HA WebSocket: connected');
  });

  wsConnection.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleWsMessage(msg);
    } catch { /* ignore parse errors */ }
  });

  wsConnection.on('close', () => {
    console.log('  ◆ HA WebSocket: disconnected');
    wsConnection = null;
    wsSubscribed = false;
    scheduleReconnect();
  });

  wsConnection.on('error', (err) => {
    console.error('  ◆ HA WebSocket: error:', err.message);
    if (wsConnection) {
      try { wsConnection.close(); } catch { /* ignore */ }
    }
    wsConnection = null;
    wsSubscribed = false;
    scheduleReconnect();
  });
}

function disconnectWebSocket() {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (wsConnection) {
    try { wsConnection.close(); } catch { /* ignore */ }
    wsConnection = null;
    wsSubscribed = false;
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWebSocket();
  }, 30000); // Retry every 30 seconds
}

function handleWsMessage(msg) {
  // Auth required
  if (msg.type === 'auth_required') {
    if (wsConnection && wsConnection.readyState === 1) {
      wsConnection.send(JSON.stringify({
        type: 'auth',
        access_token: haConfig.token
      }));
    }
    return;
  }

  // Auth OK — subscribe to state changes
  if (msg.type === 'auth_ok') {
    console.log('  ◆ HA WebSocket: authenticated');
    const id = wsMsgId++;
    if (wsConnection && wsConnection.readyState === 1) {
      wsConnection.send(JSON.stringify({
        id,
        type: 'subscribe_events',
        event_type: 'state_changed'
      }));
      wsSubscribed = true;
    }
    return;
  }

  // Auth invalid
  if (msg.type === 'auth_invalid') {
    console.error('  ◆ HA WebSocket: auth invalid —', msg.message);
    disconnectWebSocket();
    return;
  }

  // State change event
  if (msg.type === 'event' && msg.event && msg.event.event_type === 'state_changed') {
    const eventData = msg.event.data;
    if (!eventData) return;
    const entityId = eventData.entity_id;
    const newState = eventData.new_state;
    if (!entityId || !newState) return;

    // Only process entities we're watching
    if (!wsEntitySubscriptions.has(entityId)) return;

    const glyphPayload = evaluateRules(entityId, newState.state);
    if (glyphPayload && glyphCallback) {
      console.log(`  ◆ HA trigger: ${entityId} = "${newState.state}" → glyph`);
      glyphCallback(glyphPayload);
    }
  }
}

function getConnectionStatus() {
  if (!haConfig.host || !haConfig.token) return 'not_configured';
  if (wsConnection && wsConnection.readyState === 1 && wsSubscribed) return 'connected';
  if (wsConnection) return 'connecting';
  return 'disconnected';
}

// ── Exports ──────────────────────────────────────────────────
module.exports = {
  init,
  getConfig,
  setConfig,
  getLabelName,
  setLabelName,
  testConnection,
  fetchLabeledEntities,
  fetchAllEntities,
  getEntityOverrides,
  getEntityOverride,
  saveEntityOverride,
  deleteEntityOverride,
  saveAllOverrides,
  evaluateRules,
  connectWebSocket,
  disconnectWebSocket,
  getConnectionStatus,
};
