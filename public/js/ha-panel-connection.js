// ha-panel-connection.js
// Replaces connection test logic in ha-panel.js for step-by-step diagnostics


document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  var haTestBtn = document.getElementById('btn-ha-test');
  var haConnStatus = document.getElementById('ha-conn-status');
  var haHostInput = document.getElementById('ha-host');
  var haTokenInput = document.getElementById('ha-token');

  function setTestStatus(msg) {
    if (msg.startsWith('<ul')) {
      haConnStatus.innerHTML = msg;
    } else {
      haConnStatus.innerText = msg;
    }
  }

  async function testConnection() {
    var host = haHostInput.value.trim();
    var token = haTokenInput.value.trim();
    setTestStatus('Testing...');
    try {
      var res = await fetch('/api/ha/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: host, token: token })
      });
      var data = await res.json();
      if (data.steps && Array.isArray(data.steps)) {
        var html = '<ul style="margin:0;padding-left:1.2em">';
        for (var i = 0; i < data.steps.length; ++i) {
          var step = data.steps[i];
          html += '<li><b>' + step.step + ':</b> <span style="color:' + (step.status === 'success' ? 'green' : 'red') + '">' + step.status + '</span>';
          if (step.error) html += ' <span style="color:#a00">(' + step.error + ')</span>';
          html += '</li>';
        }
        html += '</ul>';
        setTestStatus(html);
      } else if (data.ok) {
        setTestStatus('Connection successful!');
      } else {
        setTestStatus('Failed: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      setTestStatus('Error: ' + err.message);
    }
  }

  if (haTestBtn) {
    haTestBtn.addEventListener('click', testConnection);
  }
});
