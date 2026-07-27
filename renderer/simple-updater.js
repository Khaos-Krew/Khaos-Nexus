'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  let updateState = null;
  let bound = false;

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || 'Done.');
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

  function isBusy(update = {}) {
    return ['checking', 'downloading', 'backing-up', 'installing'].includes(update.status);
  }

  function ensureFallbackCenter() {
    const settingsView = $('view-settings');
    if (!settingsView || $('nexusUpdateFallbackCenter')) return $('nexusUpdateFallbackCenter');

    const panel = document.createElement('article');
    panel.id = 'nexusUpdateFallbackCenter';
    panel.className = 'panel form-panel nexus-update-fallback-center';
    panel.innerHTML = `
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Application updates</span>
          <h3>Update Khaos Nexus</h3>
          <p>Check once, download the update, then use Install & Restart. A verified backup is mandatory before installation.</p>
        </div>
      </div>
      <div class="form-actions nexus-update-fallback-actions"></div>
    `;
    settingsView.appendChild(panel);
    return panel;
  }

  function findActions() {
    const center = $('nexusUpdateCenter');
    const settingsPanel = document.querySelector('#view-settings .settings-list');
    let actions = center?.querySelector('.form-actions')
      || settingsPanel?.querySelector('.form-actions')
      || document.querySelector('#view-settings .form-actions');

    if (!actions) {
      const fallback = ensureFallbackCenter();
      actions = fallback?.querySelector('.form-actions') || null;
    }

    return { center, actions };
  }

  function ensureControls() {
    const { center, actions } = findActions();
    if (center) {
      const description = center.querySelector('.panel-heading p');
      if (description) {
        description.textContent = 'Check once, download the update, then use Install & Restart. A verified backup is mandatory before installation.';
      }
    }

    if (actions && !$('nexusSimpleUpdatePrimary')) {
      const button = document.createElement('button');
      button.id = 'nexusSimpleUpdatePrimary';
      button.className = 'button primary nexus-simple-update-primary';
      button.type = 'button';
      const release = $('nexusUpdateRelease');
      const backup = $('exportBackupButton');
      if (release && release.parentElement === actions) actions.insertBefore(button, release);
      else if (backup && backup.parentElement === actions) actions.insertBefore(button, backup);
      else actions.appendChild(button);
      button.addEventListener('click', () => runSimpleUpdate().catch(() => {}));
    }

    const replacementReady = Boolean($('nexusSimpleUpdatePrimary'));
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
    for (const id of ['nexusSimpleUpdatePrimary', 'nexusSimpleUpdateBanner']) {
      const button = $(id);
      if (!button) continue;
      button.textContent = label;
      button.disabled = disabled;
      button.classList.toggle('busy', isBusy(updateState));
    }

    const bannerButton = $('nexusSimpleUpdateBanner');
    if (bannerButton) {
      const show = ['available', 'downloaded', 'error', 'downloading', 'backing-up', 'installing'].includes(updateState.status);
      bannerButton.classList.toggle('hidden', !show);
    }

    const status = $('updateStatus');
    if (status && updateState.backupStatus === 'verified' && updateState.status === 'downloaded') {
      status.textContent = `Update downloaded and verified. Backup ready. Press Install & Restart to finish v${updateState.version || 'the update'}.`;
    }
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

  function bind() {
    if (bound) return;
    bound = true;
    window.khaos.onUpdate((update) => render(update));
    window.khaos.onState((state) => render(state?.update || updateState || {}));
  }

  async function initialize() {
    bind();
    ensureControls();
    const state = await invoke('app:get-state');
    render(state?.update || {});
    const observer = new MutationObserver(() => {
      ensureControls();
      render(updateState || {});
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  initialize().catch((error) => notify(`The simplified updater failed to initialize: ${error.message}`));
})();
