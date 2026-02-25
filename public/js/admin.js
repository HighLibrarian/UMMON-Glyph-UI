(function setupTooltips() {
  var tooltipTimers = new WeakMap();
  function showTooltip(el) {
    el.classList.add('show-tooltip');
  }
  function hideTooltip(el) {
    el.classList.remove('show-tooltip');
  }
  document.querySelectorAll('.tooltip-icon').forEach(function (icon) {
    icon.addEventListener('mouseenter', function () {
      var t = setTimeout(function () { showTooltip(icon); }, 1500);
      tooltipTimers.set(icon, t);
    });
    icon.addEventListener('mouseleave', function () {
      clearTimeout(tooltipTimers.get(icon));
      hideTooltip(icon);
    });
    icon.addEventListener('focus', function () {
      var t = setTimeout(function () { showTooltip(icon); }, 1500);
      tooltipTimers.set(icon, t);
    });
    icon.addEventListener('blur', function () {
      clearTimeout(tooltipTimers.get(icon));
      hideTooltip(icon);
    });
  });
})();
// ──────────────────────────────────────────────────────────────
// Ummon Glyph UI — admin page logic
// ──────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Auth-aware fetch wrapper ───────────────────────────────
  // Redirects to /login on 401 responses
  var _origFetch = window.fetch;
  window.fetch = function () {
    return _origFetch.apply(this, arguments).then(function (res) {
      if (res.status === 401) {
        window.location.href = '/login';
      }
      return res;
    });
  };

  // ── Elements ───────────────────────────────────────────────
  var previewCanvas = document.getElementById('preview-canvas');
  var previewCtx    = previewCanvas.getContext('2d');
  var form          = document.getElementById('send-form');
  var sendToast     = document.getElementById('send-toast');
  var configToast   = document.getElementById('config-toast');
  var styleToast    = document.getElementById('style-toast');
  var logList       = document.getElementById('log-list');
  var connDot       = document.getElementById('conn-dot');
  var quickGrid     = document.getElementById('quick-grid');

  var currentGlyph     = null;
  var animPhase        = 0;
  var canvasLogicalSize = 0;
  var currentStyleTheme = null;

  // ── Preview canvas sizing ──────────────────────────────────
  function resizePreview() {
    try {
      var wrap = previewCanvas.parentElement;
      if (!wrap) return;
      var available = wrap.clientWidth;
      if (!available || available < 32) {
        // Layout not ready; retry shortly
        setTimeout(resizePreview, 50);
        return;
      }

      var s   = Math.max(64, Math.min(available - 16, 320));
      var dpr = window.devicePixelRatio || 1;

      previewCanvas.width  = Math.round(s * dpr);
      previewCanvas.height = Math.round(s * dpr);
      previewCanvas.style.width  = s + 'px';
      previewCanvas.style.height = s + 'px';
      previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      canvasLogicalSize = s;
    } catch (err) {
      console.error('resizePreview:', err);
    }
  }

  // ── Animation loop ─────────────────────────────────────────
  function tick() {
    requestAnimationFrame(tick);
    if (!currentGlyph || canvasLogicalSize < 32) return;

    animPhase = (animPhase + 0.008) % 1;

    try {
      GlyphRenderer.render(previewCtx, currentGlyph, canvasLogicalSize, {
        animPhase: animPhase,
        showGlow: true,
        theme: currentStyleTheme,
      });
    } catch (err) {
      console.error('render:', err);
    }
  }

  // ── Toast ──────────────────────────────────────────────────
  function showToast(el, msg, type) {
    if (!el) return;
    type = type || 'ok';
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.classList.remove('show'); }, 3000);
  }

  // ── Display glyph in preview ───────────────────────────────
  function setCurrentGlyph(glyphData, metadata) {
    currentGlyph = glyphData;

    var domainEl = document.getElementById('preview-domain');
    var statusEl = document.getElementById('preview-status');
    var seedEl   = document.getElementById('preview-seed');
    var stateEl  = document.getElementById('topbar-state');

    if (domainEl) domainEl.textContent = (metadata && metadata.domain) || '—';
    if (statusEl) statusEl.textContent =
      ((metadata && metadata.device) ? metadata.device + ' · ' : '') +
      ((metadata && metadata.status) || '—');
    if (seedEl) seedEl.textContent =
      (glyphData && glyphData.seed != null) ? ('seed: ' + glyphData.seed) : '';
    if (stateEl) stateEl.textContent =
      [metadata && metadata.domain, metadata && metadata.device, metadata && metadata.status]
        .filter(Boolean).join(' / ') || 'idle';
  }

  // ── Form → metadata helper ────────────────────────────────
  function formToMetadata() {
    var obj = {};
    var elements = form.elements;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.name || el.name === '') continue;
      var v = el.value;
      if (v === '' || v == null) continue;
      if (el.name === 'urgency' || el.name === 'ttl') {
        obj[el.name] = Number(v);
      } else {
        obj[el.name] = v;
      }
    }
    return obj;
  }

  // ── Preview locally ────────────────────────────────────────
  var previewBtn = document.getElementById('btn-preview-local');
  if (previewBtn) {
    previewBtn.addEventListener('click', function () {
      var meta  = formToMetadata();
      var glyph = GlyphEngine.generateGlyph(meta, currentStyleTheme);
      setCurrentGlyph(glyph, meta);
    });
  }

  // ── Send to server ─────────────────────────────────────────
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var meta = formToMetadata();
      fetch('/glyph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(meta),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            showToast(sendToast, 'Glyph sent — priority ' + data.priority, 'ok');
          } else {
            showToast(sendToast, data.error || 'Rejected', 'err');
          }
        })
        .catch(function () { showToast(sendToast, 'Network error', 'err'); });
    });
  }

  // ── Clear button ───────────────────────────────────────────
  var clearBtn = document.getElementById('btn-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      fetch('/clear', { method: 'POST' })
        .then(function () { showToast(sendToast, 'Cleared — idle', 'ok'); })
        .catch(function () { showToast(sendToast, 'Network error', 'err'); });
    });
  }

  // ── Quick action buttons — dynamically loaded ───────────────
  // (populated by loadDefinitions below)

  // ══════════════════════════════════════════════════════════
  // ── Dynamic definitions (domains, intents, quick actions) ─
  // ══════════════════════════════════════════════════════════

  function loadDefinitions() {
    return fetch('/api/definitions')
      .then(function (res) { return res.json(); })
      .then(function (defs) {
        populateDomains(defs.domains || []);
        populateIntents(defs.intents || []);
        populateQuickActions(defs.quickActions || []);
      })
      .catch(function (err) {
        console.error('loadDefinitions error:', err);
      });
  }

  function populateDomains(domains) {
    var sel = document.getElementById('sel-domain');
    if (!sel) return;
    sel.innerHTML = '<option value="">— select —</option>';
    for (var i = 0; i < domains.length; i++) {
      var d = domains[i];
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.label || d.id;
      if (d.description) opt.title = d.description;
      sel.appendChild(opt);
    }
  }

  function populateIntents(intents) {
    var sel = document.getElementById('sel-intent');
    if (!sel) return;
    sel.innerHTML = '';
    for (var i = 0; i < intents.length; i++) {
      var t = intents[i];
      var opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label || t.id;
      if (t.description) opt.title = t.description;
      sel.appendChild(opt);
    }
  }

  function populateQuickActions(actions) {
    if (!quickGrid) return;
    if (!actions.length) {
      quickGrid.innerHTML = '<p class="log-empty">No quick actions configured</p>';
      return;
    }
    quickGrid.innerHTML = '';
    for (var i = 0; i < actions.length; i++) {
      (function (action) {
        var btn = document.createElement('button');
        btn.className = 'quick-btn';
        btn.innerHTML = '<span class="quick-color ' + (action.color || '') + '"></span> ' + action.label;
        btn.addEventListener('click', function () {
          fetch('/glyph', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.payload),
          })
            .then(function (res) { return res.json(); })
            .then(function (data) {
              if (data.ok) showToast(sendToast, 'Sent ✓', 'ok');
              else showToast(sendToast, data.error || 'Rejected', 'err');
            })
            .catch(function () { showToast(sendToast, 'Network error', 'err'); });
        });
        quickGrid.appendChild(btn);
      })(actions[i]);
    }
  }

  // ── Config ─────────────────────────────────────────────────
  function loadConfig() {
    fetch('/api/config')
      .then(function (res) { return res.json(); })
      .then(function (cfg) {
        var el;
        el = document.getElementById('cfg-idle-min');
        if (el) el.value = cfg.idle.minIntervalSec;
        el = document.getElementById('cfg-idle-max');
        if (el) el.value = cfg.idle.maxIntervalSec;
        el = document.getElementById('cfg-idle-dur');
        if (el) el.value = cfg.idle.displayDurationSec;
        el = document.getElementById('cfg-idle-moods');
        if (el) el.value = cfg.idle.moods;
        el = document.getElementById('cfg-idle-variations');
        if (el) el.value = cfg.idle.idleVariations || 0;
        el = document.getElementById('cfg-default-ttl');
        if (el) el.value = cfg.defaults.ttl;

        // Priority table
        var tbody = document.querySelector('#priority-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        var patterns = Object.keys(cfg.priorities);
        for (var i = 0; i < patterns.length; i++) {
          var pattern = patterns[i];
          var prio    = cfg.priorities[pattern];
          var tr    = document.createElement('tr');
          var td1   = document.createElement('td');
          var code  = document.createElement('code');
          code.textContent = pattern;
          td1.appendChild(code);
          var td2   = document.createElement('td');
          var input = document.createElement('input');
          input.type = 'number';
          input.className = 'prio-input';
          input.setAttribute('data-pattern', pattern);
          input.value = String(prio);
          input.min = '0';
          input.max = '100';
          td2.appendChild(input);
          tr.appendChild(td1);
          tr.appendChild(td2);
          tbody.appendChild(tr);
        }
      })
      .catch(function (err) {
        console.error('loadConfig error:', err);
      });
  }

  var saveConfigBtn = document.getElementById('btn-save-config');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', function () {
      var patch = {
        idle: {
          minIntervalSec:     Number(document.getElementById('cfg-idle-min').value),
          maxIntervalSec:     Number(document.getElementById('cfg-idle-max').value),
          displayDurationSec: Number(document.getElementById('cfg-idle-dur').value),
          moods:              Number(document.getElementById('cfg-idle-moods').value),
          idleVariations:     Number(document.getElementById('cfg-idle-variations').value),
        },
        defaults: {
          ttl: Number(document.getElementById('cfg-default-ttl').value),
        },
        priorities: {},
      };
      var inputs = document.querySelectorAll('.prio-input');
      for (var j = 0; j < inputs.length; j++) {
        patch.priorities[inputs[j].getAttribute('data-pattern')] = Number(inputs[j].value);
      }

      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) showToast(configToast, 'Configuration saved', 'ok');
          else showToast(configToast, 'Failed to save', 'err');
        })
        .catch(function () { showToast(configToast, 'Network error', 'err'); });
    });
  }

  // ── Event log ──────────────────────────────────────────────
  function loadHistory() {
    fetch('/api/history')
      .then(function (res) { return res.json(); })
      .then(function (items) { renderLog(items); })
      .catch(function () { /* ignore */ });
  }

  function renderLog(items) {
    if (!items || !items.length) {
      logList.innerHTML = '<p class="log-empty">No events yet</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var time   = new Date(item.timestamp).toLocaleTimeString();
      var action = item.action.toUpperCase();
      var meta = item.metadata
        ? [item.metadata.domain, item.metadata.device, item.metadata.status].filter(Boolean).join('/')
        : '';
      var prioLabel = item.priority != null ? ' [p' + item.priority + ']' : '';
      html +=
        '<div class="log-entry">' +
        '<span class="log-time">' + time + '</span>' +
        '<span class="log-action ' + item.action + '">' + action + '</span>' +
        '<span class="log-meta">' + meta + prioLabel + '</span>' +
        '</div>';
    }
    logList.innerHTML = html;
  }

  function appendLogEntry(entry) {
    var time   = new Date(entry.timestamp || Date.now()).toLocaleTimeString();
    var action = (entry.action || 'event').toUpperCase();
    var meta = entry.metadata
      ? [entry.metadata.domain, entry.metadata.device, entry.metadata.status].filter(Boolean).join('/')
      : '';
    var prioLabel = entry.priority != null ? ' [p' + entry.priority + ']' : '';
    var div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML =
      '<span class="log-time">' + time + '</span>' +
      '<span class="log-action ' + (entry.action || '').toLowerCase() + '">' + action + '</span>' +
      '<span class="log-meta">' + meta + prioLabel + '</span>';
    var empty = logList.querySelector('.log-empty');
    if (empty) logList.innerHTML = '';
    logList.prepend(div);
    while (logList.children.length > 50) logList.lastChild.remove();
  }

  // ══════════════════════════════════════════════════════════
  // ── Style / Theme seed ────────────────────────────────────
  // ══════════════════════════════════════════════════════════

  var styleSeedInput     = document.getElementById('style-seed-input');
  var pngResolutionSelect = document.getElementById('png-resolution-select');
  var gridSizeSelect      = document.getElementById('grid-size-select');
  var stylePreviewCanvas = document.getElementById('style-preview-canvas');
  var stylePreviewCtx    = stylePreviewCanvas ? stylePreviewCanvas.getContext('2d') : null;
  var styleParamsDiv     = document.getElementById('style-params');

  function resizeStylePreview() {
    if (!stylePreviewCanvas) return 0;
    var wrap = stylePreviewCanvas.parentElement;
    if (!wrap) return 0;
    var available = wrap.clientWidth;
    if (!available || available < 32) {
      setTimeout(resizeStylePreview, 50);
      return 0;
    }
    var s = Math.max(64, Math.min(available - 16, 240));
    var dpr = window.devicePixelRatio || 1;
    stylePreviewCanvas.width  = Math.round(s * dpr);
    stylePreviewCanvas.height = Math.round(s * dpr);
    stylePreviewCanvas.style.width  = s + 'px';
    stylePreviewCanvas.style.height = s + 'px';
    stylePreviewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return s;
  }

  function loadStyleSeed() {
    return fetch('/api/style')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (styleSeedInput && data.styleSeed) {
          styleSeedInput.value = data.styleSeed;
          applyStyleSeed(data.styleSeed);
        }
        if (pngResolutionSelect && data.pngResolution) {
          pngResolutionSelect.value = String(data.pngResolution);
        }
        if (gridSizeSelect && data.gridSize) {
          gridSizeSelect.value = String(data.gridSize);
          GlyphEngine.setGridSize(Number(data.gridSize));
        }
      })
      .catch(function () { /* ignore */ });
  }

  function applyStyleSeed(seed) {
    if (!seed || seed.trim() === '') {
      currentStyleTheme = null;
      if (styleParamsDiv) styleParamsDiv.innerHTML = '<p class="log-empty">No seed — using default theme</p>';
      renderStylePreview();
      return;
    }
    currentStyleTheme = GlyphEngine.deriveTheme(seed);
    if (styleParamsDiv && currentStyleTheme) {
      var t = currentStyleTheme;
      var rotLabels = ['0°', '90°', '180°', '270°'];
      var symLabels = ['None', 'Horizontal', 'Vertical', 'Both'];
      styleParamsDiv.innerHTML =
        '<div class="style-param"><span>Hue Shift</span><span>' + t.hueShift.toFixed(0) + '°</span></div>' +
        '<div class="style-param"><span>Saturation</span><span>' + (t.saturationMul * 100).toFixed(0) + '%</span></div>' +
        '<div class="style-param"><span>Brightness</span><span>' + (t.brightnessMul * 100).toFixed(0) + '%</span></div>' +
        '<div class="style-param"><span>Glow Intensity</span><span>' + (t.glowIntensity * 100).toFixed(0) + '%</span></div>' +
        '<div class="style-param"><span>Corner Radius</span><span>' + t.cornerRadius.toFixed(1) + 'px</span></div>' +
        '<div class="style-param"><span>Cell Gap</span><span>' + t.cellGapMul.toFixed(2) + 'x</span></div>' +
        '<div class="style-param"><span>BG Tint</span><span style="color:' + t.bgTint + '">' + t.bgTint + '</span></div>' +
        '<div class="style-param"><span>Rotation</span><span>' + (rotLabels[t.gridRotation] || '0°') + '</span></div>' +
        '<div class="style-param"><span>Flip H / V</span><span>' + (t.flipH ? '✓' : '—') + ' / ' + (t.flipV ? '✓' : '—') + '</span></div>' +
        '<div class="style-param"><span>Symmetry</span><span>' + (symLabels[t.symmetryMode] || 'None') + '</span></div>' +
        '<div class="style-param"><span>Scatter</span><span>' + (t.scatterCount || 0) + ' cells</span></div>';
    }
    renderStylePreview();
  }

  function renderStylePreview() {
    if (!stylePreviewCtx) return;
    var s = resizeStylePreview();
    if (!s || s < 32) return;
    var gs = gridSizeSelect ? Number(gridSizeSelect.value) : undefined;
    var sampleGlyph = GlyphEngine.generateGlyph({
      domain: 'appliance', device: 'preview', status: 'done', intent: 'notification', urgency: 1,
    }, currentStyleTheme, gs);
    try {
      GlyphRenderer.render(stylePreviewCtx, sampleGlyph, s, {
        animPhase: 0,
        showGlow: true,
        theme: currentStyleTheme,
      });
    } catch (err) {
      console.error('style preview render:', err);
    }
  }

  var stylePreviewBtn = document.getElementById('btn-style-preview');
  if (stylePreviewBtn) {
    stylePreviewBtn.addEventListener('click', function () {
      applyStyleSeed(styleSeedInput ? styleSeedInput.value : '');
    });
  }

  if (styleSeedInput) {
    var _debounce = null;
    styleSeedInput.addEventListener('input', function () {
      clearTimeout(_debounce);
      _debounce = setTimeout(function () {
        applyStyleSeed(styleSeedInput.value);
      }, 300);
    });
  }

  if (gridSizeSelect) {
    gridSizeSelect.addEventListener('change', function () {
      renderStylePreview();
    });
  }

  var styleSaveBtn = document.getElementById('btn-style-save');
  if (styleSaveBtn) {
    styleSaveBtn.addEventListener('click', function () {
      var seed = styleSeedInput ? styleSeedInput.value : '';
      var res = pngResolutionSelect ? Number(pngResolutionSelect.value) : 256;
      var gs  = gridSizeSelect ? Number(gridSizeSelect.value) : 8;
      fetch('/api/style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ styleSeed: seed, pngResolution: res, gridSize: gs }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.ok) showToast(styleToast, 'Style saved', 'ok');
          else showToast(styleToast, 'Failed to save', 'err');
        })
        .catch(function () { showToast(styleToast, 'Network error', 'err'); });
    });
  }

  // ══════════════════════════════════════════════════════════
  // ── MJPEG stream controls ─────────────────────────────────
  // ══════════════════════════════════════════════════════════

  var mjpegUrlEl      = document.getElementById('mjpeg-url');
  var mjpegPreview    = document.getElementById('mjpeg-preview');
  var mjpegFpsSel     = document.getElementById('mjpeg-fps');
  var mjpegQualitySel = document.getElementById('mjpeg-quality');
  var mjpegSizeSel    = document.getElementById('mjpeg-size');
  var mjpegStartBtn   = document.getElementById('btn-mjpeg-start');
  var mjpegStopBtn    = document.getElementById('btn-mjpeg-stop');
  var mjpegCopyBtn    = document.getElementById('btn-copy-mjpeg');
  var mjpegToast      = document.getElementById('mjpeg-toast');

  function buildMjpegUrl() {
    var fps     = mjpegFpsSel     ? mjpegFpsSel.value     : '2';
    var quality = mjpegQualitySel ? mjpegQualitySel.value  : '80';
    var size    = mjpegSizeSel    ? mjpegSizeSel.value     : '256';
    var base    = window.location.protocol + '//' + window.location.host;
    return base + '/glyph.mjpeg?fps=' + fps + '&quality=' + quality + '&size=' + size;
  }

  function updateMjpegUrl() {
    var url = buildMjpegUrl();
    if (mjpegUrlEl) mjpegUrlEl.textContent = url;
  }

  if (mjpegFpsSel)     mjpegFpsSel.addEventListener('change', updateMjpegUrl);
  if (mjpegQualitySel) mjpegQualitySel.addEventListener('change', updateMjpegUrl);
  if (mjpegSizeSel)    mjpegSizeSel.addEventListener('change', updateMjpegUrl);

  if (mjpegStartBtn) {
    mjpegStartBtn.addEventListener('click', function () {
      var url = buildMjpegUrl();
      if (mjpegPreview) {
        mjpegPreview.src = url;
        mjpegPreview.style.display = 'block';
      }
      mjpegStartBtn.style.display = 'none';
      if (mjpegStopBtn) mjpegStopBtn.style.display = '';
      showToast(mjpegToast, 'Stream started', 'ok');
    });
  }

  if (mjpegStopBtn) {
    mjpegStopBtn.addEventListener('click', function () {
      if (mjpegPreview) {
        mjpegPreview.src = '';
        mjpegPreview.style.display = 'none';
      }
      mjpegStopBtn.style.display = 'none';
      if (mjpegStartBtn) mjpegStartBtn.style.display = '';
      showToast(mjpegToast, 'Stream stopped', 'ok');
    });
  }

  if (mjpegCopyBtn) {
    mjpegCopyBtn.addEventListener('click', function () {
      var url = buildMjpegUrl();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          showToast(mjpegToast, 'URL copied ✓', 'ok');
        }).catch(function () {
          showToast(mjpegToast, 'Copy failed', 'err');
        });
      } else {
        // Fallback
        var ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(mjpegToast, 'URL copied ✓', 'ok');
      }
    });
  }

  // ── SSE ────────────────────────────────────────────────────
  function connectSSE() {
    var es = new EventSource('/events');

    es.addEventListener('glyph', function (e) {
      try {
        var data = JSON.parse(e.data);
        setCurrentGlyph(data.glyphData, data.metadata);
        appendLogEntry({ action: 'set', metadata: data.metadata, priority: data.priority });
      } catch (err) {
        console.error('SSE glyph parse error:', err);
      }
    });

    es.addEventListener('clear', function (e) {
      try {
        var data = JSON.parse(e.data);
        var idleMeta = (data && data.metadata) || {
          domain: 'system', status: 'idle', intent: 'idle', urgency: 0,
        };
        // Use server-generated glyphData if available (ensures layout matches)
        var idle = (data && data.glyphData)
          ? data.glyphData
          : GlyphEngine.generateGlyph(idleMeta, currentStyleTheme);
        setCurrentGlyph(idle, idleMeta);
        appendLogEntry({ action: 'clear' });
      } catch (err) {
        console.error('SSE clear parse error:', err);
      }
    });

    es.addEventListener('config', function () {
      loadConfig();
    });

    es.addEventListener('style', function (e) {
      try {
        var data = JSON.parse(e.data);
        if (styleSeedInput) styleSeedInput.value = data.styleSeed || '';
        if (pngResolutionSelect && data.pngResolution) {
          pngResolutionSelect.value = String(data.pngResolution);
        }
        if (gridSizeSelect && data.gridSize) {
          gridSizeSelect.value = String(data.gridSize);
          GlyphEngine.setGridSize(Number(data.gridSize));
        }
        applyStyleSeed(data.styleSeed || '');
      } catch (err) {
        console.error('SSE style parse error:', err);
      }
    });

    es.onopen = function () {
      if (connDot) connDot.classList.add('connected');
    };
    es.onerror = function () {
      if (connDot) connDot.classList.remove('connected');
    };
  }

  // ── Init (deferred to ensure layout is fully resolved) ─────
  function init() {
    resizePreview();
    window.addEventListener('resize', function () {
      resizePreview();
      resizeStylePreview();
    });

    // Load dynamic definitions, then show initial glyph
    loadDefinitions().then(function () {
      try {
        var idleGlyph = GlyphEngine.generateGlyph({
          domain: 'system', status: 'idle', intent: 'idle', urgency: 0,
        }, currentStyleTheme);
        setCurrentGlyph(idleGlyph, { domain: 'system', status: 'idle', intent: 'idle' });
      } catch (err) {
        console.error('init glyph error:', err);
      }
    });

    loadConfig();
    loadHistory();
    loadStyleSeed();
    connectSSE();
    tick();
    updateMjpegUrl();

    // Show logout button if auth is enabled
    _origFetch('/api/auth/status').then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.authEnabled) {
          var btn = document.getElementById('logout-link');
          if (btn) btn.style.display = '';
        }
      }).catch(function () {});
  }

  // Wait for layout to be fully resolved before starting
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      requestAnimationFrame(init);
    });
  } else {
    // DOM already parsed — defer one frame to ensure CSS layout
    requestAnimationFrame(init);
  }
})();
