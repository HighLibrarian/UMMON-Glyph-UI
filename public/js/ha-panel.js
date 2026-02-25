// public/js/ha-panel.js
// Home Assistant integration panel logic for Ummon UI

(function () {
  'use strict';

  // ── Element references ─────────────────────────────────────
  var haHostInput   = document.getElementById('ha-host');
  var haTokenInput  = document.getElementById('ha-token');
  var haLabelInput  = document.getElementById('ha-label');
  var haSaveBtn     = document.getElementById('btn-ha-save');
  var haRefreshBtn  = document.getElementById('btn-ha-refresh');
  var haAddBtn      = document.getElementById('btn-ha-add-entity');
  var haEntityTable = document.getElementById('ha-entity-table');
  var haToast       = document.getElementById('ha-toast');
  var haWsIndicator = document.getElementById('ha-ws-indicator');
  var haWsLabel     = document.getElementById('ha-ws-label');

  // Modal elements
  var modalOverlay  = document.getElementById('ha-modal-overlay');
  var modalTitle    = document.getElementById('ha-modal-title');
  var modalEntityId = document.getElementById('ha-edit-entity-id');
  var modalName     = document.getElementById('ha-edit-name');
  var modalDomain   = document.getElementById('ha-edit-domain');
  var modalDevice   = document.getElementById('ha-edit-device');
  var modalIntent   = document.getElementById('ha-edit-intent');
  var modalUrgency  = document.getElementById('ha-edit-urgency');
  var modalTtl      = document.getElementById('ha-edit-ttl');
  var modalEnabled  = document.getElementById('ha-edit-enabled');
  var modalTriggers = document.getElementById('ha-edit-triggers');
  var addTriggerBtn = document.getElementById('ha-add-trigger');
  var modalSaveBtn  = document.getElementById('ha-modal-save');
  var modalCancelBtn= document.getElementById('ha-modal-cancel');
  var modalDeleteBtn= document.getElementById('ha-modal-delete');

  // Add entity modal
  var addModalOverlay = document.getElementById('ha-add-modal-overlay');
  var addSearchInput  = document.getElementById('ha-add-search');
  var addEntityList   = document.getElementById('ha-add-entity-list');
  var addModalCancel  = document.getElementById('ha-add-modal-cancel');

  // ── State ──────────────────────────────────────────────────
  var entities = [];
  var currentEditEntity = null;
  var allHaEntities = [];

  // ── Toast ──────────────────────────────────────────────────
  function showToast(msg, type) {
    if (!haToast) return;
    type = type || 'ok';
    haToast.textContent = msg;
    haToast.className = 'toast show ' + type;
    clearTimeout(haToast._timer);
    haToast._timer = setTimeout(function () { haToast.classList.remove('show'); }, 3000);
  }

  // ── Load saved config ──────────────────────────────────────
  function loadConfig() {
    fetch('/api/ha/config')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.host) haHostInput.value = data.host;
        if (data.token && data.token !== '••••••••') haTokenInput.value = data.token;
        if (data.labelName) haLabelInput.value = data.labelName;
      })
      .catch(function () { /* ignore */ });
  }

  // ── Load WS status ────────────────────────────────────────
  function loadWsStatus() {
    fetch('/api/ha/status')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var statusMap = {
          connected: { cls: 'connected', text: 'Connected' },
          connecting: { cls: '', text: 'Connecting…' },
          disconnected: { cls: '', text: 'Disconnected' },
          not_configured: { cls: '', text: 'Not configured' },
        };
        var s = statusMap[data.status] || statusMap.disconnected;
        haWsIndicator.className = 'conn-dot small ' + s.cls;
        haWsLabel.textContent = s.text;
      })
      .catch(function () {
        haWsLabel.textContent = 'Unknown';
      });
  }

  // ── Save config ────────────────────────────────────────────
  if (haSaveBtn) {
    haSaveBtn.addEventListener('click', function () {
      var host = haHostInput.value.trim();
      var token = haTokenInput.value.trim();
      var label = haLabelInput.value.trim() || 'glyph';
      if (!host || !token) {
        showToast('Host and token required', 'err');
        return;
      }
      fetch('/api/ha/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host, token: token, labelName: label })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            showToast('Connection saved', 'ok');
            setTimeout(loadWsStatus, 2000);
          } else {
            showToast(data.error || 'Failed to save', 'err');
          }
        })
        .catch(function () { showToast('Network error', 'err'); });
    });
  }

  // ── Render entity table ────────────────────────────────────
  function renderEntityTable() {
    var tbody = haEntityTable && haEntityTable.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!entities || !entities.length) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'log-empty';
      td.textContent = 'No entities configured. Click "Add Entity" or refresh to fetch labeled entities from Home Assistant.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    entities.forEach(function (e, idx) {
      var tr = document.createElement('tr');
      if (!e.enabled) tr.className = 'ha-row-disabled';

      var triggerSummary = '';
      if (e.triggers && e.triggers.length) {
        triggerSummary = e.triggers.map(function (t) {
          return t.operator + ' ' + t.value + ' → ' + (t.glyphStatus || 'notify');
        }).join(', ');
      } else {
        triggerSummary = '<span class="text-muted">none</span>';
      }

      tr.innerHTML =
        '<td>' + escHtml(e.friendly_name || e.entity_id) +
          '<div class="ha-entity-id">' + escHtml(e.entity_id) + '</div>' +
          (e.current_state !== undefined ? '<div class="ha-entity-state">State: <code>' + escHtml(String(e.current_state)) + '</code></div>' : '') +
        '</td>' +
        '<td>' + escHtml(e.domain || '—') + '</td>' +
        '<td>' + escHtml(e.intent || '—') + '</td>' +
        '<td>' + (e.urgency !== undefined ? e.urgency : '0') + '</td>' +
        '<td>' + (e.ttl || 30) + 's</td>' +
        '<td>' + triggerSummary + '</td>' +
        '<td>' + (e.enabled !== false ? '<span class="ha-badge ha-badge-ok">On</span>' : '<span class="ha-badge ha-badge-off">Off</span>') + '</td>' +
        '<td><button class="btn btn-small ha-edit-btn" data-idx="' + idx + '">⚙️</button></td>';
      tbody.appendChild(tr);
    });

    // Attach edit handlers
    tbody.querySelectorAll('.ha-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-idx'));
        openEditModal(entities[idx]);
      });
    });
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ── Refresh entities ───────────────────────────────────────
  function refreshEntities() {
    fetch('/api/ha/entities')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok === false && data.error) {
          showToast(data.error, 'err');
        }
        entities = data.entities || [];
        renderEntityTable();
      })
      .catch(function () {
        showToast('Failed to load entities', 'err');
      });
  }

  if (haRefreshBtn) {
    haRefreshBtn.addEventListener('click', refreshEntities);
  }

  // ── Edit modal ─────────────────────────────────────────────
  function openEditModal(entity) {
    currentEditEntity = JSON.parse(JSON.stringify(entity)); // deep clone
    modalTitle.textContent = 'Edit: ' + (entity.friendly_name || entity.entity_id);
    modalEntityId.value = entity.entity_id;
    modalName.value = entity.friendly_name || '';
    modalDomain.value = entity.domain || '';
    modalDevice.value = entity.device || '';
    modalIntent.value = entity.intent || '';
    modalUrgency.value = String(entity.urgency || 0);
    modalTtl.value = entity.ttl || 30;
    modalEnabled.checked = entity.enabled !== false;
    modalDeleteBtn.style.display = 'inline-flex';
    renderTriggers(currentEditEntity.triggers || []);
    modalOverlay.style.display = 'flex';
  }

  function renderTriggers(triggers) {
    modalTriggers.innerHTML = '';
    if (!triggers || !triggers.length) {
      modalTriggers.innerHTML = '<div class="text-muted" style="padding:8px 0;font-size:0.82rem">No triggers defined. Add one below.</div>';
      return;
    }
    triggers.forEach(function (t, i) {
      var row = document.createElement('div');
      row.className = 'ha-trigger-row';
      row.innerHTML =
        '<select class="ha-trig-type" data-idx="' + i + '">' +
          '<option value="string"' + (t.stateType === 'string' ? ' selected' : '') + '>String</option>' +
          '<option value="number"' + (t.stateType === 'number' ? ' selected' : '') + '>Number</option>' +
        '</select>' +
        '<select class="ha-trig-op" data-idx="' + i + '">' +
          buildOperatorOptions(t.stateType, t.operator) +
        '</select>' +
        '<input class="ha-trig-value" data-idx="' + i + '" value="' + escHtml(String(t.value || '')) + '" placeholder="value" />' +
        '<select class="ha-trig-status" data-idx="' + i + '">' +
          '<option value="done"' + (t.glyphStatus === 'done' ? ' selected' : '') + '>done</option>' +
          '<option value="warning"' + (t.glyphStatus === 'warning' ? ' selected' : '') + '>warning</option>' +
          '<option value="error"' + (t.glyphStatus === 'error' ? ' selected' : '') + '>error</option>' +
          '<option value="critical"' + (t.glyphStatus === 'critical' ? ' selected' : '') + '>critical</option>' +
          '<option value="running"' + (t.glyphStatus === 'running' ? ' selected' : '') + '>running</option>' +
          '<option value="idle"' + (t.glyphStatus === 'idle' ? ' selected' : '') + '>idle</option>' +
          '<option value="listening"' + (t.glyphStatus === 'listening' ? ' selected' : '') + '>listening</option>' +
          '<option value="attention"' + (t.glyphStatus === 'attention' ? ' selected' : '') + '>attention</option>' +
        '</select>' +
        '<button class="btn btn-small ha-btn-danger ha-del-trigger" data-idx="' + i + '">✕</button>';
      modalTriggers.appendChild(row);
    });

    // Update operator options when state type changes
    modalTriggers.querySelectorAll('.ha-trig-type').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var idx = parseInt(sel.getAttribute('data-idx'));
        var opSel = modalTriggers.querySelector('.ha-trig-op[data-idx="' + idx + '"]');
        if (opSel) opSel.innerHTML = buildOperatorOptions(sel.value, '=');
      });
    });

    // Delete trigger
    modalTriggers.querySelectorAll('.ha-del-trigger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-idx'));
        currentEditEntity.triggers.splice(idx, 1);
        renderTriggers(currentEditEntity.triggers);
      });
    });
  }

  function buildOperatorOptions(stateType, selected) {
    var ops = stateType === 'number'
      ? ['=', '!=', '<', '>', '<=', '>=']
      : ['=', '!='];
    return ops.map(function (op) {
      return '<option value="' + op + '"' + (op === selected ? ' selected' : '') + '>' + escHtml(op) + '</option>';
    }).join('');
  }

  // Add trigger
  if (addTriggerBtn) {
    addTriggerBtn.addEventListener('click', function () {
      if (!currentEditEntity) return;
      if (!currentEditEntity.triggers) currentEditEntity.triggers = [];
      currentEditEntity.triggers.push({ stateType: 'string', operator: '=', value: '', glyphStatus: 'done' });
      renderTriggers(currentEditEntity.triggers);
    });
  }

  // Save entity
  if (modalSaveBtn) {
    modalSaveBtn.addEventListener('click', function () {
      if (!currentEditEntity) return;

      // Collect trigger data from the form
      var triggerRows = modalTriggers.querySelectorAll('.ha-trigger-row');
      var triggers = [];
      triggerRows.forEach(function (row) {
        var idx = row.querySelector('.ha-trig-type').getAttribute('data-idx');
        triggers.push({
          stateType: row.querySelector('.ha-trig-type').value,
          operator: row.querySelector('.ha-trig-op').value,
          value: row.querySelector('.ha-trig-value').value,
          glyphStatus: row.querySelector('.ha-trig-status').value,
        });
      });

      var payload = {
        entity_id: modalEntityId.value,
        friendly_name: modalName.value,
        domain: modalDomain.value,
        device: modalDevice.value,
        intent: modalIntent.value,
        urgency: parseInt(modalUrgency.value) || 0,
        ttl: parseInt(modalTtl.value) || 30,
        enabled: modalEnabled.checked,
        triggers: triggers,
      };

      fetch('/api/ha/entity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            showToast('Entity saved', 'ok');
            closeEditModal();
            refreshEntities();
          } else {
            showToast(data.error || 'Failed to save', 'err');
          }
        })
        .catch(function () { showToast('Network error', 'err'); });
    });
  }

  // Delete entity
  if (modalDeleteBtn) {
    modalDeleteBtn.addEventListener('click', function () {
      if (!currentEditEntity) return;
      if (!confirm('Remove this entity from Ummon?')) return;
      var eid = encodeURIComponent(currentEditEntity.entity_id);
      fetch('/api/ha/entity/' + eid, { method: 'DELETE' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data.ok) {
            showToast('Entity removed', 'ok');
            closeEditModal();
            refreshEntities();
          } else {
            showToast(data.error || 'Failed to delete', 'err');
          }
        })
        .catch(function () { showToast('Network error', 'err'); });
    });
  }

  // Cancel / close
  if (modalCancelBtn) {
    modalCancelBtn.addEventListener('click', closeEditModal);
  }
  if (modalOverlay) {
    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) closeEditModal();
    });
  }

  function closeEditModal() {
    modalOverlay.style.display = 'none';
    currentEditEntity = null;
  }

  // ── Add Entity modal ───────────────────────────────────────
  if (haAddBtn) {
    haAddBtn.addEventListener('click', function () {
      addModalOverlay.style.display = 'flex';
      addSearchInput.value = '';
      addEntityList.innerHTML = '<div class="log-empty">Loading entities…</div>';

      fetch('/api/ha/all-entities')
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data.ok) {
            addEntityList.innerHTML = '<div class="log-empty">' + escHtml(data.error || 'Failed to load') + '</div>';
            return;
          }
          // Filter out entities already configured
          var configured = new Set(entities.map(function (e) { return e.entity_id; }));
          allHaEntities = (data.entities || []).filter(function (e) {
            return !configured.has(e.entity_id);
          });
          renderAddEntityList('');
        })
        .catch(function () {
          addEntityList.innerHTML = '<div class="log-empty">Network error</div>';
        });
    });
  }

  function renderAddEntityList(filter) {
    addEntityList.innerHTML = '';
    var lower = (filter || '').toLowerCase();
    var filtered = allHaEntities.filter(function (e) {
      if (!lower) return true;
      return e.entity_id.toLowerCase().indexOf(lower) >= 0 ||
             (e.friendly_name || '').toLowerCase().indexOf(lower) >= 0;
    });

    if (!filtered.length) {
      addEntityList.innerHTML = '<div class="log-empty">No matching entities</div>';
      return;
    }

    // Limit display so the browser doesn't choke
    var shown = filtered.slice(0, 100);
    shown.forEach(function (e) {
      var row = document.createElement('div');
      row.className = 'ha-add-entity-row';
      row.innerHTML =
        '<div class="ha-add-entity-info">' +
          '<strong>' + escHtml(e.friendly_name || e.entity_id) + '</strong>' +
          '<span class="ha-entity-id">' + escHtml(e.entity_id) + '</span>' +
        '</div>' +
        '<button class="btn btn-small btn-primary">Add</button>';
      row.querySelector('button').addEventListener('click', function () {
        addEntity(e);
      });
      addEntityList.appendChild(row);
    });

    if (filtered.length > 100) {
      var more = document.createElement('div');
      more.className = 'log-empty';
      more.textContent = '…and ' + (filtered.length - 100) + ' more. Type to filter.';
      addEntityList.appendChild(more);
    }
  }

  if (addSearchInput) {
    addSearchInput.addEventListener('input', function () {
      renderAddEntityList(addSearchInput.value);
    });
  }

  function addEntity(haEntity) {
    var payload = {
      entity_id: haEntity.entity_id,
      friendly_name: haEntity.friendly_name || haEntity.entity_id,
      domain: '',
      device: '',
      intent: 'notification',
      urgency: 0,
      ttl: 30,
      enabled: true,
      triggers: [],
    };

    fetch('/api/ha/entity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.ok) {
          showToast('Entity added: ' + (haEntity.friendly_name || haEntity.entity_id), 'ok');
          addModalOverlay.style.display = 'none';
          refreshEntities();
        } else {
          showToast(data.error || 'Failed to add', 'err');
        }
      })
      .catch(function () { showToast('Network error', 'err'); });
  }

  if (addModalCancel) {
    addModalCancel.addEventListener('click', function () {
      addModalOverlay.style.display = 'none';
    });
  }
  if (addModalOverlay) {
    addModalOverlay.addEventListener('click', function (e) {
      if (e.target === addModalOverlay) addModalOverlay.style.display = 'none';
    });
  }

  // ── Keyboard shortcut ──────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeEditModal();
      if (addModalOverlay) addModalOverlay.style.display = 'none';
    }
  });

  // ── Auth status check ──────────────────────────────────────
  fetch('/api/auth/status')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.authEnabled) {
        var logoutLink = document.getElementById('logout-link');
        if (logoutLink) logoutLink.style.display = '';
      }
    })
    .catch(function () {});

  // ── Initial load ───────────────────────────────────────────
  loadConfig();
  loadWsStatus();
  refreshEntities();

  // Polling for WS status
  setInterval(loadWsStatus, 15000);

})();
