'use strict';

(() => {
  const VALID_ACTIONS = new Set(['start', 'restart', 'stop']);
  const VALID_SERVICES = new Set(['dnd', 'core', 'all']);
  const ACTIVE_STATES = new Set(['starting', 'running', 'ready', 'stopping']);
  const RUNNING_STATES = new Set(['running', 'ready']);
  const INSTALL_RETRY_MS = 100;
  const MAX_INSTALL_ATTEMPTS = 300;
  const POLL_INTERVAL_MS = 5000;
  const byId = (id) => document.getElementById(id);
  const serviceCache = new Map();
  const bundleCache = new Map();
  let busy = false;
  let installed = false;
  let installAttempts = 0;
  let installTimer = null;
  let pollTimer = null;
  let refreshInFlight = null;

  function toast(message) {
    const element = byId('toast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 4200);
  }

  function serviceState(payload, key) {
    return payload?.services?.find((service) => service.key === key) || { key, status: 'stopped', error: '' };
  }

  function bundleState(payload, key) {
    return payload?.bundles?.[key] || { key, status: 'unknown', error: 'Bundle health has not been reported yet.' };
  }

  function statusTone(status) {
    const value = String(status || '').toLowerCase();
    if (RUNNING_STATES.has(value) || value === 'ready') return 'good';
    if (['failed', 'missing', 'invalid', 'corrupt', 'blocked'].includes(value)) return 'bad';
    return '';
  }

  function bundleReady(key) {
    return String(bundleCache.get(key)?.status || '').toLowerCase() === 'ready';
  }

  function controlDisabled(button) {
    const action = button.dataset.aiAction;
    const service = button.dataset.aiService;
    if (busy || !VALID_ACTIONS.has(action) || !VALID_SERVICES.has(service)) return true;
    if (service === 'all') {
      const states = ['dnd', 'core'].map((key) => String(serviceCache.get(key)?.status || 'stopped').toLowerCase());
      const readyBundles = ['dnd', 'core'].filter(bundleReady);
      const allWorkerStatesActive = states.every((state) => ACTIVE_STATES.has(state));
      if (action === 'start') {
        if (!readyBundles.length) return true;
        if (readyBundles.length === states.length) return allWorkerStatesActive;
        return states.every((state, index) => !readyBundles.includes(['dnd', 'core'][index]) || ACTIVE_STATES.has(state));
      }
      if (action === 'restart') return !states.some((state) => RUNNING_STATES.has(state));
      return !states.some((state) => ACTIVE_STATES.has(state));
    }
    const status = String(serviceCache.get(service)?.status || 'stopped').toLowerCase();
    if (action === 'start') return !bundleReady(service) || ACTIVE_STATES.has(status);
    if (action === 'restart') return !bundleReady(service) || !RUNNING_STATES.has(status);
    return !ACTIVE_STATES.has(status);
  }

  function syncControls() {
    document.querySelectorAll('[data-ai-action][data-ai-service]').forEach((button) => {
      button.disabled = controlDisabled(button);
      button.setAttribute('aria-busy', busy ? 'true' : 'false');
    });
  }

  function updateCard(key, service, bundle) {
    serviceCache.set(key, service);
    bundleCache.set(key, bundle);
    const prefix = key === 'dnd' ? 'dndAi' : 'nexusAi';
    const badge = byId(`${prefix}ServiceBadge`);
    const runtime = byId(`${prefix}ServiceRuntime`);
    const bundleStatus = String(bundle?.status || 'unknown').toLowerCase();
    const blocked = bundleStatus !== 'ready' && !ACTIVE_STATES.has(String(service.status || '').toLowerCase());
    if (badge) {
      badge.textContent = blocked ? `bundle ${bundleStatus}` : service.status || 'stopped';
      badge.className = `tag ${statusTone(blocked ? bundleStatus : service.status)}`.trim();
    }
    if (runtime) {
      runtime.textContent = blocked
        ? `Bundle: ${bundle?.error || 'Packaged AI resource is unavailable.'}`
        : service.error
          ? `Error: ${service.error}`
          : service.endpoint || (service.version ? `Version ${service.version}` : bundle?.version ? `Bundle ${bundle.version} • verified on start` : 'Bundled / isolated');
    }
  }

  async function refresh({ force = false } = {}) {
    if (!force && document.hidden) return;
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const payload = await window.khaos.invoke('ai:runtimes-status');
        updateCard('dnd', serviceState(payload, 'dnd'), bundleState(payload, 'dnd'));
        updateCard('core', serviceState(payload, 'core'), bundleState(payload, 'core'));
      } catch (error) {
        const failed = { status: 'failed', error: error?.message || 'Unable to read agent status.' };
        updateCard('dnd', failed, { status: 'unknown', error: failed.error });
        updateCard('core', failed, { status: 'unknown', error: failed.error });
      } finally {
        syncControls();
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  function labelFor(service) {
    return service === 'all' ? 'Khaos Nexus AI Runtime' : service === 'dnd' ? 'Veyra' : 'Nexus Sentinel';
  }

  async function perform(action, service) {
    if (busy || !VALID_ACTIONS.has(action) || !VALID_SERVICES.has(service)) return;
    if (action !== 'stop' && service !== 'all' && !bundleReady(service)) {
      const bundle = bundleCache.get(service);
      return toast(bundle?.error || `${labelFor(service)} bundle is not ready.`);
    }
    busy = true;
    syncControls();
    try {
      await window.khaos.invoke(`ai:runtimes-${action}`, { service });
      toast(`${labelFor(service)} ${action} requested.`);
    } catch (error) {
      toast(error?.message || `Unable to ${action} AI agent.`);
      window.khaos?.reportRendererActionError?.({
        source: 'ai-runtime-controls',
        operation: `${action}-${service}`,
        message: error?.message || `Unable to ${action} AI agent.`
      });
    } finally {
      busy = false;
      await refresh({ force: true });
    }
  }

  function controls(key) {
    return `<div class="nexus-inline-actions ai-runtime-actions" aria-label="AI agent controls">
      <button class="button primary" type="button" data-ai-action="start" data-ai-service="${key}">Start</button>
      <button class="button" type="button" data-ai-action="restart" data-ai-service="${key}">Restart</button>
      <button class="button" type="button" data-ai-action="stop" data-ai-service="${key}">Stop</button>
    </div>`;
  }

  function aiWorkspaceActive() {
    return Boolean(byId('view-ai')?.classList.contains('active'));
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function startPolling() {
    if (pollTimer || document.hidden || !aiWorkspaceActive()) return;
    pollTimer = setInterval(() => refresh(), POLL_INTERVAL_MS);
  }

  function handleVisibilityChange() {
    if (document.hidden || !aiWorkspaceActive()) stopPolling();
    else {
      refresh({ force: true });
      startPolling();
    }
  }

  function handleNavigationChange(event) {
    if (!event.target?.closest?.('[data-view], [data-view-link]')) return;
    setTimeout(() => {
      if (!aiWorkspaceActive()) return stopPolling();
      refresh({ force: true });
      startPolling();
    }, 0);
  }

  function reportInstallFailure() {
    window.khaos?.reportRendererActionError?.({
      source: 'ai-runtime-controls',
      operation: 'install-controls',
      message: 'The AI agent cards did not become available before the lifecycle control installation timeout.'
    });
  }

  function install() {
    if (installed) return;
    const dndCard = document.querySelector('.service-dnd-ai');
    const coreCard = document.querySelector('.service-core-ai');
    if (!dndCard || !coreCard) {
      installAttempts += 1;
      if (installAttempts >= MAX_INSTALL_ATTEMPTS) {
        reportInstallFailure();
        return;
      }
      installTimer = setTimeout(install, INSTALL_RETRY_MS);
      return;
    }
    installed = true;
    clearTimeout(installTimer);
    installTimer = null;

    if (!document.querySelector('.ai-runtime-actions')) {
      dndCard.insertAdjacentHTML('beforeend', controls('dnd'));
      coreCard.insertAdjacentHTML('beforeend', controls('core'));
    }

    const heroButton = document.querySelector('.nexus-ai-hero [data-khaos-open="ai"]');
    if (heroButton) {
      heroButton.removeAttribute('data-khaos-open');
      heroButton.dataset.aiAction = 'start';
      heroButton.dataset.aiService = 'all';
      heroButton.textContent = 'Start Khaos Nexus AI Runtime · Available Workers';
    }

    document.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-ai-action][data-ai-service]');
      if (!button) return;
      const action = String(button.dataset.aiAction || '').toLowerCase();
      const service = String(button.dataset.aiService || '').toLowerCase();
      if (!VALID_ACTIONS.has(action) || !VALID_SERVICES.has(service)) return;
      event.preventDefault();
      event.stopPropagation();
      perform(action, service);
    });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('click', handleNavigationChange);

    refresh({ force: true });
    startPolling();
    window.addEventListener('beforeunload', () => {
      clearTimeout(installTimer);
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('click', handleNavigationChange);
    }, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
