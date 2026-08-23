'use strict';

(() => {
  const api = window.nexusAdmin;
  const content = document.getElementById('content');
  const title = document.getElementById('title');
  if (!api?.updateStatus || !content || !title) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let update = null;
  let busy = false;
  let refreshTimer = null;

  const banner = document.createElement('div');
  banner.id = 'nexusUpdateBanner';
  banner.className = 'update-banner';
  banner.setAttribute('role', 'status');
  document.body.appendChild(banner);

  function humanBytes(value) {
    const bytes = Number(value || 0);
    if (!bytes) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
  }

  function phaseLabel(status) {
    switch (status?.phase) {
      case 'checking': return 'Checking for updates…';
      case 'available': return `Nexus ${status.availableVersion} is available`;
      case 'downloading': return `Downloading Nexus ${status.availableVersion}…`;
      case 'staging': return `Preparing Nexus ${status.availableVersion}…`;
      case 'ready': return `Nexus ${status.readyVersion} is ready to apply`;
      case 'applying': return `Applying Nexus ${status.readyVersion || status.availableVersion}…`;
      case 'failed': return 'Update could not be prepared';
      default: return 'Nexus is up to date';
    }
  }

  function progressPercent(status) {
    if (status?.phase === 'staging' || status?.phase === 'ready') return 100;
    const total = Number(status?.totalBytes || 0);
    const downloaded = Number(status?.downloadedBytes || 0);
    if (!total) return status?.phase === 'downloading' ? 4 : 0;
    return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
  }

  function renderBanner() {
    if (!update || update.phase !== 'ready') {
      banner.classList.remove('show');
      banner.innerHTML = '';
      return;
    }
    banner.innerHTML = `<strong>Update ready · ${esc(update.readyVersion)}</strong><p>The update is downloaded, verified and staged. No installer will run. Restart Nexus when you're ready to apply it.</p><div class="actions"><button id="bannerRestartUpdate" class="primary">Restart & apply</button><button id="bannerLaterUpdate" class="secondary">Later</button></div>`;
    banner.classList.add('show');
    banner.querySelector('#bannerLaterUpdate').onclick = () => banner.classList.remove('show');
    banner.querySelector('#bannerRestartUpdate').onclick = restartAndApply;
  }

  function renderSettingsCard() {
    if (title.textContent !== 'Settings') return;
    let card = document.getElementById('nexusUpdaterCard');
    if (!card) {
      card = document.createElement('article');
      card.id = 'nexusUpdaterCard';
      card.className = 'card';
      content.appendChild(card);
    }
    const status = update || { phase: 'idle', currentVersion: '', channel: 'owner-test' };
    const percent = progressPercent(status);
    const working = ['checking', 'downloading', 'staging', 'applying'].includes(status.phase);
    const canPrepare = status.phase === 'available';
    const canRestart = status.phase === 'ready';
    const error = status.lastError ? `<p class="bad">${esc(status.lastError)}</p>` : '';
    const rollback = status.lastResult?.status === 'rolled-back'
      ? `<p class="warn"><strong>Automatic rollback:</strong> ${esc(status.lastResult.reason || 'The previous update did not pass startup validation, so Nexus restored the last working files.')}</p>`
      : '';
    const notes = status.notes ? `<div class="update-notes">${esc(status.notes)}</div>` : '';
    card.innerHTML = `<h3>In-app updater</h3>
      <p>Nexus downloads and verifies an update package, prepares it while the app stays open, then waits for you to restart. The NSIS installer is never run for normal updates.</p>
      <div class="update-state-line"><strong>${esc(phaseLabel(status))}</strong><span class="badge ${status.phase === 'ready' ? 'good' : status.phase === 'failed' ? 'bad' : ''}">${esc(status.channel || 'owner-test')}</span></div>
      ${working || status.phase === 'ready' ? `<div class="update-progress"><span style="width:${percent}%"></span></div><p class="small-text">${humanBytes(status.downloadedBytes)} / ${humanBytes(status.totalBytes)}</p>` : ''}
      ${error}${rollback}${notes}
      <div class="form-row">
        <label class="field"><span>Update channel</span><select id="updateChannel"><option value="owner-test" ${status.channel === 'owner-test' ? 'selected' : ''}>Owner Test</option><option value="stable" ${status.channel === 'stable' ? 'selected' : ''}>Stable</option></select></label>
        <label class="check-field"><input id="updateAutoDownload" type="checkbox" ${status.autoDownload !== false ? 'checked' : ''}><span><strong>Download automatically</strong><small>Prepare verified updates in the background, but never restart without asking.</small></span></label>
      </div>
      <div class="actions">
        <button id="saveUpdatePrefs" class="secondary" ${working ? 'disabled' : ''}>Save preferences</button>
        <button id="checkUpdate" class="secondary" ${working ? 'disabled' : ''}>Check now</button>
        <button id="prepareUpdate" class="primary" ${canPrepare && !busy ? '' : 'disabled'}>Download & prepare</button>
        <button id="restartUpdate" class="primary" ${canRestart && !busy ? '' : 'disabled'}>Restart & apply</button>
      </div>
      <p class="small-text">Current version: ${esc(status.currentVersion || 'unknown')} · User configuration, accounts, diagnostics, game state and Thora household data live outside the install directory and are not replaced by updates.</p>`;

    card.querySelector('#checkUpdate').onclick = async () => run(async () => api.checkForUpdate());
    card.querySelector('#prepareUpdate').onclick = async () => run(async () => api.prepareUpdate());
    card.querySelector('#restartUpdate').onclick = restartAndApply;
    card.querySelector('#saveUpdatePrefs').onclick = async () => {
      await run(async () => {
        const state = await api.state();
        const settings = state.settings || {};
        settings.updates ||= {};
        settings.updates.channel = card.querySelector('#updateChannel').value;
        settings.updates.autoDownload = card.querySelector('#updateAutoDownload').checked;
        settings.updates.enabled = true;
        await api.saveSettings(settings);
        return api.updateStatus();
      });
    };
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    try {
      update = await action();
    } catch (error) {
      update = await api.updateStatus().catch(() => update);
      if (update) update.lastError = error.message || String(error);
    } finally {
      busy = false;
      renderBanner();
      renderSettingsCard();
    }
  }

  async function restartAndApply() {
    if (busy || !update || update.phase !== 'ready') return;
    const accepted = window.confirm(`Nexus ${update.readyVersion} is ready. Restart now to apply the staged update?`);
    if (!accepted) return;
    busy = true;
    try {
      await api.restartToApplyUpdate();
    } catch (error) {
      busy = false;
      update = await api.updateStatus().catch(() => update);
      if (update) update.lastError = error.message || String(error);
      renderBanner();
      renderSettingsCard();
    }
  }

  async function refresh() {
    try {
      update = await api.updateStatus();
      renderBanner();
      renderSettingsCard();
      const working = ['checking', 'downloading', 'staging'].includes(update.phase);
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, working ? 1000 : 5000);
    } catch {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 10000);
    }
  }

  new MutationObserver(() => renderSettingsCard()).observe(content, { childList: true });
  refresh();
})();
