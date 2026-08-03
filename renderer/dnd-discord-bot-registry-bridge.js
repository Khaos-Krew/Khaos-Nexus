'use strict';

(function bootstrapDndBotRegistryBridge(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndBotRegistryBridgeFactory() {
  const RECONCILE_DELAYS = Object.freeze([0, 100, 500, 1500, 4000]);

  function selectDefaultApp(apps, currentId = '') {
    const list = Array.isArray(apps) ? apps : [];
    if (currentId && list.some((item) => item.id === currentId)) return currentId;
    return list.find((item) => item.enabled !== false && item.hasToken)?.id
      || list.find((item) => item.enabled !== false)?.id
      || list[0]?.id
      || '';
  }

  function mergedApps(payload, response) {
    const direct = Array.isArray(response?.registeredApps) ? response.registeredApps : [];
    if (direct.length) return direct;
    const topLevel = Array.isArray(payload?.registeredApps) ? payload.registeredApps : [];
    if (topLevel.length) return topLevel;
    return Array.isArray(payload?.state?.registeredApps) ? payload.state.registeredApps : [];
  }

  function install(win) {
    if (!win?.document || win.__khaosDndBotRegistryBridge) return win?.__khaosDndBotRegistryBridge || null;
    const doc = win.document;
    let syncing = false;
    let disconnected = false;
    const timers = new Set();

    function provisioningApi() {
      return win.__khaosDndDiscordProvisioning || null;
    }

    function openDiscordSetup() {
      const original = doc.querySelector('.sidebar .nav-item[data-view="setup"]');
      if (original) original.click();
      else if (typeof win.showView === 'function') win.showView('setup');
    }

    function statusMarkup(apps, primaryBotConfigured) {
      if (!apps.length) {
        return '<div class="callout bad" id="dndProvisionBotRegistryStatus"><strong>No Discord bot is available</strong><span>Configure the primary Nexus bot, then return here and refresh the bot list.</span><div class="form-actions"><button type="button" class="button primary" data-dnd-bot-registry-action="setup">Open Discord Setup</button><button type="button" class="button" data-dnd-bot-registry-action="refresh">Refresh Bot List</button></div></div>';
      }
      if (!apps.some((item) => item.hasToken)) {
        return `<div class="callout warning" id="dndProvisionBotRegistryStatus"><strong>${primaryBotConfigured ? 'The primary Nexus bot token is not available to D&D' : 'The registered bot token is missing'}</strong><span>Save the protected Discord bot token in Discord Setup. Tokens are never returned to this screen.</span><div class="form-actions"><button type="button" class="button primary" data-dnd-bot-registry-action="setup">Open Discord Setup</button><button type="button" class="button" data-dnd-bot-registry-action="refresh">Refresh Bot List</button></div></div>`;
      }
      return '';
    }

    function renderStatus(apps, response) {
      const shell = doc.getElementById('dndDiscordProvisioning');
      const createPanel = shell?.querySelector('.dnd-provision-create');
      if (!createPanel) return;
      createPanel.querySelector('#dndProvisionBotRegistryStatus')?.remove();
      const markup = statusMarkup(apps, Boolean(response?.primaryBotConfigured));
      if (markup) createPanel.insertAdjacentHTML('afterbegin', markup);
    }

    async function sync() {
      if (disconnected || syncing || !win.khaos?.invoke) return false;
      const api = provisioningApi();
      if (!api?.state) return false;
      syncing = true;
      try {
        const response = await win.khaos.invoke('dnd-provision:apps');
        const payload = api.state.payload || { state: {} };
        payload.state ||= {};
        const apps = mergedApps(payload, response);
        payload.registeredApps = apps;
        payload.state.registeredApps = apps;
        api.state.payload = payload;

        const appId = selectDefaultApp(apps, api.state.draft?.appId || '');
        if (api.state.draft) {
          api.state.draft.appId = appId;
          const app = apps.find((item) => item.id === appId);
          if (!api.state.draft.guildId) {
            api.state.draft.guildId = app?.guildIds?.[0] || response?.primaryGuildId || '';
          }
        }

        api.enhance?.();
        renderStatus(apps, response);
        return true;
      } catch (error) {
        const shell = doc.getElementById('dndDiscordProvisioning');
        const createPanel = shell?.querySelector('.dnd-provision-create');
        if (createPanel) {
          createPanel.querySelector('#dndProvisionBotRegistryStatus')?.remove();
          createPanel.insertAdjacentHTML('afterbegin', `<div class="callout bad" id="dndProvisionBotRegistryStatus"><strong>Bot list could not be loaded</strong><span>${String(error.message || error).replace(/[&<>"']/g, '')}</span><div class="form-actions"><button type="button" class="button" data-dnd-bot-registry-action="refresh">Retry</button></div></div>`);
        }
        return false;
      } finally {
        syncing = false;
      }
    }

    function schedule(delay = 0) {
      const timer = win.setTimeout(async () => {
        timers.delete(timer);
        await sync();
      }, delay);
      timers.add(timer);
    }

    function onClick(event) {
      const action = event.target?.closest?.('[data-dnd-bot-registry-action]')?.dataset.dndBotRegistryAction;
      if (action === 'setup') {
        event.preventDefault();
        openDiscordSetup();
        return;
      }
      if (action === 'refresh') {
        event.preventDefault();
        schedule();
        return;
      }
      if (event.target?.closest?.('[data-dnd-tab="discord"]')) schedule(25);
    }

    doc.addEventListener('click', onClick, true);
    const unsubscribe = win.khaos?.onDnd?.(() => schedule(25));
    for (const delay of RECONCILE_DELAYS) schedule(delay);

    const api = {
      sync,
      selectDefaultApp,
      mergedApps,
      disconnect() {
        disconnected = true;
        for (const timer of timers) win.clearTimeout(timer);
        timers.clear();
        doc.removeEventListener('click', onClick, true);
        if (typeof unsubscribe === 'function') unsubscribe();
        doc.getElementById('dndProvisionBotRegistryStatus')?.remove();
        delete win.__khaosDndBotRegistryBridge;
      }
    };
    win.__khaosDndBotRegistryBridge = api;
    return api;
  }

  return {
    RECONCILE_DELAYS,
    selectDefaultApp,
    mergedApps,
    install
  };
});
