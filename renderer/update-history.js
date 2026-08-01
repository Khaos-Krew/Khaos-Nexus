'use strict';

(() => {
  if (window.__khaosUpdateHistoryLoaded) return;
  window.__khaosUpdateHistoryLoaded = true;

  const $ = (id) => document.getElementById(id);
  let state = null;
  let selectedRelease = null;
  let loaded = false;

  function createPanel() {
    const settings = $('view-settings');
    if (!settings || $('nexusUpdateHistoryPanel')) return Boolean($('nexusUpdateHistoryPanel'));

    const panel = document.createElement('article');
    panel.id = 'nexusUpdateHistoryPanel';
    panel.className = 'panel nexus-update-history';
    panel.innerHTML = `
      <div class="panel-heading nexus-update-heading">
        <div>
          <span class="eyebrow">Updates & rollback</span>
          <h3>Version history</h3>
          <p>Review the latest 10 compatible Windows releases and safely return to an older verified version.</p>
        </div>
        <button class="button" id="nexusRefreshReleaseHistory" type="button">Refresh Versions</button>
      </div>
      <div class="nexus-update-summary" aria-live="polite">
        <div><span>Installed</span><strong id="nexusInstalledVersion">—</strong><small id="nexusInstalledChannel">Channel unavailable</small></div>
        <div><span>Latest stable</span><strong id="nexusLatestStable">—</strong><small>Stable channel</small></div>
        <div><span>Latest beta</span><strong id="nexusLatestBeta">—</strong><small>Testing channel</small></div>
        <div><span>Data floor</span><strong id="nexusDataFloor">—</strong><small>Oldest safe rollback</small></div>
      </div>
      <div class="callout nexus-update-message" id="nexusUpdateHistoryStatus" role="status">Version history has not been loaded.</div>
      <div id="nexusReleaseHistoryList" class="nexus-release-list" aria-label="Compatible release history"></div>
      <details class="nexus-rollback-history">
        <summary>Recent rollback activity</summary>
        <div id="nexusRollbackHistoryList" class="nexus-rollback-events"></div>
      </details>
      <p class="privacy-note">Rollback is Owner-only. Khaos Nexus creates and verifies a protected backup before downloading an older installer. Android and Mobile Gateway assets are never eligible.</p>
    `;
    settings.appendChild(panel);

    const overlay = document.createElement('div');
    overlay.id = 'nexusRollbackOverlay';
    overlay.className = 'nexus-rollback-overlay nexus-history-hidden';
    overlay.setAttribute('role', 'presentation');
    overlay.innerHTML = `
      <section class="nexus-rollback-dialog" role="dialog" aria-modal="true" aria-labelledby="nexusRollbackTitle" aria-describedby="nexusRollbackDescription">
        <span class="eyebrow">Verified rollback</span>
        <h3 id="nexusRollbackTitle">Confirm rollback</h3>
        <p id="nexusRollbackDescription">Khaos Nexus will create a verified backup, download the exact signed release asset, validate its SHA-256 digest, and launch it.</p>
        <div class="nexus-rollback-target"><span>Target</span><strong id="nexusRollbackTarget">—</strong></div>
        <label for="nexusRollbackConfirmation">Type <code id="nexusRollbackPhrase">—</code> exactly</label>
        <input id="nexusRollbackConfirmation" autocomplete="off" spellcheck="false">
        <div class="callout" id="nexusRollbackStatus">The current version remains active until verification succeeds.</div>
        <div class="form-actions">
          <button class="button danger" id="nexusConfirmRollback" type="button" disabled>Back Up & Roll Back</button>
          <button class="button" id="nexusCancelRollback" type="button">Cancel</button>
        </div>
      </section>
    `;
    document.body.appendChild(overlay);

    $('nexusRefreshReleaseHistory')?.addEventListener('click', () => refresh(true));
    $('nexusCancelRollback')?.addEventListener('click', closeRollbackDialog);
    $('nexusRollbackOverlay')?.addEventListener('click', (event) => {
      if (event.target === $('nexusRollbackOverlay')) closeRollbackDialog();
    });
    $('nexusRollbackConfirmation')?.addEventListener('input', updateRollbackButton);
    $('nexusConfirmRollback')?.addEventListener('click', confirmRollback);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('nexusRollbackOverlay')?.classList.contains('nexus-history-hidden')) closeRollbackDialog();
    });
    document.querySelector('[data-view="settings"]')?.addEventListener('click', () => {
      if (!loaded) refresh(false);
    });
    return true;
  }

  function text(id, value) {
    const element = $(id);
    if (element) element.textContent = value == null || value === '' ? '—' : String(value);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function channelName(channel) {
    return channel === 'beta' ? 'Beta testing' : 'Stable release';
  }

  function relationText(release) {
    if (release.isCurrent) return 'Installed';
    if (release.isNewer) return 'Available update';
    if (release.canRollback) return 'Rollback available';
    return release.blockedReason || 'Rollback unavailable';
  }

  function renderSummary() {
    if (!state) return;
    text('nexusInstalledVersion', state.currentLabel || state.currentVersion);
    text('nexusInstalledChannel', `${channelName(state.channel)} · internal ${state.currentVersion}`);
    text('nexusDataFloor', state.dataCompatibilityFloor);
    const releases = Array.isArray(state.releases) ? state.releases : [];
    text('nexusLatestStable', releases.find((release) => release.channel === 'stable')?.label || 'None found');
    text('nexusLatestBeta', releases.find((release) => release.channel === 'beta')?.label || 'None found');
  }

  function renderReleases() {
    const container = $('nexusReleaseHistoryList');
    if (!container) return;
    container.replaceChildren();
    const releases = Array.isArray(state?.releases) ? state.releases : [];
    if (!releases.length) {
      const empty = document.createElement('div');
      empty.className = 'nexus-release-empty';
      empty.textContent = 'No compatible Windows release entries were returned.';
      container.appendChild(empty);
      return;
    }

    for (const release of releases) {
      const article = document.createElement('article');
      article.className = `nexus-release-entry${release.isCurrent ? ' current' : ''}`;

      const main = document.createElement('div');
      main.className = 'nexus-release-main';
      const titleRow = document.createElement('div');
      titleRow.className = 'nexus-release-title-row';
      const title = document.createElement('strong');
      title.textContent = release.label;
      const channel = document.createElement('span');
      channel.className = `nexus-channel-badge ${release.channel}`;
      channel.textContent = release.channel === 'beta' ? 'BETA' : 'STABLE';
      titleRow.append(title, channel);
      if (release.legacyLabel) {
        const legacy = document.createElement('span');
        legacy.className = 'nexus-channel-badge legacy';
        legacy.textContent = 'LEGACY LABEL';
        titleRow.appendChild(legacy);
      }

      const meta = document.createElement('span');
      meta.className = 'nexus-release-meta';
      meta.textContent = `${formatDate(release.publishedAt)} · internal ${release.internalVersion} · ${relationText(release)}`;
      const notes = document.createElement('p');
      notes.textContent = release.notes || 'No release summary was provided.';
      main.append(titleRow, meta, notes);

      const actions = document.createElement('div');
      actions.className = 'nexus-release-actions';
      if (release.canRollback) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button danger';
        button.textContent = 'Roll Back';
        button.addEventListener('click', () => openRollbackDialog(release));
        actions.appendChild(button);
      } else {
        const reason = document.createElement('span');
        reason.className = release.isCurrent ? 'tag good' : 'nexus-release-blocked';
        reason.textContent = release.isCurrent ? 'Current' : relationText(release);
        actions.appendChild(reason);
      }
      article.append(main, actions);
      container.appendChild(article);
    }
  }

  function renderRollbackHistory() {
    const container = $('nexusRollbackHistoryList');
    if (!container) return;
    container.replaceChildren();
    const history = Array.isArray(state?.rollbackHistory) ? state.rollbackHistory.slice(0, 10) : [];
    if (!history.length) {
      const empty = document.createElement('span');
      empty.className = 'nexus-release-meta';
      empty.textContent = 'No rollback attempts have been recorded.';
      container.appendChild(empty);
      return;
    }
    for (const entry of history) {
      const row = document.createElement('div');
      row.className = 'nexus-rollback-event';
      const detail = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = `${entry.previousVersion || 'Unknown'} → ${entry.targetTag || entry.targetVersion || 'Unknown'}`;
      const meta = document.createElement('span');
      meta.textContent = `${String(entry.status || 'unknown').toUpperCase()} · ${formatDate(entry.finishedAt || entry.startedAt)}`;
      detail.append(title, meta);
      if (entry.error) {
        const error = document.createElement('small');
        error.textContent = entry.error;
        detail.appendChild(error);
      }
      const badge = document.createElement('span');
      badge.className = `nexus-history-status ${entry.status === 'launched' ? 'good' : entry.status === 'failed' ? 'bad' : ''}`;
      badge.textContent = entry.status || 'unknown';
      row.append(detail, badge);
      container.appendChild(row);
    }
  }

  function render() {
    renderSummary();
    renderReleases();
    renderRollbackHistory();
    const status = $('nexusUpdateHistoryStatus');
    if (!status || !state) return;
    status.classList.toggle('error', state.status === 'error');
    if (state.status === 'loading') status.textContent = 'Loading trusted GitHub release history…';
    else if (state.status === 'error') status.textContent = `Version history error: ${state.error || 'Unknown error'}`;
    else status.textContent = `Showing ${state.releases?.length || 0} compatible Windows releases. Last refreshed ${state.refreshedAt ? formatDate(state.refreshedAt) : 'this session'}.`;
  }

  async function refresh(force) {
    if (!createPanel()) return;
    const button = $('nexusRefreshReleaseHistory');
    if (button) button.disabled = true;
    text('nexusUpdateHistoryStatus', 'Loading trusted GitHub release history…');
    try {
      state = await window.khaos.invoke('update-history:refresh', { force: Boolean(force) });
      loaded = true;
      render();
    } catch (error) {
      loaded = true;
      state = { ...(state || {}), status: 'error', error: error?.message || String(error), releases: state?.releases || [], rollbackHistory: state?.rollbackHistory || [] };
      render();
    } finally {
      if (button) button.disabled = false;
    }
  }

  function openRollbackDialog(release) {
    selectedRelease = release;
    const expected = `ROLL BACK TO ${release.label}`;
    text('nexusRollbackTarget', `${release.label} · ${channelName(release.channel)}`);
    text('nexusRollbackPhrase', expected);
    const input = $('nexusRollbackConfirmation');
    if (input) input.value = '';
    text('nexusRollbackStatus', `A verified backup will be created before ${release.label} is downloaded.`);
    $('nexusRollbackOverlay')?.classList.remove('nexus-history-hidden');
    updateRollbackButton();
    setTimeout(() => input?.focus(), 0);
  }

  function closeRollbackDialog() {
    selectedRelease = null;
    $('nexusRollbackOverlay')?.classList.add('nexus-history-hidden');
    const input = $('nexusRollbackConfirmation');
    if (input) input.value = '';
    updateRollbackButton();
  }

  function updateRollbackButton() {
    const button = $('nexusConfirmRollback');
    if (!button) return;
    const expected = selectedRelease ? `ROLL BACK TO ${selectedRelease.label}` : '';
    button.disabled = !selectedRelease || $('nexusRollbackConfirmation')?.value !== expected;
  }

  async function confirmRollback() {
    if (!selectedRelease) return;
    const button = $('nexusConfirmRollback');
    const cancel = $('nexusCancelRollback');
    if (button) button.disabled = true;
    if (cancel) cancel.disabled = true;
    text('nexusRollbackStatus', 'Creating and verifying the protected backup…');
    try {
      const result = await window.khaos.invoke('update-history:rollback', {
        tagName: selectedRelease.tagName,
        confirmation: $('nexusRollbackConfirmation')?.value || ''
      });
      text('nexusRollbackStatus', `Verified ${result.assetName}. The rollback installer is launching and Khaos Nexus will close.`);
    } catch (error) {
      text('nexusRollbackStatus', error?.message || String(error));
      if (cancel) cancel.disabled = false;
      updateRollbackButton();
      try {
        state = await window.khaos.invoke('update-history:get');
        render();
      } catch {}
    }
  }

  function initialize() {
    if (!createPanel()) return;
    window.khaos.invoke('update-history:get')
      .then((value) => {
        state = value;
        render();
      })
      .catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
