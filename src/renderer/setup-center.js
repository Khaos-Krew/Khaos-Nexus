'use strict';

(() => {
  const api = window.nexusAdmin;
  const nav = document.querySelector('nav');
  const content = document.getElementById('content');
  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const refresh = document.getElementById('refresh');
  if (!api || !nav || !content) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let active = false;
  let busy = false;

  const setupButton = document.createElement('button');
  setupButton.textContent = 'Setup Center';
  setupButton.dataset.setupCenter = 'true';
  nav.insertBefore(setupButton, nav.children[1] || null);

  const badge = (label, kind = '') => `<span class="badge ${kind}">${esc(label)}</span>`;
  const status = (done, partial = false) => done ? badge('Ready', 'good') : partial ? badge('In progress', 'warn') : badge('Needs setup', 'warn');

  function open(selector) {
    active = false;
    const button = nav.querySelector(selector);
    if (button) button.click();
  }

  function step(number, name, detail, ready, partial, actionLabel, selector, extra = '') {
    return `<article class="setup-step ${ready ? 'done' : partial ? 'partial' : ''}">
      <div class="setup-step-number">${number}</div>
      <div class="setup-step-body"><div class="setup-step-head"><h3>${esc(name)}</h3>${status(ready, partial)}</div><p>${esc(detail)}</p>${extra}</div>
      <div class="setup-step-action"><button class="${ready ? 'secondary' : 'primary'}" data-setup-open="${esc(selector)}">${esc(actionLabel)}</button></div>
    </article>`;
  }

  async function snapshot() {
    const appState = await api.state();
    let scan = null;
    let scanError = '';
    if (typeof api.sentinalScan === 'function') {
      try { scan = await api.sentinalScan(); }
      catch (error) { scanError = error.message || String(error); }
    }
    return { appState, scan, scanError };
  }

  async function render() {
    if (!active || busy) return;
    busy = true;
    title.textContent = 'Setup Center';
    subtitle.textContent = 'Configure Khaos Nexus in the recommended order';
    document.querySelectorAll('nav button').forEach((item) => item.classList.toggle('active', item === setupButton));
    content.innerHTML = '<article class="card"><p>Checking setup readiness…</p></article>';

    try {
      const { appState, scan, scanError } = await snapshot();
      if (!active) return;
      const sections = scan?.sections || {};
      const sentinal = sections.status || appState.sentinal?.sentinal || appState.sentinal || {};
      const accounts = appState.accounts?.accounts || [];
      const discovery = sections.rankDiscovery || null;
      const permissions = sections.permissions || null;
      const channels = sections.channels || null;
      const providerConfig = sections.providerConfig || null;
      const localEnabledModules = (appState.modules?.modules || []).filter((item) => item.enabled);
      const hostedModules = providerConfig?.backendModules || [];
      const hostedEnabledModules = hostedModules.filter((item) => item.enabled !== false);
      const hostedConfiguredModules = hostedEnabledModules.filter((item) => item.configured);
      const hostedConnectedModules = hostedEnabledModules.filter((item) => item.connected);
      const validations = Object.values(providerConfig?.lastValidations || {});
      const passedValidations = validations.filter((item) => item?.ok === true);

      const backendReady = Boolean(appState.backend?.ok);
      const sentinalReady = Boolean(sentinal.discordReady || scan?.ok);
      const accountReady = accounts.length > 0;
      const rankReady = Boolean(discovery && Number(discovery.counts?.attention || 0) === 0);
      const rankPartial = Boolean(discovery && (discovery.counts?.discoveredRoles || discovery.counts?.discoveredSkus));
      const discordReady = Boolean(permissions?.ok && channels?.ok !== false);
      const discordPartial = Boolean(permissions || channels);
      const providerSynced = Boolean(providerConfig?.configured);
      const providersReady = providerSynced && hostedEnabledModules.length > 0 && hostedConfiguredModules.length === hostedEnabledModules.length;
      const providersPartial = providerSynced || hostedConfiguredModules.length > 0;
      const validationReady = passedValidations.length > 0;
      const validationPartial = validations.length > 0 && !validationReady;
      const completeCount = [backendReady, sentinalReady, accountReady, rankReady, discordReady, providersReady, validationReady].filter(Boolean).length;

      const rankDetail = discovery
        ? `${discovery.counts?.attention || 0} rank mappings still need attention. Discovery supports recurring and lifetime SKUs together.`
        : 'Pair Sentinal first, then let Nexus discover Discord rank roles and Premium App SKUs automatically.';
      const providerDetail = providerConfig
        ? providerSynced
          ? `${hostedConfiguredModules.length}/${hostedEnabledModules.length} enabled hosted modules have a provider; ${hostedConnectedModules.length} currently report live.`
          : 'Hosted provider settings have not been synchronized yet. Save local module settings and Credentials, then use Sync to Hosted Sentinal.'
        : 'Pair Hosted Sentinal first. Provider configuration must be synchronized to the Railway backend Sentinal actually uses.';
      const validationDetail = validationReady
        ? `${passedValidations.length} hosted read-only acceptance probe${passedValidations.length === 1 ? ' has' : 's have'} passed. Most recent evidence is stored without provider payload data.`
        : validations.length
          ? 'A hosted read-only validation was attempted but has not passed yet. Review the provider result in Backend Modules.'
          : 'Run a hosted read-only provider probe after syncing configuration. Palworld remains the recommended first live server acceptance target.';
      const discordDetail = scanError
        ? `Admin scan is not available yet: ${scanError}`
        : permissions
          ? `${(permissions.permissions || []).filter((item) => item.granted).length}/${(permissions.permissions || []).length} required Discord permissions are granted.`
          : 'Run the authenticated Sentinal scan, then reconcile commands, channels, panels, and ranks.';

      content.innerHTML = `
        <div class="setup-progress card">
          <div><h3>First-run readiness</h3><p>Complete these in order. Nexus reuses existing Discord structure and never exposes Sentinal or provider secret values to the renderer.</p></div>
          <div class="setup-progress-score"><strong>${completeCount}/7</strong><span>core steps ready</span></div>
        </div>
        <div class="setup-steps">
          ${step(1, 'Local Nexus backend', backendReady ? 'The local backend is online and ready for configuration.' : 'Start or repair the local backend before configuring integrations.', backendReady, false, 'Open Diagnostics', '[data-view="diagnostics"]')}
          ${step(2, 'Pair hosted Nexus Sentinal', sentinalReady ? 'Hosted Sentinal is authenticated and responding to the Admin Control Center.' : 'Run /nexus-pair in Discord, then enter the HTTPS URL and one-time code in Discord Admin.', sentinalReady, false, sentinalReady ? 'Open Discord Admin' : 'Pair Sentinal', '[data-admin-ops-discord]')}
          ${step(3, 'Create Owner / household access', accountReady ? `${accounts.length} Nexus household account${accounts.length === 1 ? '' : 's'} linked.` : 'Create the primary Owner account first; add a Co-Owner later if desired.', accountReady, false, 'Open Accounts & Access', '[data-accounts-view]')}
          ${step(4, 'Discover supporter ranks & entitlements', rankDetail, rankReady, rankPartial, rankReady ? 'Review mappings' : 'Discover mappings', '[data-admin-ops-discord]')}
          ${step(5, 'Accept Discord administration', discordDetail, discordReady, discordPartial && !discordReady, discordReady ? 'Review Discord Admin' : 'Scan / Repair Discord', '[data-admin-ops-discord]')}
          ${step(6, 'Configure & sync game providers', providerDetail, providersReady, providersPartial && !providersReady, providerSynced ? 'Review Hosted Sync' : 'Sync Hosted Providers', '[data-view="modules"]', '<p class="setup-note">Connection metadata is saved under Backend Modules. Passwords/tokens are stored under Credentials and transferred only by the Electron main process.</p>')}
          ${step(7, 'Run hosted read-only provider acceptance', validationDetail, validationReady, validationPartial, 'Validate Hosted Provider', '[data-view="modules"]')}
        </div>
        <div class="setup-footer card"><div><strong>After setup</strong><p>Use Owner Test Center for build acceptance and Discord Admin → Repair Nexus for safe reconciliation.</p></div><div class="actions"><button id="setupRescan" class="secondary">Recheck setup</button><button id="setupOwnerTest" class="secondary">Owner Test Center</button></div></div>`;

      content.querySelectorAll('[data-setup-open]').forEach((button) => {
        button.onclick = () => open(button.dataset.setupOpen);
      });
      document.getElementById('setupRescan').onclick = () => render();
      document.getElementById('setupOwnerTest').onclick = () => open('[data-admin-ops-owner]');
    } catch (error) {
      content.innerHTML = `<article class="card"><h3>Setup Center unavailable</h3><p class="bad">${esc(error.message || error)}</p><p>Diagnostics remains available even when an optional integration is offline.</p><div class="actions"><button id="setupDiagnostics" class="primary">Open Diagnostics</button></div></article>`;
      document.getElementById('setupDiagnostics').onclick = () => open('[data-view="diagnostics"]');
    } finally {
      busy = false;
    }
  }

  setupButton.onclick = () => {
    const overview = nav.querySelector('[data-view="overview"]');
    if (overview) overview.click();
    active = true;
    render();
  };

  nav.querySelectorAll('button').forEach((button) => {
    if (button !== setupButton) button.addEventListener('click', () => { active = false; });
  });
  refresh?.addEventListener('click', () => setTimeout(() => { if (active) render(); }, 250));
})();
