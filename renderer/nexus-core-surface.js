'use strict';

(() => {
  if (window.__khaosNexusCoreSurfaceInstalled) return;
  window.__khaosNexusCoreSurfaceInstalled = true;

  let latestState = null;

  function ensureSurface() {
    const settings = document.querySelector('#view-settings .settings-list');
    if (!settings || document.getElementById('nexusCoreSurface')) return;

    const surface = document.createElement('div');
    surface.id = 'nexusCoreSurface';
    surface.innerHTML = `
      <div class="form-grid nexus-core-surface-grid">
        <label>Update channel
          <select id="nexusUpdateChannel">
            <option value="stable">Stable</option>
            <option value="test">Test / Beta</option>
          </select>
          <small>Test / Beta is opt-in and may receive prerelease builds. Stable remains the default.</small>
        </label>
        <div class="callout" id="nexusCoreHealth">Nexus Core: starting</div>
      </div>`;

    const actions = settings.querySelector('.form-actions');
    if (actions) settings.insertBefore(surface, actions);
    else settings.appendChild(surface);

    const select = document.getElementById('nexusUpdateChannel');
    select.addEventListener('change', async () => {
      const value = select.value === 'test' ? 'test' : 'stable';
      select.disabled = true;
      try {
        await window.khaos.invoke('config:save-general', { updateChannel: value });
        const state = await window.khaos.invoke('app:get-state');
        applyState(state);
      } catch (error) {
        select.value = latestState?.config?.general?.updateChannel === 'test' ? 'test' : 'stable';
        const health = document.getElementById('nexusCoreHealth');
        if (health) health.textContent = `Update channel change failed: ${error.message || error}`;
      } finally {
        select.disabled = false;
      }
    });
  }

  function applyState(state) {
    if (!state) return;
    latestState = state;
    ensureSurface();

    const select = document.getElementById('nexusUpdateChannel');
    if (select && !select.disabled) select.value = state.config?.general?.updateChannel === 'test' ? 'test' : 'stable';

    const core = state.config?.nexusCore;
    const health = document.getElementById('nexusCoreHealth');
    if (health) {
      if (!core) {
        health.textContent = 'Nexus Core: starting';
      } else {
        const registry = core.registry || {};
        const journal = core.journal || {};
        const circuits = (core.workers || []).filter((worker) => worker.circuitOpen).length;
        health.textContent = `Nexus Core: ${core.status || 'unknown'} · ${registry.actions || 0} actions · ${registry.tools || 0} AI tools · ${journal.records || 0} journal events${circuits ? ` · ${circuits} worker circuit(s) open` : ''}`;
      }
    }
  }

  function bindHub() {
    if (!window.khaosStateHub?.subscribe) return false;
    window.khaosStateHub.subscribe(applyState, { replay: true });
    return true;
  }

  if (!bindHub()) window.addEventListener('khaos:state-hub-ready', bindHub, { once: true });
  document.addEventListener('DOMContentLoaded', ensureSurface, { once: true });
  ensureSurface();
})();
