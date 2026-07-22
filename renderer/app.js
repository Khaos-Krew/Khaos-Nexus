'use strict';

const state = { app: null, config: null, bot: null, update: null, logs: [], configSignature: '' };
const viewMeta = {
  dashboard: ['Dashboard', 'Run and monitor the Discord bot without a website dependency.'],
  setup: ['Bot Setup', 'Connect the Discord application using protected local credentials.'],
  servers: ['Game Servers', 'Configure Ark, Palworld, and generic RCON connections.'],
  monitor: ['Health Monitor', 'Crash recovery and redacted error reporting.'],
  logs: ['Live Logs', 'Inspect current manager and bot activity.'],
  settings: ['Settings', 'Control startup, recovery, tray, and update behavior.']
};

const $ = (id) => document.getElementById(id);
const titleCase = (value) => String(value || '').replace(/(^|[-_\s])\w/g, (char) => char.toUpperCase());

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 3200);
}

function showView(name) {
  document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === `view-${name}`));
  document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === name));
  $('viewTitle').textContent = viewMeta[name][0];
  $('viewSubtitle').textContent = viewMeta[name][1];
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.floor(total % 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function relativeTime(value) {
  if (!value) return '—';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return new Date(value).toLocaleString();
}

function applyState(next) {
  const nextConfigSignature = next.config ? JSON.stringify(next.config) : state.configSignature;
  const configChanged = nextConfigSignature !== state.configSignature;
  Object.assign(state, next);
  if (configChanged) state.configSignature = nextConfigSignature;
  const bot = state.bot || {};
  const config = state.config || {};
  const status = bot.status || 'stopped';
  const statusText = titleCase(status);

  $('topStatus').className = `status-pill ${status}`;
  $('topStatus').querySelector('strong').textContent = statusText;
  $('metricStatus').textContent = statusText;
  $('metricUser').textContent = bot.ready?.username || 'Not connected';
  $('metricUptime').textContent = formatDuration(bot.heartbeat?.uptimeSeconds || 0);
  $('metricPing').textContent = bot.heartbeat?.ping === undefined ? '—' : `${bot.heartbeat.ping} ms`;
  $('metricCrashes').textContent = bot.crashCount || 0;
  $('metricRestart').textContent = bot.autoRestartBlocked ? 'Restart safety lock active' : (config.general?.autoRestart ? 'Auto-restart ready' : 'Auto-restart disabled');
  $('detailPid').textContent = bot.pid || '—';
  $('detailGuilds').textContent = bot.heartbeat?.guildCount ?? bot.ready?.guildCount ?? '—';
  $('detailMemory').textContent = bot.heartbeat?.memoryMb ? `${bot.heartbeat.memoryMb} MB` : '—';
  $('detailHeartbeat').textContent = relativeTime(bot.lastHeartbeatAt);

  const hero = {
    stopped: ['Bot is stopped', 'Start it when configuration is ready.'],
    starting: ['Starting the bot', 'Launching the isolated runtime and connecting to Discord.'],
    connecting: ['Connecting to Discord', 'Waiting for the Discord gateway to become ready.'],
    online: ['Bot is online', `${bot.ready?.username || 'Khaos Nexus'} is supervised and healthy.`],
    stopping: ['Stopping the bot', 'Closing the Discord connection cleanly.'],
    restarting: ['Recovering the bot', 'Automatic restart backoff is active.'],
    crashed: ['Bot runtime crashed', 'The Health Monitor captured the failure and is deciding whether to restart.'],
    error: ['Bot requires attention', bot.lastError?.message || 'Open the Health Monitor for details.']
  }[status] || ['Bot status unknown', 'Check the Health Monitor.'];
  $('heroStatus').textContent = hero[0];
  $('heroDetail').textContent = hero[1];

  $('startButton').disabled = ['starting', 'connecting', 'online', 'restarting'].includes(status);
  $('restartButton').disabled = ['stopped', 'stopping'].includes(status);
  $('stopButton').disabled = ['stopped', 'stopping'].includes(status);

  $('versionLabel').textContent = state.app ? `Version ${state.app.version}` : 'Version';
  $('secureLabel').textContent = state.app?.secureStorageAvailable ? 'Protected credential storage ready' : 'Protected storage unavailable';

  if (configChanged) {
    $('guildId').value = config.discord?.guildId || '';
    $('ownerUserId').value = config.discord?.ownerUserId || '';
    $('tokenState').textContent = config.hasDiscordToken
      ? 'A Discord token is stored in protected operating-system storage.'
      : 'No Discord token is stored yet.';

    for (const key of ['autoStartBot', 'autoRestart', 'startWithWindows', 'minimizeToTray', 'checkUpdates']) {
      $(key).checked = Boolean(config.general?.[key]);
    }
    renderServers();
  }
  renderMonitor();
  renderActivity();
  renderUpdate(state.update || {});
}

function renderServers() {
  const container = $('serverList');
  const servers = state.config?.servers || [];
  if (!servers.length) {
    container.innerHTML = '<article class="panel"><h3>No game servers configured</h3><p>Add your first Ark, Palworld, or generic RCON connection. Passwords remain protected on this PC.</p></article>';
    return;
  }
  container.innerHTML = servers.map((server) => `
    <article class="server-card">
      <header><div><span class="eyebrow">${escapeHtml(server.game)}</span><h3>${escapeHtml(server.name)}</h3></div><span class="tag">${server.enabled ? 'Enabled' : 'Disabled'}</span></header>
      <p>${escapeHtml(server.host)}:${server.port}</p>
      <div class="server-meta"><span class="tag">${server.hasPassword ? 'Password stored' : 'Password missing'}</span></div>
      <div class="server-actions"><button class="button" data-server-edit="${server.id}">Edit</button><button class="button" data-server-test="${server.id}">Test</button><button class="button danger" data-server-remove="${server.id}">Remove</button></div>
    </article>
  `).join('');
}

function renderMonitor() {
  const bot = state.bot || {};
  const error = bot.lastError;
  $('monitorState').textContent = bot.autoRestartBlocked ? 'Safety lock' : titleCase(bot.status || 'idle');
  $('monitorStateDetail').textContent = bot.autoRestartBlocked ? 'Too many crashes in the configured window' : 'Supervisor is active';
  $('monitorRestarts').textContent = bot.restartHistory?.length || 0;
  $('monitorErrorId').textContent = error?.id || '—';
  $('monitorHeartbeat').textContent = relativeTime(bot.lastHeartbeatAt);
  $('lastErrorTitle').textContent = error?.message || 'No error captured';
  $('lastErrorStack').textContent = error?.stack || 'The monitor will show a redacted stack trace here if the bot or manager reports a problem.';
  $('errorSeverity').textContent = error ? 'Attention' : 'Healthy';
  $('errorSeverity').classList.toggle('bad', Boolean(error));
}

function renderActivity() {
  const items = state.logs.slice(-6).reverse();
  $('activityList').innerHTML = items.length ? items.map((entry) => `
    <div class="activity ${entry.level}"><span class="activity-dot"></span><div>${escapeHtml(entry.message)}</div><small>${relativeTime(entry.time)}</small></div>
  `).join('') : '<p>No activity recorded yet.</p>';
}

function renderLogs() {
  const filter = $('logFilter').value;
  const logs = filter === 'all' ? state.logs : state.logs.filter((entry) => entry.level === filter);
  const consoleElement = $('logConsole');
  consoleElement.innerHTML = logs.map((entry) => `
    <div class="log-line ${entry.level}"><span class="time">${escapeHtml(new Date(entry.time).toLocaleString())}</span><span class="level">${escapeHtml(entry.level.toUpperCase())}</span><span class="source">${escapeHtml(entry.source)}</span><span>${escapeHtml(entry.message)}</span></div>
  `).join('');
  consoleElement.scrollTop = consoleElement.scrollHeight;
}

function renderUpdate(update) {
  const detail = update.progress !== null && update.progress !== undefined ? ` (${update.progress}%)` : '';
  $('updateStatus').textContent = `Update status: ${titleCase(update.status || 'idle')}${update.version ? ` — ${update.version}` : ''}${detail}${update.error ? ` — ${update.error}` : ''}`;
  $('downloadUpdateButton').classList.toggle('hidden', update.status !== 'available');
  $('installUpdateButton').classList.toggle('hidden', update.status !== 'downloaded');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

async function invoke(channel, payload, successMessage) {
  try {
    const result = await window.khaos.invoke(channel, payload);
    if (successMessage) toast(successMessage);
    return result;
  } catch (error) {
    toast(error.message || String(error));
    throw error;
  }
}

function openServerEditor(server = {}) {
  $('serverEditor').classList.remove('hidden');
  $('serverEditorTitle').textContent = server.id ? `Edit ${server.name}` : 'Add game server';
  $('serverId').value = server.id || '';
  $('serverName').value = server.name || '';
  $('serverGame').value = server.game || 'palworld';
  $('serverEnabled').value = String(server.enabled !== false);
  $('serverHost').value = server.host || '';
  $('serverPort').value = server.port || '';
  $('serverPassword').value = '';
  for (const key of ['statusCommand', 'playersCommand', 'saveCommand', 'broadcastCommand', 'kickCommand', 'banCommand']) {
    $(key).value = server[key] || '';
  }
  $('serverEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveDiscord(startAfter) {
  await invoke('config:save-discord', { guildId: $('guildId').value, ownerUserId: $('ownerUserId').value });
  if ($('discordToken').value.trim()) {
    await invoke('secret:set-discord-token', $('discordToken').value.trim());
    $('discordToken').value = '';
  }
  const latest = await window.khaos.invoke('app:get-state');
  applyState(latest);
  toast('Discord bot setup saved.');
  if (startAfter) await invoke('bot:start');
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('[data-view-link]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewLink)));
  $('startButton').addEventListener('click', () => invoke('bot:start'));
  $('stopButton').addEventListener('click', () => invoke('bot:stop'));
  $('restartButton').addEventListener('click', () => invoke('bot:restart'));
  $('saveDiscordButton').addEventListener('click', () => saveDiscord(false));
  $('saveAndStartButton').addEventListener('click', () => saveDiscord(true));
  $('newServerButton').addEventListener('click', () => openServerEditor());
  $('cancelServerButton').addEventListener('click', () => $('serverEditor').classList.add('hidden'));

  $('serverList').addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-server-edit]');
    const test = event.target.closest('[data-server-test]');
    const remove = event.target.closest('[data-server-remove]');
    if (edit) openServerEditor(state.config.servers.find((server) => server.id === edit.dataset.serverEdit));
    if (test) {
      const result = await invoke('server:test', test.dataset.serverTest, 'RCON connection succeeded.');
      if (result?.result) toast(String(result.result).slice(0, 220));
    }
    if (remove && confirm('Remove this server configuration and its stored password?')) {
      await invoke('server:remove', remove.dataset.serverRemove, 'Server removed.');
    }
  });

  $('saveServerButton').addEventListener('click', async () => {
    const server = {
      id: $('serverId').value || undefined,
      name: $('serverName').value,
      game: $('serverGame').value,
      enabled: $('serverEnabled').value === 'true',
      host: $('serverHost').value,
      port: Number($('serverPort').value),
      statusCommand: $('statusCommand').value,
      playersCommand: $('playersCommand').value,
      saveCommand: $('saveCommand').value,
      broadcastCommand: $('broadcastCommand').value,
      kickCommand: $('kickCommand').value,
      banCommand: $('banCommand').value
    };
    await invoke('server:save', { server, password: $('serverPassword').value }, 'Server saved.');
    $('serverEditor').classList.add('hidden');
  });

  $('reportIssueButton').addEventListener('click', () => invoke('diagnostics:report', null, 'Redacted report copied; review the GitHub issue before submitting.'));
  $('exportDiagnosticsButton').addEventListener('click', () => invoke('diagnostics:export'));
  $('clearLogsButton').addEventListener('click', async () => { await invoke('logs:clear'); state.logs = []; renderLogs(); renderActivity(); });
  $('logFilter').addEventListener('change', renderLogs);
  $('saveSettingsButton').addEventListener('click', async () => {
    const general = {};
    for (const key of ['autoStartBot', 'autoRestart', 'startWithWindows', 'minimizeToTray', 'checkUpdates']) general[key] = $(key).checked;
    await invoke('config:save-general', general, 'Settings saved.');
  });
  $('checkUpdatesButton').addEventListener('click', () => invoke('update:check', null, 'Update check started.'));
  $('downloadUpdateButton').addEventListener('click', () => invoke('update:download', null, 'Update download started.'));
  $('installUpdateButton').addEventListener('click', () => invoke('update:install'));
  $('exportBackupButton').addEventListener('click', () => invoke('backup:export', null, 'Backup exported.'));
  $('importBackupButton').addEventListener('click', async () => {
    const result = await invoke('backup:import');
    if (!result?.canceled) toast('Backup restored. Restart the bot to apply it.');
  });
  $('openDataButton').addEventListener('click', () => invoke('app:open-data-folder'));
}

async function initialize() {
  bindEvents();
  const [initial, logs] = await Promise.all([
    window.khaos.invoke('app:get-state'),
    window.khaos.invoke('logs:get', 500)
  ]);
  state.logs = logs;
  applyState(initial);
  renderLogs();

  window.khaos.onState((next) => applyState(next));
  window.khaos.onLog((entry) => {
    if (entry.cleared) state.logs = [];
    else {
      state.logs.push(entry);
      if (state.logs.length > 1000) state.logs.splice(0, state.logs.length - 1000);
    }
    renderActivity();
    renderLogs();
  });
  window.khaos.onUpdate((update) => { state.update = update; renderUpdate(update); });

  setInterval(() => {
    if (state.bot?.heartbeat?.uptimeSeconds !== undefined && state.bot.status === 'online') {
      state.bot.heartbeat.uptimeSeconds += 1;
      $('metricUptime').textContent = formatDuration(state.bot.heartbeat.uptimeSeconds);
    }
    $('detailHeartbeat').textContent = relativeTime(state.bot?.lastHeartbeatAt);
    $('monitorHeartbeat').textContent = relativeTime(state.bot?.lastHeartbeatAt);
  }, 1000);
}

initialize().catch((error) => toast(`Manager UI failed to initialize: ${error.message}`));
