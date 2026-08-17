'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const RECONCILE_DELAYS_MS = Object.freeze([250, 1000, 3000, 6000]);
  let updateState = null;
  let appVersion = '';
  let bound = false;
  let stateBound = false;

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    const next = String(message || 'Done.');
    if (toast.textContent !== next) toast.textContent = next;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  async function invoke(channel, payload) {
    try {
      return await window.khaos.invoke(channel, payload);
    } catch (error) {
      notify(error.message || String(error));
      throw error;
    }
  }

  function titleCase(value) {
    return String(value || '').replace(/(^|[-_\s])\w/g, (character) => character.toUpperCase());
  }

  function buttonLabel(update = {}) {
    const status = update.status || 'idle';
    if (status === 'checking') return 'Checking…';
    if (status === 'downloading') return `Downloading${Number.isFinite(Number(update.progress)) ? ` ${Math.round(Number(update.progress))}%` : '…'}`;
    if (status === 'backing-up') return 'Creating Verified Backup…';
    if (status === 'installing') return 'Installing & Restarting…';
    if (status === 'available') return `Download v${update.version || 'Latest'}`;
    if (status === 'downloaded') return 'Install & Restart';
    if (status === 'error') return 'Check Again';
    if (status === 'current') return 'Check Again';
    if (status === 'development') return 'Updates Unavailable';
    return 'Check for Updates';
  }

  function statusDetail(update = {}) {
    const status = update.status || 'idle';
    if (status === 'checking') return 'Checking the stable GitHub release channel.';
    if (status === 'available') return `Version ${update.version || 'latest'} is ready to download.`;
    if (status === 'downloading') return `Downloading and verifying the update${Number.isFinite(Number(update.progress)) ? ` — ${Math.round(Number(update.progress))}%` : ''}.`;
    if (status === 'downloaded') return update.backupStatus === 'verified'
      ? 'Update downloaded and verified. A protected backup is ready.'
      : 'Update downloaded. Install & Restart will create and verify a backup first.';
    if (status === 'backing-up') return 'Creating and verifying the mandatory pre-update backup.';
    if (status === 'installing') return 'Installing the update. Khaos Nexus will restart automatically.';
    if (status === 'current') return 'This is the latest published stable version.';
    if (status === 'development') return 'In-app installation is available in packaged Windows builds.';
    if (status === 'error') return update.error || 'The update service needs attention.';
    return 'Check for updates without leaving Khaos Nexus.';
  }

  function isBusy(update = {}) {
    return ['checking', 'downloading', 'backing-up', 'installing'].includes(update.status);
  }

  function setText(element, value) {
    if (!element) return;
    const next = String(value ?? '');
    if (element.textContent !== next) element.textContent = next;
  }

  function ensureFallbackCenter() {
    const existing = $('nexusUpdateCenter') || $('nexusUpdateFallbackCenter');
    if (existing) return existing;
    const settingsView = $('view-settings');
    if (!settingsView) return null;

    const panel = document.createElement('article');
    panel.id = 'nexusUpdateFallbackCenter';
    panel.className = 'panel form-panel nexus-update-fallback-center';
    panel.innerHTML = `
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Stable release channel</span>
          <h3>Update Khaos Nexus</h3>
          <p>Check, download, and install updates inside the application. A verified backup is mandatory before installation.</p>
        </div>
        <span class="severity" id="nexusSimpleUpdateBadge">Idle</span>
      </div>
      <div class="nexus-update-summary">
        <div><span>Installed</span><strong id="nexusSimpleInstalledVersion">—</strong><small>Current application</small></div>
        <div><span>Available</span><strong id="nexusSimpleAvailableVersion">Not checked</strong><small>Stable GitHub release</small></div>
        <div><span>Update state</span><strong id="nexusSimpleUpdateState">Idle</strong><small>Protected two-step update</small></div>
      </div>
      <div class="form-actions nexus-update-fallback-actions"></div>
      <div class="callout nexus-update-fallback-status" id="nexusSimpleUpdateStatus">Update status: idle</div>`;

    const settingsList = settingsView.querySelector('.settings-list');
    if (settingsList) settingsView.insertBefore(panel, settingsList);
    else settingsView.appendChild(panel);
    return panel;
  }

  function ensureHeaderControl() {
    let button = $('nexusHeaderUpdateButton');
    if (button) return button;
    const topbar = document.querySelector('.topbar');
    if (!topbar) return null;
    button = document.createElement('button');
    button.id = 'nexusHeaderUpdateButton';
    button.type = 'button';
    button.className = 'button nexus-header-update-button';
    const status = $('topStatus');
    if (status?.parentElement === topbar) topbar.insertBefore(button, status);
    else topbar.appendChild(button);
    button.addEventListener('click', () => runSimpleUpdate().catch(() => {}));
    return button;
  }

  function findActions() {
    const center = ensureFallbackCenter();
    let actions = center?.querySelector('.form-actions');
    if (!actions && center) {
      actions = document.createElement('div');
      actions.className = 'form-actions nexus-update-fallback-actions';
      center.appendChild(actions);
    }
    return { center, actions };
  }

  function ensureControls() {
    const { center, actions } = findActions();
    ensureHeaderControl();

    if (center) {
      const description = center.querySelector('.panel-heading p');
      setText(description, 'Check, download, and install updates inside the application. A verified backup is mandatory before installation.');
    }

    if (actions && !$('nexusSimpleUpdatePrimary')) {
      const button = document.createElement('button');
      button.id = 'nexusSimpleUpdatePrimary';
      button.className = 'button primary nexus-simple-update-primary';
      button.type = 'button';
      actions.insertBefore(button, actions.firstChild);
      button.addEventListener('click', () => runSimpleUpdate().catch(() => {}));
    }

    const replacementReady = Boolean($('nexusSimpleUpdatePrimary') && $('nexusHeaderUpdateButton'));
    for (const id of ['checkUpdatesButton', 'downloadUpdateButton', 'installUpdateButton']) {
      const legacy = $(id);
      if (legacy) legacy.classList.toggle('hidden', replacementReady);
    }

    const banner = $('nexusUpdateBanner');
    if (banner && !$('nexusSimpleUpdateBanner')) {
      const button = document.createElement('button');
      button.id = 'nexusSimpleUpdateBanner';
      button.className = 'button primary nexus-simple-banner-action';
      button.type = 'button';
      banner.appendChild(button);
      button.addEventListener('click', () => runSimpleUpdate().catch(() => {}));
    }
  }

  function render(update = {}) {
    updateState = { ...update };
    ensureControls();
    const label = buttonLabel(updateState);
    const disabled = isBusy(updateState) || updateState.status === 'development';

    for (const id of ['nexusSimpleUpdatePrimary', 'nexusSimpleUpdateBanner', 'nexusHeaderUpdateButton']) {
      const button = $(id);
      if (!button) continue;
      setText(button, label);
      if (button.disabled !== disabled) button.disabled = disabled;
      button.classList.toggle('busy', isBusy(updateState));
      button.classList.toggle('primary', ['available', 'downloaded'].includes(updateState.status));
    }

    setText($('nexusSimpleInstalledVersion'), `v${updateState.currentVersion || appVersion || '—'}`);
    setText($('nexusSimpleAvailableVersion'), updateState.version ? `v${updateState.version}` : 'Not checked');
    setText($('nexusSimpleUpdateState'), titleCase(updateState.status || 'idle'));
    setText($('nexusSimpleUpdateStatus'), statusDetail(updateState));
    setText($('nexusSimpleUpdateBadge'), titleCase(updateState.status || 'idle'));

    const richInstalled = $('nexusInstalledVersion');
    const richLatest = $('nexusLatestVersion');
    const richBadge = $('nexusUpdateBadge');
    if (richInstalled) setText(richInstalled, `v${updateState.currentVersion || appVersion || '—'}`);
    if (richLatest) setText(richLatest, updateState.version ? `v${updateState.version}` : 'Not checked');
    if (richBadge) setText(richBadge, titleCase(updateState.status || 'idle'));

    const bannerButton = $('nexusSimpleUpdateBanner');
    if (bannerButton) {
      const show = ['available', 'downloaded', 'error', 'downloading', 'backing-up', 'installing'].includes(updateState.status);
      bannerButton.classList.toggle('hidden', !show);
    }

    const status = $('updateStatus');
    if (status) setText(status, `Update status: ${titleCase(updateState.status || 'idle')} — ${statusDetail(updateState)}`);
  }

  async function runSimpleUpdate() {
    if (isBusy(updateState || {})) return;
    const status = updateState?.status || 'idle';

    if (status === 'available') {
      notify('Downloading and verifying the update…');
      const result = await invoke('update:download');
      render(result || updateState || {});
      notify('Update downloaded. Press Install & Restart when ready.');
      return;
    }

    if (status === 'downloaded') {
      const version = updateState?.version ? ` v${updateState.version}` : '';
      if (!confirm(`Install Khaos Nexus${version} now? A verified backup will be created first. The app will close, finish installation, and restart automatically.`)) return;
      notify('Creating a verified backup before installation…');
      await invoke('update:install');
      return;
    }

    notify('Checking the stable update channel…');
    const result = await invoke('update:check');
    render(result || updateState || {});
    if (result?.status === 'available') notify(`v${result.version || 'A new version'} is ready to download.`);
    else if (result?.status === 'current') notify('Khaos Nexus is already up to date.');
  }

  function applyAppState(state) {
    appVersion = state?.app?.version || appVersion;
    render(state?.update || updateState || {});
  }

  function bindStateHub() {
    if (stateBound || !window.khaosStateHub?.subscribe) return stateBound;
    stateBound = true;
    window.khaosStateHub.subscribe(applyAppState, { replay: true });
    return true;
  }

  function bind() {
    if (bound) return;
    bound = true;
    window.khaos.onUpdate?.((update) => render(update));
    if (!bindStateHub()) window.addEventListener('khaos:state-hub-ready', bindStateHub, { once: true });
  }

  function scheduleBoundedReconciliation() {
    for (const delay of RECONCILE_DELAYS_MS) {
      setTimeout(() => {
        ensureControls();
        if (updateState) render(updateState);
      }, delay);
    }
  }

  async function initialize() {
    bind();
    ensureControls();
    const state = await invoke('app:get-state');
    appVersion = state?.app?.version || '';
    render(state?.update || {});
    scheduleBoundedReconciliation();
  }

  initialize().catch((error) => notify(`The in-app updater failed to initialize: ${error.message}`));
})();