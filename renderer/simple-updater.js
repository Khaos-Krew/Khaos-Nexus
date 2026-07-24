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
    if (status === 'installing') return 'Restarting…';
    if (status === 'available') return `Update to v${update.version || 'latest'} & Restart`;
    if (status === 'downloaded') return 'Restart to Finish Update';
    if (status === 'error') return 'Retry Update';
    if (status === 'current') return 'Check Again';
    if (status === 'development') return 'Updates Unavailable';
    return 'Check & Update';
  }

  function isBusy(update = {}) {
    return ['checking', 'downloading', 'installing'].includes(update.status);
  }

  function ensureControls() {
    const center = $('nexusUpdateCenter');
    const actions = center?.querySelector('.form-actions');
    if (center) {
      const description = center.querySelector('.panel-heading p');
      if (description) description.textContent = 'One button checks the stable channel, downloads and verifies the update, creates a backup, then restarts Khaos Nexus.';
    }

    if (actions && !$('nexusSimpleUpdatePrimary')) {
      const button = document.createElement('button');
      button.id = 'nexusSimpleUpdatePrimary';
      button.className = 'button primary nexus-simple-update-primary';
      button.type = 'button';
      const release = $('nexusUpdateRelease');
      if (release) actions.insertBefore(button, release);
      else actions.appendChild(button);
      button.addEventListener('click', () => runSimpleUpdate().catch(() => {}));
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
      const show = ['available', 'downloaded', 'error', 'downloading', 'installing'].includes(updateState.status);
      bannerButton.classList.toggle('hidden', !show);
    }
  }

  function confirmationText(update = {}) {
    const version = update.version ? ` v${update.version}` : '';
    if (update.status === 'available' || update.status === 'downloaded') {
      return `Update Khaos Nexus${version} now? The app will verify the download, create a settings backup, install the update, and restart automatically.`;
    }
    return 'Check for a Khaos Nexus update now? If a newer stable version is found, it will be downloaded, verified, backed up, installed, and restarted automatically.';
  }

  async function runSimpleUpdate() {
    if (isBusy(updateState || {})) return;
    if (!confirm(confirmationText(updateState || {}))) return;
    notify('Khaos Nexus is checking and preparing the update…');
    const result = await invoke('update:apply');
    render(result || updateState || {});
    if (result?.status === 'current') notify('Khaos Nexus is already up to date.');
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
