'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  let current = null;
  let lastLocalTest = [];

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

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function ensureUi() {
    if (!document.querySelector('link[href="readiness.css"]')) {
      const stylesheet = document.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = 'readiness.css';
      document.head.appendChild(stylesheet);
    }

    if (typeof viewMeta !== 'undefined') {
      viewMeta.readiness = ['Readiness Center', 'First-run setup, safe local testing, and explicit live connection checks.'];
    }

    if (!document.querySelector('[data-view="readiness"]')) {
      const navigation = byId('navigation');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'readiness';
      button.innerHTML = '<span>✓</span>Readiness Center';
      navigation?.appendChild(button);
    }

    if (byId('view-readiness')) return;
    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-readiness';
    view.innerHTML = `
      <div class="section-intro"><h2>First-run Readiness Center</h2><p>See exactly what is ready, what still needs information, and which tests are safe to run before touching Discord or a live game server.</p></div>

      <div class="readiness-hero">
        <div class="readiness-score" id="readinessScore"><div><strong id="readinessPercent">0%</strong><span>ready</span></div></div>
        <div>
          <span class="eyebrow">Setup readiness</span>
          <h2 id="readinessHeadline">Checking Khaos Nexus</h2>
          <p id="readinessSummary">Reading the current protected configuration.</p>
        </div>
        <div class="readiness-actions">
          <button class="button primary" id="runLocalSelfTestButton">Run Safe Local Self-Test</button>
          <button class="button" id="refreshReadinessButton">Refresh Checklist</button>
          <button class="button" id="openReadinessSetupButton" data-view-link="setup">Open Discord Setup</button>
        </div>
      </div>

      <div class="readiness-grid">
        <article class="readiness-group"><h3>Desktop foundation</h3><div class="readiness-list" id="desktopReadinessList"></div></article>
        <article class="readiness-group"><h3>Discord and operator access</h3><div class="readiness-list" id="discordReadinessList"></div></article>
        <article class="readiness-group"><h3>Autonomous maintenance</h3><div class="readiness-list" id="autonomyReadinessList"></div></article>
        <article class="readiness-group"><h3>Game servers and reporting</h3><div class="readiness-list" id="externalReadinessList"></div></article>
      </div>

      <article class="panel self-test-panel">
        <div class="panel-heading"><div><span class="eyebrow">No live connections</span><h3>Safe Local Self-Test</h3><p>This test reads local state and creates a verified backup. It does not contact Discord, GitHub, or any game server.</p></div><span class="severity" id="localSelfTestStatus">Not Run</span></div>
        <div class="self-test-result" id="localSelfTestResults"><div class="test-line"><strong>Waiting to run</strong><small>The result of each local safety check will appear here.</small></div></div>
      </article>

      <article class="panel self-test-panel">
        <div class="panel-heading"><div><span class="eyebrow">Explicit live verification</span><h3>Connection Tests for Home</h3><p>These buttons contact the named service only when you select them.</p></div></div>
        <div class="live-test-grid">
          <div class="live-test-card"><h4>Discord identity</h4><p>Refresh the encrypted Discord operator session and verify the current allowlist role.</p><button class="button" id="readinessDiscordTestButton">Refresh Discord Login</button></div>
          <div class="live-test-card"><h4>GitHub reporting</h4><p>Verify the configured repository and protected fine-grained token without creating an issue.</p><button class="button" id="readinessGithubTestButton">Verify GitHub Connection</button></div>
          <div class="live-test-card"><h4>Game-server RCON</h4><p>Run the existing read-only status command against every enabled configured server.</p><button class="button" id="readinessServerTestButton">Check All Servers</button></div>
        </div>
        <div class="readiness-note">Maintenance Mode is deliberately not part of automatic readiness testing. Run it manually during a quiet window after the read-only RCON checks pass.</div>
      </article>`;

    const autonomyView = byId('view-autonomy');
    if (autonomyView) autonomyView.parentElement.insertBefore(view, autonomyView);
    else byId('view-monitor')?.parentElement.insertBefore(view, byId('view-monitor'));
  }

  function check(status, name, detail, options = {}) {
    return {
      status,
      name,
      detail,
      required: options.required !== false,
      weight: options.weight || 1
    };
  }

  function deriveChecks(next) {
    const config = next?.config || {};
    const discord = config.discord || {};
    const auth = next?.discordAuth || {};
    const autonomy = next?.autonomy || {};
    const settings = autonomy.settings || {};
    const access = autonomy.access || {};
    const servers = Array.isArray(config.servers) ? config.servers : [];
    const enabledServers = servers.filter((server) => server.enabled !== false);
    const missingPasswords = enabledServers.filter((server) => !server.hasPassword);
    const invalidServers = enabledServers.filter((server) => !server.host || !Number(server.port));

    const desktop = [
      check(next?.app?.secureStorageAvailable ? 'pass' : 'action', 'Protected credential storage', next?.app?.secureStorageAvailable ? 'Windows protected storage is available.' : 'Protected storage is unavailable; credentials cannot be stored safely.'),
      check(config.general?.autoRestart ? 'pass' : 'warning', 'Supervised crash recovery', config.general?.autoRestart ? 'Automatic bot restart is enabled.' : 'Automatic bot restart is currently disabled.'),
      check(config.general?.startWithWindows ? 'pass' : 'optional', 'Start with Windows', config.general?.startWithWindows ? 'Khaos Nexus will open after a Windows login.' : 'Optional: enable this after testing the application.', { required: false }),
      check(autonomy.lastBackupValid ? 'pass' : 'warning', 'Verified backup', autonomy.lastBackupValid ? 'At least one backup has passed format verification.' : 'Run the Safe Local Self-Test to create the first verified backup.')
    ];

    const discordChecks = [
      check(config.hasDiscordToken ? 'pass' : 'action', 'Discord bot token', config.hasDiscordToken ? 'A bot token is stored in protected storage.' : 'The Discord bot token still needs to be entered.'),
      check(discord.guildId ? 'pass' : 'action', 'Khaos Nexus server ID', discord.guildId ? `Configured server ID: ${discord.guildId}` : 'The Discord server ID is missing.'),
      check(discord.ownerUserId ? 'pass' : 'action', 'Owner Discord ID', discord.ownerUserId ? `Configured owner ID: ${discord.ownerUserId}` : 'The owner Discord user ID is missing.'),
      check(discord.oauthClientId ? 'pass' : 'action', 'Discord OAuth application ID', discord.oauthClientId ? 'Desktop browser login is configured.' : 'Add the Discord Application ID for operator login.'),
      check(String(discord.oauthRedirectUri || '') === 'http://127.0.0.1:43119/callback' ? 'pass' : 'warning', 'OAuth redirect URI', discord.oauthRedirectUri || 'No redirect configured.'),
      check(Array.isArray(discord.operatorUserIds) && discord.operatorUserIds.length ? 'pass' : 'warning', 'Trusted operator', Array.isArray(discord.operatorUserIds) && discord.operatorUserIds.length ? `${discord.operatorUserIds.length} additional operator account(s) configured.` : 'Add your wife’s Discord user ID before enabling access control.'),
      check(auth.user && auth.authorized ? 'pass' : (settings.accessControlEnabled ? 'action' : 'warning'), 'Current operator session', auth.user ? `${auth.user.globalName || auth.user.username}: ${auth.authorizedReason || access.reason || 'session loaded'}` : 'No Discord operator is currently signed in.')
    ];

    const autonomyChecks = [
      check(settings.automaticBackupsEnabled ? 'pass' : 'warning', 'Automatic backups', settings.automaticBackupsEnabled ? `Every ${settings.backupIntervalHours || 24} hours; retain ${settings.backupRetentionCount || 14}.` : 'Automatic backups are disabled.'),
      check(settings.selfHealingEnabled ? 'pass' : 'warning', 'Bot self-healing', settings.selfHealingEnabled ? 'Guarded self-healing is enabled.' : 'Self-healing is disabled.'),
      check(settings.accessControlEnabled ? (access.role === 'owner' ? 'pass' : 'warning') : 'optional', 'Desktop access enforcement', settings.accessControlEnabled ? `Enabled; current role is ${access.role || 'locked'}.` : 'Keep disabled until owner and operator sign-ins are tested.', { required: false }),
      check(settings.discordNotificationsEnabled ? (settings.notificationChannelId ? 'pass' : 'action') : 'optional', 'Private operator alerts', settings.discordNotificationsEnabled ? (settings.notificationChannelId ? 'A private channel is configured.' : 'Notifications are enabled but the channel ID is missing.') : 'Optional: configure after the bot is online.', { required: false }),
      check(autonomy.recoveryFlagPath ? 'pass' : 'warning', 'Local lockout recovery', autonomy.recoveryFlagPath ? 'The emergency access-control recovery path is available.' : 'Recovery path has not loaded.')
    ];

    const external = [
      check(enabledServers.length ? 'pass' : 'optional', 'Configured game servers', enabledServers.length ? `${enabledServers.length} enabled RCON target(s).` : 'No enabled game servers yet; this does not block Discord bot use.', { required: false }),
      check(!missingPasswords.length ? (enabledServers.length ? 'pass' : 'optional') : 'action', 'RCON passwords', missingPasswords.length ? `${missingPasswords.length} enabled server(s) are missing protected passwords.` : (enabledServers.length ? 'All enabled servers have stored passwords.' : 'No RCON passwords are needed yet.'), { required: enabledServers.length > 0 }),
      check(!invalidServers.length ? (enabledServers.length ? 'pass' : 'optional') : 'action', 'RCON addresses', invalidServers.length ? `${invalidServers.length} enabled server(s) have incomplete host or port settings.` : (enabledServers.length ? 'All enabled servers have host and port values.' : 'No server addresses configured yet.'), { required: enabledServers.length > 0 }),
      check(config.monitor?.autoReportEnabled ? (config.hasGithubToken ? 'pass' : 'action') : 'optional', 'Automatic GitHub reporting', config.monitor?.autoReportEnabled ? (config.hasGithubToken ? 'Enabled with a protected token.' : 'Enabled, but the GitHub token is missing.') : 'Optional and disabled by default.', { required: Boolean(config.monitor?.autoReportEnabled) }),
      check(config.monitor?.reportRepository ? 'pass' : 'warning', 'GitHub report repository', config.monitor?.reportRepository || 'No report repository configured.')
    ];

    return { desktop, discord: discordChecks, autonomy: autonomyChecks, external };
  }

  function renderList(id, checks) {
    byId(id).innerHTML = checks.map((item) => `
      <div class="readiness-item ${item.status}">
        <span class="readiness-dot"></span>
        <div><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.detail)}</small></div>
        <span class="readiness-state">${escapeHtml(item.status)}</span>
      </div>`).join('');
  }

  function scoreChecks(groups) {
    const required = Object.values(groups).flat().filter((item) => item.required);
    const total = required.reduce((sum, item) => sum + item.weight, 0) || 1;
    const earned = required.reduce((sum, item) => {
      if (item.status === 'pass') return sum + item.weight;
      if (item.status === 'warning') return sum + (item.weight * 0.5);
      return sum;
    }, 0);
    return Math.round((earned / total) * 100);
  }

  function render(next) {
    current = next;
    const groups = deriveChecks(next);
    renderList('desktopReadinessList', groups.desktop);
    renderList('discordReadinessList', groups.discord);
    renderList('autonomyReadinessList', groups.autonomy);
    renderList('externalReadinessList', groups.external);

    const score = scoreChecks(groups);
    const actions = Object.values(groups).flat().filter((item) => item.required && item.status === 'action');
    const warnings = Object.values(groups).flat().filter((item) => item.required && item.status === 'warning');
    byId('readinessPercent').textContent = `${score}%`;
    byId('readinessScore').style.setProperty('--score', `${score}%`);
    byId('readinessHeadline').textContent = actions.length ? `${actions.length} required item${actions.length === 1 ? '' : 's'} remaining` : (warnings.length ? 'Ready for guided testing' : 'Configuration looks ready');
    byId('readinessSummary').textContent = actions.length
      ? actions.map((item) => item.name).join(', ')
      : (warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'} can be handled during the first test.` : 'All required local configuration checks pass.');

    const access = next?.autonomy?.access || {};
    byId('runLocalSelfTestButton').disabled = !access.canOperate;
    byId('readinessDiscordTestButton').disabled = !next?.discordAuth?.configured || Boolean(next?.discordAuth?.loginInProgress);
    byId('readinessGithubTestButton').disabled = !access.canOwn || !next?.config?.hasGithubToken;
    byId('readinessServerTestButton').disabled = !access.canOperate || !(next?.config?.servers || []).some((server) => server.enabled !== false);
  }

  function renderLocalTest(results, status) {
    lastLocalTest = results;
    byId('localSelfTestStatus').textContent = status;
    byId('localSelfTestStatus').className = `severity ${status === 'Passed' ? 'good' : (status === 'Attention' ? 'bad' : '')}`;
    byId('localSelfTestResults').innerHTML = results.map((result) => `
      <div class="test-line ${result.status}"><strong>${escapeHtml(result.name)}</strong><small>${escapeHtml(result.detail)}</small></div>`).join('');
  }

  async function runLocalSelfTest() {
    byId('runLocalSelfTestButton').disabled = true;
    byId('runLocalSelfTestButton').textContent = 'Testing…';
    const results = [];
    try {
      const initial = await invoke('app:get-state');
      results.push({ status: initial.app?.secureStorageAvailable ? 'pass' : 'fail', name: 'Protected storage', detail: initial.app?.secureStorageAvailable ? 'Windows protected credential storage is available.' : 'Protected storage is unavailable.' });
      results.push({ status: initial.config ? 'pass' : 'fail', name: 'Configuration loading', detail: initial.config ? 'Configuration loaded and can be read by the isolated renderer.' : 'Application configuration did not load.' });
      results.push({ status: initial.autonomy?.recoveryFlagPath ? 'pass' : 'warning', name: 'Lockout recovery path', detail: initial.autonomy?.recoveryFlagPath || 'The recovery path has not loaded.' });

      const backup = await invoke('autonomy:create-backup');
      results.push({ status: backup?.valid ? 'pass' : 'fail', name: 'Verified backup write/read test', detail: backup?.valid ? `Backup verified: ${backup.filePath}` : 'Backup did not report successful verification.' });

      const latest = await invoke('app:get-state');
      results.push({ status: latest.autonomy?.lastBackupValid ? 'pass' : 'fail', name: 'Backup state persistence', detail: latest.autonomy?.lastBackupValid ? 'The verified-backup result persisted in application state.' : 'Verified-backup state did not persist.' });
      results.push({ status: latest.applicationMonitor ? 'pass' : 'warning', name: 'Application Monitor initialization', detail: latest.applicationMonitor ? `Monitor state: ${latest.applicationMonitor.status || 'idle'}.` : 'Application Monitor state is unavailable.' });
      results.push({ status: latest.bot ? 'pass' : 'fail', name: 'Bot supervisor initialization', detail: latest.bot ? `Supervisor state: ${latest.bot.status || 'stopped'}. No bot start was attempted.` : 'Bot supervisor state is unavailable.' });

      const hasFailure = results.some((item) => item.status === 'fail');
      const hasWarning = results.some((item) => item.status === 'warning');
      renderLocalTest(results, hasFailure ? 'Failed' : (hasWarning ? 'Attention' : 'Passed'));
      render(latest);
      notify(hasFailure ? 'Local self-test found a problem.' : 'Safe Local Self-Test completed. No live services were contacted.');
    } catch (error) {
      results.push({ status: 'fail', name: 'Self-test interrupted', detail: error.message || String(error) });
      renderLocalTest(results, 'Failed');
    } finally {
      byId('runLocalSelfTestButton').textContent = 'Run Safe Local Self-Test';
      if (current) render(current);
    }
  }

  function bind() {
    byId('runLocalSelfTestButton').addEventListener('click', runLocalSelfTest);
    byId('refreshReadinessButton').addEventListener('click', async () => {
      render(await invoke('app:get-state'));
      notify('Readiness checklist refreshed.');
    });
    byId('readinessDiscordTestButton').addEventListener('click', async () => {
      const result = await invoke('discord-auth:refresh');
      const latest = await invoke('app:get-state');
      render(latest);
      notify(`Discord session refreshed for ${result.user?.globalName || result.user?.username || 'the current account'}.`);
    });
    byId('readinessGithubTestButton').addEventListener('click', async () => {
      const result = await invoke('monitor:verify');
      notify(`GitHub connection verified for ${result.repository}.`);
      render(await invoke('app:get-state'));
    });
    byId('readinessServerTestButton').addEventListener('click', async () => {
      const result = await invoke('autonomy:health-check');
      notify(`RCON health check completed. ${result.offline || 0} server(s) offline.`);
      render(await invoke('app:get-state'));
    });
    window.khaosStateHub.subscribe(render);
  }

  async function initialize() {
    ensureUi();
    bind();
    render(await invoke('app:get-state'));
  }

  initialize().catch((error) => notify(`Readiness Center failed to initialize: ${error.message}`));
})();
