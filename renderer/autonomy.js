'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  let current = null;
  let settingsSignature = '';

  function notify(message) {
    const toast = byId('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3800);
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
    return String(value || 'idle').replace(/(^|[-_\s])\w/g, (char) => char.toUpperCase());
  }

  function relativeTime(value) {
    if (!value) return 'Never';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(value).toLocaleString();
  }

  function ensureUi() {
    if (!document.querySelector('link[href="autonomy.css"]')) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = 'autonomy.css';
      document.head.appendChild(stylesheet);
    }

    if (typeof viewMeta !== 'undefined') {
      viewMeta.autonomy = ['Operator Console', 'Safe recovery, maintenance, backups, health checks, and role-based access.'];
    }

    if (!document.querySelector('[data-view="autonomy"]')) {
      const navigation = byId('navigation');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'autonomy';
      button.innerHTML = '<span>⚡</span>Operator Console';
      navigation?.appendChild(button);
    }

    const topbar = document.querySelector('.topbar');
    if (topbar && !byId('accessRoleBadge')) {
      const right = document.createElement('div');
      right.className = 'topbar-status-group';
      const currentStatus = byId('topStatus');
      const badge = document.createElement('div');
      badge.id = 'accessRoleBadge';
      badge.className = 'access-role-badge';
      badge.textContent = 'Local Admin';
      if (currentStatus) {
        currentStatus.parentElement.insertBefore(right, currentStatus);
        right.appendChild(badge);
        right.appendChild(currentStatus);
      }
    }

    if (!byId('view-autonomy')) {
      const view = document.createElement('section');
      view.className = 'view';
      view.id = 'view-autonomy';
      view.innerHTML = `
        <div class="section-intro inline">
          <div><h2>Operator Console</h2><p>Routine controls designed for safe, low-maintenance operation.</p></div>
          <span class="severity" id="autonomyStatus">Idle</span>
        </div>

        <div class="operator-hero">
          <div>
            <span class="eyebrow">Current desktop access</span>
            <h2 id="operatorRole">Local Admin</h2>
            <p id="operatorReason">Access control is not enabled.</p>
          </div>
          <div class="operator-actions">
            <button class="button primary" id="runRecoveryButton">Run Safe Recovery</button>
            <button class="button" id="runMaintenanceButton">Start Maintenance Mode</button>
            <button class="button" id="runHealthCheckButton">Check All Servers</button>
            <button class="button" id="createVerifiedBackupButton">Create Verified Backup</button>
          </div>
        </div>

        <div class="metric-grid autonomy-metrics">
          <article class="metric-card"><span>Last verified backup</span><strong id="lastAutoBackup">Never</strong><small id="lastBackupValidity">No automatic backup yet</small></article>
          <article class="metric-card"><span>Last health check</span><strong id="lastHealthCheck">Never</strong><small id="offlineServerCount">No check completed</small></article>
          <article class="metric-card"><span>Last recovery</span><strong id="lastRecovery">Never</strong><small id="lastRecoveryResult">No recovery run</small></article>
          <article class="metric-card"><span>Last maintenance</span><strong id="lastMaintenance">Never</strong><small id="lastMaintenanceResult">No maintenance run</small></article>
        </div>

        <div class="two-column autonomy-columns">
          <article class="panel">
            <div class="panel-heading"><div><span class="eyebrow">Attention</span><h3>What needs action</h3></div><span class="tag" id="attentionCount">0 items</span></div>
            <div id="autonomyAttention" class="attention-list"><p>No operator attention is required.</p></div>
            <div class="form-actions"><button class="button" id="openAutomaticBackupsButton">Open Backup Folder</button></div>
          </article>

          <article class="panel">
            <div class="panel-heading"><div><span class="eyebrow">Server health</span><h3>RCON connectivity</h3></div></div>
            <div id="autonomyServerHealth" class="server-health-list"><p>No server health check has completed.</p></div>
          </article>
        </div>

        <article class="panel autonomy-settings-panel">
          <div class="panel-heading"><div><span class="eyebrow">Owner setup</span><h3>Autonomous operation</h3><p>These controls determine how Khaos Nexus protects itself and assists operators.</p></div></div>
          <div class="settings-split">
            <div>
              <label class="toggle-row"><span><strong>Enable Discord-based desktop access control</strong><small>Owner, operator, viewer, and locked roles are enforced by the main process.</small></span><input id="accessControlEnabled" type="checkbox"></label>
              <label>Viewer Discord user IDs<input id="viewerUserIds" placeholder="View-only user IDs separated by commas"></label>
              <div class="access-warning">Enable access control only after signing in as the configured owner. To recover from a lockout, create an empty file at the recovery path shown below and restart Khaos Nexus.</div>
              <div class="callout" id="accessRecoveryPath">Recovery path not loaded.</div>
              <button class="button" id="copyAccessRecoveryPathButton">Copy Recovery Path</button>
            </div>
            <div>
              <label class="toggle-row"><span><strong>Automatic verified backups</strong><small>Creates local backups on schedule and removes older backups after retention is reached.</small></span><input id="automaticBackupsEnabled" type="checkbox"></label>
              <div class="form-grid">
                <label>Backup interval (hours)<input id="backupIntervalHours" type="number" min="1" max="168"></label>
                <label>Backups retained<input id="backupRetentionCount" type="number" min="3" max="90"></label>
              </div>
              <label class="toggle-row"><span><strong>Self-healing bot startup</strong><small>Restarts a stopped bot when automatic startup is enabled, with cooldown protection.</small></span><input id="selfHealingEnabled" type="checkbox"></label>
              <label>Server health interval (minutes)<input id="healthCheckMinutes" type="number" min="5" max="120"></label>
            </div>
          </div>

          <div class="settings-split notification-settings">
            <div>
              <label class="toggle-row"><span><strong>Discord operator notifications</strong><small>Sends maintenance, recovery, repeated server failure, and desktop-error notices.</small></span><input id="discordNotificationsEnabled" type="checkbox"></label>
              <label>Private operator channel ID<input id="notificationChannelId" inputmode="numeric" placeholder="Discord channel ID"></label>
            </div>
            <div>
              <label>Maintenance warning<textarea id="maintenanceWarning" rows="4" maxlength="500"></textarea></label>
              <label class="toggle-row"><span><strong>Restart the Discord bot during Maintenance Mode</strong><small>Game servers are warned and saved before the supervised bot restart.</small></span><input id="maintenanceRestartBot" type="checkbox"></label>
            </div>
          </div>
          <div class="form-actions"><button class="button primary" id="saveAutonomySettingsButton">Save Autonomous Settings</button></div>
        </article>`;
      const monitorView = byId('view-monitor');
      monitorView?.parentElement.insertBefore(view, monitorView);
    }
  }

  function renderHealth(health = {}) {
    const entries = Object.entries(health);
    byId('autonomyServerHealth').innerHTML = entries.length ? entries.map(([id, item]) => `
      <div class="server-health-row ${item.status}">
        <span class="health-dot"></span>
        <div><strong>${escapeHtml(item.name || id)}</strong><small>${escapeHtml(item.detail || '')}</small></div>
        <span>${titleCase(item.status)} · ${item.failures || 0} failures</span>
      </div>`).join('') : '<p>No server health check has completed.</p>';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function setOwnerFields(settings) {
    const signature = JSON.stringify(settings || {});
    if (signature === settingsSignature) return;
    settingsSignature = signature;
    byId('accessControlEnabled').checked = Boolean(settings.accessControlEnabled);
    byId('viewerUserIds').value = Array.isArray(settings.viewerUserIds) ? settings.viewerUserIds.join(', ') : '';
    byId('automaticBackupsEnabled').checked = Boolean(settings.automaticBackupsEnabled);
    byId('backupIntervalHours').value = settings.backupIntervalHours || 24;
    byId('backupRetentionCount').value = settings.backupRetentionCount || 14;
    byId('selfHealingEnabled').checked = Boolean(settings.selfHealingEnabled);
    byId('healthCheckMinutes').value = settings.healthCheckMinutes || 10;
    byId('discordNotificationsEnabled').checked = Boolean(settings.discordNotificationsEnabled);
    byId('notificationChannelId').value = settings.notificationChannelId || '';
    byId('maintenanceWarning').value = settings.maintenanceWarning || '';
    byId('maintenanceRestartBot').checked = settings.maintenanceRestartBot !== false;
  }

  function applyPermissions(access) {
    const canOperate = Boolean(access?.canOperate);
    const canOwn = Boolean(access?.canOwn);
    const role = access?.role || 'locked';

    const operatorIds = [
      'startButton', 'stopButton', 'restartButton', 'sendCurrentErrorButton', 'reportIssueButton',
      'exportDiagnosticsButton', 'processMonitorQueueButton', 'exportBackupButton', 'checkUpdatesButton',
      'downloadUpdateButton', 'runRecoveryButton', 'runMaintenanceButton', 'runHealthCheckButton',
      'createVerifiedBackupButton'
    ];
    const ownerIds = [
      'saveDiscordButton', 'saveAndStartButton', 'saveDiscordLoginButton', 'newServerButton',
      'saveServerButton', 'saveModulesButton', 'saveMonitorButton', 'verifyGithubButton',
      'removeGithubTokenButton', 'clearMonitorQueueButton', 'saveSettingsButton', 'installUpdateButton',
      'importBackupButton', 'openDataButton', 'saveAutonomySettingsButton', 'copyAccessRecoveryPathButton'
    ];
    operatorIds.forEach((id) => { const element = byId(id); if (element) element.disabled = element.disabled || !canOperate; });
    ownerIds.forEach((id) => { const element = byId(id); if (element) element.disabled = !canOwn; });

    document.querySelectorAll('[data-server-test]').forEach((button) => { button.disabled = !canOperate; });
    document.querySelectorAll('[data-server-edit], [data-server-remove]').forEach((button) => { button.disabled = !canOwn; });
    document.body.dataset.accessRole = role;
  }

  function render(next) {
    current = next;
    const autonomy = next?.autonomy || {};
    const settings = autonomy.settings || {};
    const access = autonomy.access || {};
    setOwnerFields(settings);

    byId('autonomyStatus').textContent = titleCase(autonomy.status || 'idle');
    byId('autonomyStatus').className = `severity autonomy-${autonomy.status || 'idle'}`;
    byId('operatorRole').textContent = titleCase(access.role || 'locked');
    byId('operatorReason').textContent = access.reason || '';
    byId('accessRoleBadge').textContent = titleCase(access.role || 'locked');
    byId('accessRoleBadge').className = `access-role-badge role-${access.role || 'locked'}`;

    byId('lastAutoBackup').textContent = relativeTime(autonomy.lastBackupAt);
    byId('lastBackupValidity').textContent = autonomy.lastBackupValid ? 'Verified successfully' : 'No verified backup yet';
    byId('lastHealthCheck').textContent = relativeTime(autonomy.lastHealthCheckAt);
    const offline = Object.values(autonomy.serverHealth || {}).filter((item) => item.status === 'offline').length;
    byId('offlineServerCount').textContent = `${offline} offline`;
    byId('lastRecovery').textContent = relativeTime(autonomy.lastRecoveryAt);
    byId('lastRecoveryResult').textContent = autonomy.lastRecoverySummary?.ok === false ? 'Attention required' : (autonomy.lastRecoverySummary ? 'Completed' : 'No recovery run');
    byId('lastMaintenance').textContent = relativeTime(autonomy.lastMaintenanceAt);
    byId('lastMaintenanceResult').textContent = autonomy.lastMaintenanceSummary?.ok === false ? 'Attention required' : (autonomy.lastMaintenanceSummary ? 'Completed' : 'No maintenance run');

    const attention = Array.isArray(autonomy.attention) ? autonomy.attention : [];
    byId('attentionCount').textContent = `${attention.length} item${attention.length === 1 ? '' : 's'}`;
    byId('autonomyAttention').innerHTML = attention.length
      ? attention.map((item) => `<div class="attention-item">${escapeHtml(item)}</div>`).join('')
      : '<p>No operator attention is required.</p>';
    byId('accessRecoveryPath').textContent = autonomy.recoveryFlagPath ? `Lockout recovery flag: ${autonomy.recoveryFlagPath}` : 'Recovery path not loaded.';
    renderHealth(autonomy.serverHealth || {});

    const busy = ['recovering', 'maintenance'].includes(autonomy.status);
    byId('runRecoveryButton').disabled = busy || !access.canOperate;
    byId('runMaintenanceButton').disabled = busy || !access.canOperate;
    byId('runHealthCheckButton').disabled = busy || !access.canOperate;
    byId('createVerifiedBackupButton').disabled = busy || !access.canOperate;
    applyPermissions(access);
  }

  async function refresh() {
    const next = await invoke('app:get-state');
    render(next);
    return next;
  }

  function bind() {
    byId('runRecoveryButton').addEventListener('click', async () => {
      notify('Safe Recovery started.');
      const result = await invoke('autonomy:recover');
      await refresh();
      notify(result.ok ? 'Safe Recovery completed successfully.' : 'Recovery completed with items needing attention.');
    });
    byId('runMaintenanceButton').addEventListener('click', async () => {
      if (!confirm('Start Maintenance Mode now? Players will be warned and configured game worlds will be saved.')) return;
      notify('Maintenance Mode started.');
      const result = await invoke('autonomy:maintenance');
      await refresh();
      notify(result.ok ? 'Maintenance Mode completed.' : 'Maintenance completed with items needing attention.');
    });
    byId('runHealthCheckButton').addEventListener('click', async () => {
      const result = await invoke('autonomy:health-check');
      await refresh();
      notify(`Server health check complete. ${result.offline || 0} offline.`);
    });
    byId('createVerifiedBackupButton').addEventListener('click', async () => {
      await invoke('autonomy:create-backup');
      await refresh();
      notify('Verified backup created.');
    });
    byId('openAutomaticBackupsButton').addEventListener('click', () => invoke('autonomy:open-backups'));
    byId('copyAccessRecoveryPathButton').addEventListener('click', async () => {
      const result = await invoke('autonomy:copy-recovery-path');
      notify(`Copied ${result.path}`);
    });
    byId('saveAutonomySettingsButton').addEventListener('click', async () => {
      const payload = {
        accessControlEnabled: byId('accessControlEnabled').checked,
        viewerUserIds: byId('viewerUserIds').value.split(',').map((item) => item.trim()).filter(Boolean),
        automaticBackupsEnabled: byId('automaticBackupsEnabled').checked,
        backupIntervalHours: Number(byId('backupIntervalHours').value),
        backupRetentionCount: Number(byId('backupRetentionCount').value),
        selfHealingEnabled: byId('selfHealingEnabled').checked,
        healthCheckMinutes: Number(byId('healthCheckMinutes').value),
        discordNotificationsEnabled: byId('discordNotificationsEnabled').checked,
        notificationChannelId: byId('notificationChannelId').value,
        maintenanceWarning: byId('maintenanceWarning').value,
        maintenanceRestartBot: byId('maintenanceRestartBot').checked
      };
      await invoke('autonomy:save-settings', payload);
      await refresh();
      notify('Autonomous operation settings saved.');
    });
    window.khaos.onState(render);
  }

  async function initialize() {
    ensureUi();
    bind();
    render(await invoke('app:get-state'));
    setInterval(() => {
      if (!current?.autonomy) return;
      byId('lastAutoBackup').textContent = relativeTime(current.autonomy.lastBackupAt);
      byId('lastHealthCheck').textContent = relativeTime(current.autonomy.lastHealthCheckAt);
      byId('lastRecovery').textContent = relativeTime(current.autonomy.lastRecoveryAt);
      byId('lastMaintenance').textContent = relativeTime(current.autonomy.lastMaintenanceAt);
    }, 30000);
  }

  initialize().catch((error) => notify(`Operator Console failed to initialize: ${error.message}`));
})();
