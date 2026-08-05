'use strict';

(() => {
  const INSTALL_TIMEOUT_MS = 30000;
  const REFRESH_INTERVAL_MS = 30000;
  const startedAt = Date.now();
  let refreshTimer = null;
  let busy = false;
  let latestState = null;

  const byId = (id) => document.getElementById(id);
  const text = (value, fallback = 'Unavailable') => {
    const normalized = String(value ?? '').trim();
    return normalized || fallback;
  };
  const displayTime = (value) => {
    if (!value) return 'Not scheduled';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleString();
  };
  const canOwn = (role) => ['owner', 'local-admin'].includes(String(role || '').toLowerCase());

  function markup() {
    return `
      <section class="panel nexus-ai-operations-panel" id="nexusAiOperationsPanel" aria-labelledby="nexusAiOperationsTitle">
        <div class="panel-heading nexus-ai-operations-heading">
          <div>
            <span class="eyebrow">Shared Scheduler Operations</span>
            <h3 id="nexusAiOperationsTitle">Update Monitor & Discord Commands</h3>
            <p>Configure review-only recurring checks, manage update sources, inspect history, and use the supervised <code>/nexus</code> command group without exposing service tokens.</p>
          </div>
          <span class="tag" id="nexusAiOperationsBadge">Loading</span>
        </div>

        <div class="nexus-ai-monitor-summary" aria-live="polite">
          <div><span>Service</span><strong id="nexusAiMonitorService">Checking</strong><small id="nexusAiMonitorVersion">Bundled Nexus AI Core</small></div>
          <div><span>Last check</span><strong id="nexusAiMonitorLastOutcome">Never</strong><small id="nexusAiMonitorLastRun">Not run</small></div>
          <div><span>Next check</span><strong id="nexusAiMonitorNextRun">Not scheduled</strong><small id="nexusAiMonitorCadence">Shared scheduler</small></div>
          <div><span>Sources</span><strong id="nexusAiMonitorSourceCount">0</strong><small id="nexusAiMonitorSubscriptionCount">0 subscriptions</small></div>
        </div>

        <div class="nexus-ai-operations-grid">
          <div class="nexus-ai-operations-card">
            <div class="nexus-ai-card-heading"><div><span class="eyebrow">Schedule</span><h4>Recurring checks</h4></div></div>
            <label class="nexus-ai-toggle-row">
              <input id="nexusAiMonitorEnabled" type="checkbox">
              <span><strong>Enable shared-scheduler polling</strong><small>No second scheduler or automatic public announcement is created.</small></span>
            </label>
            <label class="field">
              <span>Interval (minutes)</span>
              <input id="nexusAiMonitorInterval" type="number" min="15" max="1440" step="15" value="60">
            </label>
            <div class="nexus-ai-button-row">
              <button class="button primary" id="nexusAiMonitorSave" type="button">Save monitor settings</button>
              <button class="button" id="nexusAiMonitorCheck" type="button">Check now</button>
            </div>
            <p class="nexus-ai-operation-message" id="nexusAiMonitorMessage" role="status"></p>
          </div>

          <div class="nexus-ai-operations-card">
            <div class="nexus-ai-card-heading"><div><span class="eyebrow">Sources</span><h4>Add update source</h4></div></div>
            <label class="field">
              <span>Provider</span>
              <select id="nexusAiSourceProvider">
                <option value="github-release">GitHub Releases</option>
                <option value="modrinth-project">Modrinth Project</option>
                <option value="curseforge-mod">CurseForge Mod</option>
                <option value="steam-news">Steam News</option>
              </select>
            </label>
            <label class="field">
              <span>Target</span>
              <input id="nexusAiSourceTarget" type="text" maxlength="200" placeholder="owner/repository">
              <small id="nexusAiSourceHint">Use owner/repository.</small>
            </label>
            <button class="button" id="nexusAiSourceAdd" type="button">Add source</button>
          </div>
        </div>

        <div class="nexus-ai-operations-columns">
          <div class="nexus-ai-list-card">
            <div class="nexus-ai-card-heading"><div><span class="eyebrow">Configured</span><h4>Monitor sources</h4></div></div>
            <div id="nexusAiSourceList" class="nexus-ai-source-list"><p class="muted">No sources configured.</p></div>
          </div>
          <div class="nexus-ai-list-card">
            <div class="nexus-ai-card-heading"><div><span class="eyebrow">Review Queue</span><h4>Recent checks</h4></div></div>
            <div id="nexusAiHistoryList" class="nexus-ai-history-list"><p class="muted">No checks recorded.</p></div>
          </div>
        </div>

        <div class="nexus-ai-command-note">
          <strong>Available Discord commands:</strong>
          <code>/nexus status</code>, <code>ask</code>, <code>updates</code>, <code>check</code>, <code>plan</code>, <code>subscribe</code>, and <code>unsubscribe</code>.
          All responses are ephemeral, mention-safe, permission-aware, rate-limited, and audited. Maintenance remains advisory-only.
        </div>
      </section>`;
  }

  function setMessage(message, tone = '') {
    const element = byId('nexusAiMonitorMessage');
    if (!element) return;
    element.textContent = message || '';
    element.dataset.tone = tone;
  }

  function setBusy(value) {
    busy = Boolean(value);
    const role = latestState?.role;
    const disabled = busy || !canOwn(role);
    ['nexusAiMonitorEnabled', 'nexusAiMonitorInterval', 'nexusAiMonitorSave', 'nexusAiMonitorCheck', 'nexusAiSourceProvider', 'nexusAiSourceTarget', 'nexusAiSourceAdd']
      .forEach((id) => { const element = byId(id); if (element) element.disabled = disabled; });
    document.querySelectorAll('[data-nexus-ai-remove-source]').forEach((button) => { button.disabled = disabled; });
  }

  function sourceLabel(source) {
    if (source.provider === 'github-release') return `${source.owner}/${source.repo}`;
    if (source.provider === 'modrinth-project') return source.project;
    if (source.provider === 'curseforge-mod') return `Mod ${source.modId}`;
    if (source.provider === 'steam-news') return `App ${source.appId}`;
    return source.id;
  }

  function renderSources(sources) {
    const container = byId('nexusAiSourceList');
    if (!container) return;
    container.replaceChildren();
    if (!sources.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No sources configured.';
      container.appendChild(empty);
      return;
    }
    for (const source of sources) {
      const row = document.createElement('div');
      row.className = 'nexus-ai-source-row';
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = sourceLabel(source);
      const detail = document.createElement('small');
      detail.textContent = `${source.provider} · ${source.allowedChannels?.join(', ') || 'stable'} · ID ${source.id}`;
      copy.append(title, detail);
      const button = document.createElement('button');
      button.className = 'text-button';
      button.type = 'button';
      button.dataset.nexusAiRemoveSource = source.id;
      button.textContent = 'Remove';
      button.addEventListener('click', () => removeSource(source.id));
      row.append(copy, button);
      container.appendChild(row);
    }
  }

  function renderHistory(history) {
    const container = byId('nexusAiHistoryList');
    if (!container) return;
    container.replaceChildren();
    if (!history.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'No checks recorded.';
      container.appendChild(empty);
      return;
    }
    for (const entry of history.slice(0, 10)) {
      const row = document.createElement('div');
      row.className = 'nexus-ai-history-row';
      const heading = document.createElement('div');
      const outcome = document.createElement('strong');
      outcome.textContent = entry.outcome || 'unknown';
      outcome.dataset.outcome = entry.outcome || 'unknown';
      const time = document.createElement('small');
      time.textContent = displayTime(entry.completedAt || entry.startedAt);
      heading.append(outcome, time);
      const summary = document.createElement('p');
      summary.textContent = entry.summary || entry.error || 'No summary was recorded.';
      row.append(heading, summary);
      container.appendChild(row);
    }
  }

  function render(state) {
    latestState = state || {};
    const settings = state?.settings || {};
    const sources = Array.isArray(state?.sources) ? state.sources : [];
    const subscriptions = Array.isArray(state?.subscriptions) ? state.subscriptions : [];
    const history = Array.isArray(state?.history) ? state.history : [];
    const service = state?.service || {};
    const runtime = service.runtime || {};

    byId('nexusAiOperationsBadge').textContent = service.ready ? 'Ready' : runtime.status || 'Unavailable';
    byId('nexusAiOperationsBadge').classList.toggle('good', Boolean(service.ready));
    byId('nexusAiMonitorService').textContent = service.ready ? 'Ready' : text(runtime.status, 'Unavailable');
    byId('nexusAiMonitorVersion').textContent = service.version ? `Nexus AI Core v${service.version}` : text(service.error, 'Bundled Nexus AI Core');
    byId('nexusAiMonitorLastOutcome').textContent = text(settings.lastOutcome, 'Never');
    byId('nexusAiMonitorLastRun').textContent = displayTime(settings.lastRunAt);
    byId('nexusAiMonitorNextRun').textContent = displayTime(settings.nextRunAt);
    byId('nexusAiMonitorCadence').textContent = settings.enabled ? `Every ${settings.intervalMinutes} minutes via shared scheduler` : 'Shared scheduler disabled';
    byId('nexusAiMonitorSourceCount').textContent = String(sources.length);
    byId('nexusAiMonitorSubscriptionCount').textContent = `${subscriptions.length} subscription${subscriptions.length === 1 ? '' : 's'}`;
    byId('nexusAiMonitorEnabled').checked = Boolean(settings.enabled);
    byId('nexusAiMonitorInterval').value = String(settings.intervalMinutes || 60);
    renderSources(sources);
    renderHistory(history);
    setBusy(busy);
    if (!canOwn(state?.role)) setMessage('Owner access is required to change monitor settings or run checks.', 'warning');
  }

  async function refresh({ quiet = false } = {}) {
    if (!window.khaos?.invoke || busy) return;
    try {
      const state = await window.khaos.invoke('nexus-ai-core:monitor-state');
      render(state);
      if (!quiet) setMessage('Nexus AI monitor state refreshed.', 'success');
    } catch (error) {
      if (!quiet) setMessage(error?.message || 'Nexus AI monitor state could not be loaded.', 'error');
    }
  }

  async function runOwnerAction(action, successMessage) {
    if (busy) return;
    setBusy(true);
    setMessage('Working…');
    try {
      const state = await action();
      render(state?.state || state);
      setMessage(successMessage, 'success');
    } catch (error) {
      setMessage(error?.message || 'The Nexus AI operation failed.', 'error');
    } finally {
      setBusy(false);
    }
  }

  function saveSettings() {
    return runOwnerAction(() => window.khaos.invoke('nexus-ai-core:monitor-save', {
      enabled: byId('nexusAiMonitorEnabled').checked,
      intervalMinutes: Number(byId('nexusAiMonitorInterval').value)
    }), 'Nexus AI monitor settings saved.');
  }

  function checkNow() {
    return runOwnerAction(() => window.khaos.invoke('nexus-ai-core:check-now', { reason: 'desktop-owner-manual-check' }), 'Nexus AI update check completed and was retained for review.');
  }

  function addSource() {
    const provider = byId('nexusAiSourceProvider').value;
    const target = byId('nexusAiSourceTarget').value.trim();
    if (!target) {
      setMessage('Enter a source target before adding it.', 'warning');
      return;
    }
    return runOwnerAction(() => window.khaos.invoke('nexus-ai-core:source-save', { provider, target }), 'Nexus AI monitor source saved.').then(() => {
      byId('nexusAiSourceTarget').value = '';
    });
  }

  function removeSource(id) {
    return runOwnerAction(() => window.khaos.invoke('nexus-ai-core:source-remove', id), 'Nexus AI monitor source removed.');
  }

  function updateSourceHint() {
    const provider = byId('nexusAiSourceProvider')?.value;
    const target = byId('nexusAiSourceTarget');
    const hint = byId('nexusAiSourceHint');
    const details = {
      'github-release': ['owner/repository', 'Use owner/repository.'],
      'modrinth-project': ['project slug or ID', 'Use a Modrinth project slug or ID.'],
      'curseforge-mod': ['numeric mod ID', 'Use the positive numeric CurseForge mod ID.'],
      'steam-news': ['numeric Steam app ID', 'Use the positive numeric Steam app ID.']
    }[provider] || ['source target', 'Enter the provider source target.'];
    if (target) target.placeholder = details[0];
    if (hint) hint.textContent = details[1];
  }

  function install() {
    if (byId('nexusAiOperationsPanel')) return true;
    const view = byId('view-ai');
    if (!view) return false;
    view.insertAdjacentHTML('beforeend', markup());
    byId('nexusAiMonitorSave').addEventListener('click', saveSettings);
    byId('nexusAiMonitorCheck').addEventListener('click', checkNow);
    byId('nexusAiSourceAdd').addEventListener('click', addSource);
    byId('nexusAiSourceProvider').addEventListener('change', updateSourceHint);
    updateSourceHint();
    refresh();
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && byId('view-ai')?.classList.contains('active')) refresh({ quiet: true });
    }, REFRESH_INTERVAL_MS);
    refreshTimer.unref?.();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && byId('view-ai')?.classList.contains('active')) refresh({ quiet: true });
    });
    return true;
  }

  function waitForWorkspace() {
    if (install()) return;
    if (Date.now() - startedAt >= INSTALL_TIMEOUT_MS) return;
    setTimeout(waitForWorkspace, 250);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', waitForWorkspace, { once: true });
  else waitForWorkspace();

  window.addEventListener('beforeunload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
  }, { once: true });
})();
