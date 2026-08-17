'use strict';

(() => {
  if (window.__khaosModuleRuntimeInstalled) return;
  window.__khaosModuleRuntimeInstalled = true;

  const state = { payload: null, timers: new Set(), refreshing: false, botStatus: 'stopped' };
  const DELAYS = Object.freeze([0, 200, 600, 1200, 2500, 5000]);

  function notify(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = String(message || 'That module is disabled.');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function decisionEnabled(decision) {
    if (!decision) return true;
    const runtime = state.payload?.runtime || {};
    const allOf = Array.isArray(decision.allOf) ? decision.allOf : [];
    const anyOf = Array.isArray(decision.anyOf) ? decision.anyOf : [];
    if (allOf.some((id) => !runtime[id]?.effectiveEnabled)) return false;
    if (anyOf.length && !anyOf.some((id) => runtime[id]?.effectiveEnabled)) return false;
    return true;
  }

  function viewEnabled(view) {
    return decisionEnabled(state.payload?.viewRules?.[view]);
  }

  function reasonForModule(id) {
    const module = state.payload?.catalog?.find((item) => item.id === id);
    const runtime = state.payload?.runtime?.[id];
    if (!module || !runtime) return 'This module is unavailable.';
    if (runtime.reason === 'not-implemented') return `${module.name} is inventoried but not implemented yet.`;
    if (runtime.reason === 'dependency-disabled') {
      const names = runtime.blockedBy.map((dependency) => state.payload?.catalog?.find((item) => item.id === dependency)?.name || dependency);
      return `${module.name} is blocked because ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} disabled.`;
    }
    return `${module.name} is disabled by the owner.`;
  }

  function reasonForView(view) {
    const decision = state.payload?.viewRules?.[view];
    const ids = [...(decision?.allOf || []), ...(decision?.anyOf || [])];
    const blocked = ids.find((id) => !state.payload?.runtime?.[id]?.effectiveEnabled);
    return reasonForModule(blocked || ids[0]);
  }

  function markTarget(target, enabled, reason) {
    if (!target) return;
    target.classList.toggle('nexus-module-disabled-target', !enabled);
    target.toggleAttribute('hidden', !enabled);
    target.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    if (!enabled) target.dataset.moduleDisabledReason = reason || 'This module is disabled.';
    else delete target.dataset.moduleDisabledReason;
  }

  function applyViewRules() {
    const rules = state.payload?.viewRules || {};
    for (const target of document.querySelectorAll('[data-view], [data-view-link]')) {
      const view = target.dataset.view || target.dataset.viewLink;
      if (!rules[view]) continue;
      markTarget(target, viewEnabled(view), reasonForView(view));
    }
    for (const [view] of Object.entries(rules)) {
      const section = document.getElementById(`view-${view}`);
      if (section) markTarget(section, viewEnabled(view), reasonForView(view));
    }

    const active = document.querySelector('.view.active');
    const activeView = String(active?.id || '').replace(/^view-/, '');
    if (active && rules[activeView] && !viewEnabled(activeView)) {
      document.querySelector('[data-view="modules"], [data-view-link="modules"]')?.click();
      notify(reasonForView(activeView));
    }
  }

  function applyDashboardControls() {
    const moduleEnabled = Boolean(state.payload?.runtime?.['discord-runtime']?.effectiveEnabled);
    const status = state.botStatus || 'stopped';
    const desired = {
      startButton: ['starting', 'connecting', 'online', 'restarting'].includes(status),
      restartButton: ['stopped', 'stopping'].includes(status),
      stopButton: ['stopped', 'stopping'].includes(status),
      saveAndStartButton: false
    };
    for (const [id, supervisorDisabled] of Object.entries(desired)) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.disabled = !moduleEnabled || supervisorDisabled;
      button.title = moduleEnabled ? '' : reasonForModule('discord-runtime');
      button.dataset.moduleRuntimeGate = moduleEnabled ? 'enabled' : 'disabled';
    }
  }

  function decorateModuleCards() {
    const catalog = state.payload?.catalog || [];
    for (const module of catalog) {
      const runtime = state.payload?.runtime?.[module.id];
      const card = document.querySelector(`[data-module-id="${CSS.escape(module.id)}"]`);
      const badge = card?.querySelector('.module-enabled-state');
      if (badge && runtime) {
        badge.classList.toggle('enabled', runtime.effectiveEnabled);
        badge.classList.toggle('blocked', runtime.requestedEnabled && !runtime.effectiveEnabled);
        badge.textContent = runtime.effectiveEnabled ? 'Running'
          : runtime.reason === 'not-implemented' ? 'Not implemented'
            : runtime.reason === 'dependency-disabled' ? 'Blocked'
              : 'Disabled';
        badge.title = runtime.effectiveEnabled ? 'This module is active.' : reasonForModule(module.id);
      }
      for (const open of document.querySelectorAll(`[data-module-open="${CSS.escape(module.id)}"]`)) {
        open.disabled = !runtime?.effectiveEnabled;
        open.title = runtime?.effectiveEnabled ? '' : reasonForModule(module.id);
        open.classList.toggle('module-open-disabled', !runtime?.effectiveEnabled);
      }
    }

    const selectedId = document.querySelector('.nexus-module-card.selected')?.dataset.moduleId;
    const selected = catalog.find((module) => module.id === selectedId);
    const toggle = document.getElementById('moduleToggleButton');
    if (toggle && selected) {
      const cannotEnable = selected.availability === 'planned' && selected.state?.enabled !== true;
      toggle.disabled = cannotEnable;
      toggle.title = cannotEnable ? `${selected.name} has no runnable desktop implementation yet.` : '';
      toggle.textContent = cannotEnable ? 'Not Implemented' : (selected.state?.enabled ? 'Disable Module' : 'Enable Module');
    }
  }

  function applyPayload(payload) {
    if (!payload || !Array.isArray(payload.catalog)) return;
    state.payload = payload;
    const metric = document.getElementById('metricModules');
    if (metric) metric.textContent = String(payload.summary?.enabled || 0);
    applyViewRules();
    applyDashboardControls();
    decorateModuleCards();
    document.body.classList.toggle('nexus-owner-module-control', Boolean(payload.ownerControls));
    window.dispatchEvent(new CustomEvent('khaos:module-runtime-applied', { detail: payload }));
  }

  async function refresh() {
    if (state.refreshing) return state.payload;
    state.refreshing = true;
    try {
      const [payload, appState] = await Promise.all([
        window.khaos.invoke('modules:get'),
        window.khaos.invoke('app:get-state').catch(() => null)
      ]);
      if (appState?.bot?.status) state.botStatus = appState.bot.status;
      applyPayload(payload);
      return payload;
    } catch (error) {
      const text = String(error?.message || error || '');
      if (!/requires viewer access|authorized Discord account|access_denied/i.test(text)) console.warn('[Khaos Nexus] Module runtime refresh failed.', error);
      return state.payload;
    } finally {
      state.refreshing = false;
    }
  }

  function scheduleApply() {
    for (const timer of state.timers) clearTimeout(timer);
    state.timers.clear();
    for (const delay of DELAYS) {
      const timer = setTimeout(() => {
        state.timers.delete(timer);
        if (state.payload) {
          const metric = document.getElementById('metricModules');
          if (metric) metric.textContent = String(state.payload.summary?.enabled || 0);
          applyViewRules();
          applyDashboardControls();
          decorateModuleCards();
        }
      }, delay);
      state.timers.add(timer);
    }
  }

  function onAppState(next) {
    if (next?.bot?.status) state.botStatus = next.bot.status;
    setTimeout(() => {
      applyDashboardControls();
      refresh().then(scheduleApply);
    }, 100);
  }

  function bindStateHub() {
    if (!window.khaosStateHub?.subscribe) return false;
    window.khaosStateHub.subscribe(onAppState, { replay: true });
    return true;
  }

  document.addEventListener('click', (event) => {
    const blocked = event.target.closest('.nexus-module-disabled-target, .module-open-disabled');
    if (blocked) {
      event.preventDefault();
      event.stopImmediatePropagation();
      notify(blocked.dataset.moduleDisabledReason || blocked.title || 'That module is disabled.');
      return;
    }
    if (event.target.closest('#moduleToggleButton, [data-module-owner-control], [data-view="modules"], [data-view-link="modules"], [data-module-details], [data-module-id]')) {
      setTimeout(() => refresh().then(scheduleApply), 250);
    }
  }, true);

  window.addEventListener('khaos:modules-refresh', () => refresh().then(scheduleApply));
  if (!bindStateHub()) window.addEventListener('khaos:state-hub-ready', bindStateHub, { once: true });

  window.khaosModuleRuntime = {
    refresh,
    applyPayload,
    scheduleApply,
    moduleEnabled: (id) => Boolean(state.payload?.runtime?.[id]?.effectiveEnabled),
    getPayload: () => state.payload
  };

  refresh().then(scheduleApply);
})();