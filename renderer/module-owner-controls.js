'use strict';

(() => {
  if (window.__khaosModuleOwnerControlsInstalled) return;
  window.__khaosModuleOwnerControlsInstalled = true;

  const DELAYS = Object.freeze([100, 400, 900, 1800, 3500]);

  function notify(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = String(message || 'Module controls updated.');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  async function applyMode(mode, confirmation) {
    if (confirmation && !window.confirm(confirmation)) return;
    try {
      const payload = await window.khaos.invoke('modules:bulk-update', mode);
      window.khaosModuleRuntime?.applyPayload?.(payload);
      document.getElementById('moduleRefreshButton')?.click();
      window.dispatchEvent(new CustomEvent('khaos:modules-refresh'));
      notify(mode === 'validated' ? 'All validated modules are enabled.' : mode === 'safe-mode' ? 'Safe mode is active.' : 'Optional modules are disabled.');
    } catch (error) {
      notify(error.message || String(error));
    }
  }

  function ensureControls(payload = window.khaosModuleRuntime?.getPayload?.()) {
    const actions = document.querySelector('.module-hero-actions');
    if (!actions || document.getElementById('moduleOwnerControlGroup')) return false;
    if (!payload?.ownerControls) return false;

    const group = document.createElement('div');
    group.id = 'moduleOwnerControlGroup';
    group.className = 'module-owner-control-group';
    group.innerHTML = `
      <div class="module-owner-control-copy"><strong>Owner runtime switches</strong><span>Disabled modules are removed from navigation and their protected actions are blocked until you re-enable them.</span></div>
      <div class="module-owner-control-actions">
        <button class="button" data-module-owner-control="disable-optional">Disable All</button>
        <button class="button" data-module-owner-control="safe-mode">Safe Mode</button>
        <button class="button primary" data-module-owner-control="validated">Enable Validated</button>
      </div>`;
    actions.insertAdjacentElement('afterend', group);

    group.addEventListener('click', (event) => {
      const button = event.target.closest('[data-module-owner-control]');
      if (!button) return;
      const mode = button.dataset.moduleOwnerControl;
      if (mode === 'validated') applyMode(mode, 'Enable every fully implemented and validated module? Planned modules will remain unavailable.');
      else if (mode === 'safe-mode') applyMode(mode, 'Enter Safe Mode? Discord, game-server and optional automation modules will be disabled while diagnostics and backups remain available.');
      else applyMode(mode, 'Disable every optional module? The Modules workspace will remain available so you can re-enable them later.');
    });
    return true;
  }

  window.addEventListener('khaos:module-runtime-applied', (event) => ensureControls(event.detail));
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-view="modules"], [data-view-link="modules"]')) {
      for (const delay of DELAYS) setTimeout(() => ensureControls(), delay);
    }
  });
  for (const delay of DELAYS) setTimeout(() => ensureControls(), delay);
})();