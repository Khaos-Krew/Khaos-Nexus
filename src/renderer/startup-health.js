'use strict';

(() => {
  const api = window.nexusAdmin;
  if (!api?.startupHealth) return;

  const overlay = document.createElement('div');
  overlay.className = 'startup-health-overlay';
  overlay.innerHTML = `
    <div class="startup-health-panel">
      <div class="startup-health-brand">KHAOS NEXUS</div>
      <h1>Starting Admin Control Center…</h1>
      <p id="startupHealthSummary">Checking local services and private integrations.</p>
      <div id="startupHealthItems" class="startup-health-items"></div>
      <div class="startup-health-actions"><button id="startupContinue" class="secondary" hidden>Continue to Nexus</button></div>
    </div>`;
  document.body.appendChild(overlay);

  const itemsRoot = overlay.querySelector('#startupHealthItems');
  const summary = overlay.querySelector('#startupHealthSummary');
  const continueButton = overlay.querySelector('#startupContinue');
  let attempts = 0;
  let closed = false;

  const symbols = { ready: '✓', warning: '!', failed: '×', waiting: '…', skipped: '–' };
  function render(result) {
    itemsRoot.innerHTML = (result.items || []).map((item) => `
      <div class="startup-health-item ${item.state || 'waiting'}">
        <span class="startup-health-symbol">${symbols[item.state] || '…'}</span>
        <div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail || '')}</small></div>
      </div>`).join('');
    summary.textContent = result.ready ? 'Core services are ready.' : 'Nexus is still checking the local backend.';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function close() {
    if (closed) return;
    closed = true;
    overlay.classList.add('leaving');
    setTimeout(() => overlay.remove(), 260);
  }

  continueButton.onclick = close;

  async function poll() {
    if (closed) return;
    attempts += 1;
    try {
      const result = await api.startupHealth();
      render(result);
      if (result.ready) return setTimeout(close, 700);
    } catch (error) {
      summary.textContent = `Startup health check failed: ${error.message || error}`;
    }
    if (attempts >= 12) {
      summary.textContent = 'Nexus is taking longer than expected. You can continue to diagnostics without waiting.';
      continueButton.hidden = false;
      return;
    }
    setTimeout(poll, 650);
  }

  poll();
})();
