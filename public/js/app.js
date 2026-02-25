// ──────────────────────────────────────────────────────────────
// Ummon Glyph UI — display page logic
// Connects via SSE, renders the current glyph with animations.
// ──────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const canvas  = document.getElementById('glyph-canvas');
  const ctx     = canvas.getContext('2d');
  const status  = document.getElementById('status-text');
  const meta    = document.getElementById('meta-text');

  let currentGlyph = null;
  let animPhase    = 0;
  let animSpeed    = 0.008;   // phase increment per frame
  let connected    = false;
  let currentTheme = null;    // derived from style seed

  let canvasLogicalSize = 0;

  // ── Canvas sizing ──────────────────────────────────────────
  function resizeCanvas() {
    const container = canvas.parentElement;
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h || w < 32 || h < 32) {
      setTimeout(resizeCanvas, 50);
      return;
    }
    const s = Math.max(64, Math.min(w, h, 480));
    const dpr = window.devicePixelRatio || 1;
    canvas.width  = Math.round(s * dpr);
    canvas.height = Math.round(s * dpr);
    canvas.style.width  = s + 'px';
    canvas.style.height = s + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvasLogicalSize = s;
  }

  // ── Animation loop ─────────────────────────────────────────
  function tick() {
    requestAnimationFrame(tick);
    if (!currentGlyph || canvasLogicalSize < 32) return;

    animPhase = (animPhase + animSpeed) % 1;
    GlyphRenderer.render(ctx, currentGlyph, canvasLogicalSize, {
      animPhase: animPhase,
      showGlow: true,
      theme: currentTheme,
    });
  }

  // ── Status display ─────────────────────────────────────────
  function updateInfo(glyphData, metadata) {
    if (!metadata) {
      status.textContent = 'idle';
      meta.textContent   = '—';
      return;
    }

    // Idle mood — show "IDLE // MOOD NAME"
    if (metadata.moodName) {
      status.innerHTML = '<span class="mood-label">IDLE</span> <span class="mood-sep">//</span> <span class="mood-name">' + escapeHtml(metadata.moodName) + '</span>';
      meta.textContent = '';
      return;
    }

    // Initial idle or plain idle — no mood name, just "idle"
    if (metadata.domain === 'system' && metadata.status === 'idle') {
      status.textContent = 'idle';
      meta.textContent   = '—';
      return;
    }

    const parts = [metadata.domain];
    if (metadata.device) parts.push(metadata.device);
    parts.push(metadata.status);
    status.textContent = parts.join(' / ');

    const details = [`intent: ${metadata.intent || '—'}`];
    if (metadata.urgency) details.push(`urgency: ${metadata.urgency}`);
    if (glyphData?.isError) details.push(`⚠ ${glyphData.errorMessage}`);
    meta.textContent = details.join('  ·  ');
  }

  function escapeHtml(str) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  // ── SSE connection ─────────────────────────────────────────
  function connectSSE() {
    const es = new EventSource('/events');

    es.addEventListener('glyph', (e) => {
      const data = JSON.parse(e.data);
      currentGlyph = data.glyphData;
      updateInfo(data.glyphData, data.metadata);
      // Pulse connection indicator
      document.getElementById('conn-dot').classList.add('pulse');
      setTimeout(() => document.getElementById('conn-dot').classList.remove('pulse'), 600);
    });

    es.addEventListener('clear', (e) => {
      const data = JSON.parse(e.data);
      // Use server-generated glyphData if available (ensures layout + color match PNG)
      if (data.glyphData) {
        currentGlyph = data.glyphData;
      } else {
        currentGlyph = GlyphEngine.generateGlyph(data.metadata || {
          domain: 'system', status: 'idle', intent: 'idle', urgency: 0,
        }, currentTheme);
      }
      updateInfo(currentGlyph, data.metadata);
    });

    es.addEventListener('style', (e) => {
      try {
        const data = JSON.parse(e.data);
        currentTheme = data.styleSeed ? GlyphEngine.deriveTheme(data.styleSeed) : null;
      } catch (err) {
        console.error('SSE style parse error:', err);
      }
    });

    es.onopen = () => {
      connected = true;
      document.getElementById('conn-dot').classList.add('connected');
    };

    es.onerror = () => {
      connected = false;
      document.getElementById('conn-dot').classList.remove('connected');
      // EventSource will auto-reconnect
    };
  }

  // ── Init (deferred for layout) ─────────────────────────────
  function init() {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Load current style seed
    fetch('/api/style').then(r => r.json()).then(data => {
      if (data.styleSeed) {
        currentTheme = GlyphEngine.deriveTheme(data.styleSeed);
      }
    }).catch(() => {});

    // Show idle glyph immediately (theme may be null until /api/style loads)
    currentGlyph = GlyphEngine.generateGlyph({
      domain: 'system', status: 'idle', intent: 'idle', urgency: 0,
    }, currentTheme);
    updateInfo(currentGlyph, { domain: 'system', status: 'idle', intent: 'idle' });

    connectSSE();
    tick();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      requestAnimationFrame(init);
    });
  } else {
    requestAnimationFrame(init);
  }
})();
