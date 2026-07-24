'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const DEFAULT_SETTINGS = Object.freeze({
  accessControlEnabled: false,
  viewerUserIds: [],
  automaticBackupsEnabled: true,
  backupIntervalHours: 24,
  backupRetentionCount: 14,
  selfHealingEnabled: true,
  healthCheckMinutes: 10,
  discordNotificationsEnabled: false,
  notificationChannelId: '',
  maintenanceWarning: 'Khaos Nexus maintenance is starting. Please save your progress and stand by.',
  maintenanceRestartBot: true
});

const DEFAULT_STATE = Object.freeze({
  status: 'idle',
  maintenanceActive: false,
  lastBackupAt: null,
  lastBackupPath: null,
  lastBackupValid: null,
  lastHealthCheckAt: null,
  lastRecoveryAt: null,
  lastRecoverySummary: null,
  lastMaintenanceAt: null,
  lastMaintenanceSummary: null,
  lastNotificationAt: null,
  lastError: null,
  serverHealth: {},
  attention: []
});

const ROLE_ORDER = Object.freeze({ locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 4 });

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeIds(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(',');
  return [...new Set(source.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, 30);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function commandFor(server, action, value = '') {
  const game = String(server.game || 'generic').toLowerCase();
  const commands = {
    ark: {
      status: 'ListPlayers',
      save: 'SaveWorld',
      broadcast: `Broadcast ${value}`
    },
    palworld: {
      status: 'Info',
      save: 'Save',
      broadcast: `Broadcast ${value}`
    },
    generic: {
      status: server.statusCommand || 'status',
      save: server.saveCommand || 'save-all',
      broadcast: `${server.broadcastCommand || 'broadcast'} ${value}`
    }
  };
  return (commands[game] || commands.generic)[action];
}

class AutonomyService extends EventEmitter {
  constructor({
    dataDirectory,
    configStore,
    supervisor,
    applicationMonitor,
    logger,
    appVersion,
    rconFactory,
    fetchImpl = global.fetch,
    now = () => Date.now(),
    intervalFactory = setInterval,
    clearIntervalFactory = clearInterval
  }) {
    super();
    this.dataDirectory = dataDirectory;
    this.configStore = configStore;
    this.supervisor = supervisor;
    this.applicationMonitor = applicationMonitor;
    this.logger = logger;
    this.appVersion = appVersion;
    this.rconFactory = rconFactory;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.clearIntervalFactory = clearIntervalFactory;
    this.settingsPath = path.join(dataDirectory, 'autonomy-settings.json');
    this.statePath = path.join(dataDirectory, 'autonomy-state.json');
    this.backupDirectory = path.join(dataDirectory, 'automatic-backups');
    this.disableAccessFlagPath = path.join(dataDirectory, 'disable-access-control.flag');
    this.settings = this.loadJson(this.settingsPath, DEFAULT_SETTINGS);
    this.state = this.loadJson(this.statePath, DEFAULT_STATE);
    this.recoveryRunning = false;
    this.maintenanceRunning = false;
    this.healthRunning = false;

    if (fs.existsSync(this.disableAccessFlagPath)) {
      this.settings.accessControlEnabled = false;
      try { fs.unlinkSync(this.disableAccessFlagPath); } catch {}
      this.saveSettings();
      this.logger?.warn('Access control was disabled by the local recovery flag.');
    }

    this.timer = intervalFactory(() => this.schedulerTick().catch((error) => {
      this.updateState({ status: 'attention', lastError: error.message });
      this.logger?.error('Autonomy scheduler failed.', { message: error.message });
    }), 60 * 1000);
    this.timer?.unref?.();
  }

  loadJson(filePath, defaults) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { ...clone(defaults), ...parsed };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`); } catch {}
      }
      return clone(defaults);
    }
  }

  atomicWrite(filePath, payload) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temporary, filePath);
  }

  saveSettings() {
    this.atomicWrite(this.settingsPath, this.settings);
  }

  saveState() {
    this.atomicWrite(this.statePath, this.state);
  }

  updateState(patch) {
    this.state = { ...this.state, ...patch };
    this.saveState();
    this.emit('state', this.getState());
  }

  getSettings() {
    return clone(this.settings);
  }

  setSettings(payload = {}) {
    const next = {
      ...this.settings,
      accessControlEnabled: Boolean(payload.accessControlEnabled),
      viewerUserIds: normalizeIds(payload.viewerUserIds),
      automaticBackupsEnabled: Boolean(payload.automaticBackupsEnabled),
      backupIntervalHours: clamp(payload.backupIntervalHours, 1, 168, this.settings.backupIntervalHours),
      backupRetentionCount: Math.round(clamp(payload.backupRetentionCount, 3, 90, this.settings.backupRetentionCount)),
      selfHealingEnabled: Boolean(payload.selfHealingEnabled),
      healthCheckMinutes: Math.round(clamp(payload.healthCheckMinutes, 5, 120, this.settings.healthCheckMinutes)),
      discordNotificationsEnabled: Boolean(payload.discordNotificationsEnabled),
      notificationChannelId: String(payload.notificationChannelId || '').trim(),
      maintenanceWarning: String(payload.maintenanceWarning || DEFAULT_SETTINGS.maintenanceWarning).trim().slice(0, 500),
      maintenanceRestartBot: payload.maintenanceRestartBot !== false
    };
    if (next.notificationChannelId && !/^\d{5,25}$/.test(next.notificationChannelId)) {
      throw new Error('Discord notification channel ID must be numeric.');
    }
    this.settings = next;
    this.saveSettings();
    this.emit('state', this.getState());
    return this.getSettings();
  }

  restoreSettings(settings) {
    if (!settings || typeof settings !== 'object') return this.getSettings();
    return this.setSettings({ ...this.settings, ...settings });
  }

  accessState(discordAuthState = null) {
    if (!this.settings.accessControlEnabled) {
      return {
        enabled: false,
        role: 'local-admin',
        signedIn: Boolean(discordAuthState?.user),
        user: discordAuthState?.user || null,
        reason: 'Local access control is not enabled.',
        canView: true,
        canOperate: true,
        canOwn: true
      };
    }

    const config = this.configStore.getConfig().discord || {};
    const user = discordAuthState?.user || null;
    const userId = String(user?.id || '');
    let role = 'locked';
    let reason = 'Sign in with an authorized Discord account.';

    if (userId && userId === String(config.ownerUserId || '')) {
      role = 'owner';
      reason = 'Signed in as the configured owner.';
    } else if (userId && (config.operatorUserIds || []).map(String).includes(userId)) {
      role = 'operator';
      reason = 'Signed in as an approved operator.';
    } else if (userId && this.settings.viewerUserIds.includes(userId)) {
      role = 'viewer';
      reason = 'Signed in with view-only access.';
    } else if (userId) {
      reason = 'This Discord account is not approved for desktop access.';
    }

    return {
      enabled: true,
      role,
      signedIn: Boolean(user),
      user,
      reason,
      canView: ROLE_ORDER[role] >= ROLE_ORDER.viewer,
      canOperate: ROLE_ORDER[role] >= ROLE_ORDER.operator,
      canOwn: ROLE_ORDER[role] >= ROLE_ORDER.owner
    };
  }

  assertAccess(discordAuthState, minimumRole, action) {
    const access = this.accessState(discordAuthState);
    if ((ROLE_ORDER[access.role] || 0) < (ROLE_ORDER[minimumRole] || 0)) {
      const error = new Error(`${action || 'This action'} requires ${minimumRole} access. ${access.reason}`);
      error.code = 'ACCESS_DENIED';
      throw error;
    }
    return access;
  }

  getState(discordAuthState = null) {
    return {
      ...clone(this.state),
      settings: this.getSettings(),
      access: this.accessState(discordAuthState),
      backupDirectory: this.backupDirectory,
      recoveryFlagPath: this.disableAccessFlagPath
    };
  }

  decorateBackup(payload) {
    return {
      ...payload,
      autonomy: {
        formatVersion: 1,
        settings: this.getSettings()
      }
    };
  }

  verifyBackup(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const valid = Boolean(parsed && (
      (parsed.format === 'khaos-nexus-backup' && parsed.formatVersion === 2) ||
      (parsed.format === 'khaos-nexus-bot-manager-backup' && parsed.formatVersion === 1)
    ));
    if (!valid) throw new Error('Automatic backup verification failed.');
    return true;
  }

  cleanupBackups() {
    fs.mkdirSync(this.backupDirectory, { recursive: true });
    const files = fs.readdirSync(this.backupDirectory)
      .filter((name) => name.endsWith('.knbackup'))
      .map((name) => ({ name, path: path.join(this.backupDirectory, name), time: fs.statSync(path.join(this.backupDirectory, name)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
    for (const file of files.slice(this.settings.backupRetentionCount)) {
      try { fs.unlinkSync(file.path); } catch {}
    }
  }

  createAutomaticBackup(reason = 'automatic') {
    const createdAt = new Date(this.now()).toISOString();
    const safeTimestamp = createdAt.replace(/[:.]/g, '-');
    const filePath = path.join(this.backupDirectory, `khaos-nexus-${reason}-${safeTimestamp}.knbackup`);
    const payload = this.decorateBackup(this.configStore.createBackupPayload(this.appVersion));
    payload.reason = reason;
    this.atomicWrite(filePath, payload);
    this.verifyBackup(filePath);
    this.cleanupBackups();
    this.updateState({
      status: 'ready',
      lastBackupAt: createdAt,
      lastBackupPath: filePath,
      lastBackupValid: true,
      lastError: null
    });
    this.logger?.info('Verified Khaos Nexus backup created.', { reason, filePath });
    return { filePath, createdAt, valid: true };
  }

  backupDue() {
    if (!this.settings.automaticBackupsEnabled) return false;
    if (!this.state.lastBackupAt) return true;
    const intervalMs = this.settings.backupIntervalHours * 60 * 60 * 1000;
    return this.now() - new Date(this.state.lastBackupAt).getTime() >= intervalMs;
  }

  async notify(title, message, level = 'info') {
    if (!this.settings.discordNotificationsEnabled || !this.settings.notificationChannelId) {
      return { skipped: true, reason: 'disabled' };
    }
    const runtime = this.configStore.getRuntimeBootstrap();
    if (!runtime.discordToken) return { skipped: true, reason: 'missing-token' };
    if (typeof this.fetchImpl !== 'function') return { skipped: true, reason: 'network-unavailable' };

    const content = `**${String(title).slice(0, 150)}**\n${String(message).slice(0, 1700)}\n\nLevel: ${level}`;
    const response = await this.fetchImpl(`https://discord.com/api/v10/channels/${this.settings.notificationChannelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${runtime.discordToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Khaos-Nexus-Autonomy'
      },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
    });
    if (!response.ok) throw new Error(`Discord notification failed with status ${response.status}.`);
    const sentAt = new Date(this.now()).toISOString();
    this.updateState({ lastNotificationAt: sentAt });
    return { sent: true, sentAt };
  }

  async testServer(server) {
    if (!server.password) throw new Error('RCON password is missing.');
    const rcon = this.rconFactory(server);
    const result = await rcon.execute(commandFor(server, 'status'));
    return String(result || 'Connected successfully.').slice(0, 500);
  }

  async checkServers() {
    if (this.healthRunning) return { skipped: true, reason: 'already-running' };
    this.healthRunning = true;
    try {
      const runtime = this.configStore.getRuntimeBootstrap();
      const health = { ...this.state.serverHealth };
      const checkedAt = new Date(this.now()).toISOString();
      for (const server of runtime.config.servers.filter((item) => item.enabled !== false)) {
        try {
          const detail = await this.testServer(server);
          health[server.id] = { name: server.name, game: server.game, status: 'online', checkedAt, failures: 0, detail };
        } catch (error) {
          const previous = health[server.id] || {};
          health[server.id] = {
            name: server.name,
            game: server.game,
            status: 'offline',
            checkedAt,
            failures: Number(previous.failures || 0) + 1,
            detail: error.message
          };
        }
      }
      const offline = Object.values(health).filter((entry) => entry.status === 'offline');
      const attention = offline.map((entry) => `A configured game server is unreachable: ${entry.detail}`);
      this.updateState({
        status: attention.length ? 'attention' : 'ready',
        lastHealthCheckAt: checkedAt,
        serverHealth: health,
        attention,
        lastError: attention.length ? attention[0] : null
      });
      if (offline.some((entry) => entry.failures >= 3)) {
        await this.notify('Khaos Nexus server attention required', `${offline.length} configured server connection(s) are failing repeatedly.`, 'warning').catch(() => {});
      }
      return { checkedAt, health: clone(health), offline: offline.length };
    } finally {
      this.healthRunning = false;
    }
  }

  async runRecovery() {
    if (this.recoveryRunning) throw new Error('A guided recovery is already running.');
    this.recoveryRunning = true;
    this.updateState({ status: 'recovering', lastError: null });
    const actions = [];
    const warnings = [];
    try {
      this.createAutomaticBackup('pre-recovery');
      actions.push('Created and verified a pre-recovery backup.');

      const runtime = this.configStore.getRuntimeBootstrap();
      const bot = this.supervisor.getState();
      if (!runtime.discordToken) {
        warnings.push('Discord bot token is missing.');
      } else if (bot.autoRestartBlocked) {
        warnings.push('Bot restart safety lock is active; manual owner review is required.');
      } else if (['stopped', 'error', 'crashed'].includes(bot.status)) {
        await this.supervisor.restart();
        actions.push('Requested a supervised bot restart.');
      } else if (['online', 'starting', 'connecting', 'restarting'].includes(bot.status)) {
        actions.push(`Bot runtime is already ${bot.status}.`);
      }

      const queue = await this.applicationMonitor?.processQueue?.();
      if (queue && !queue.skipped) actions.push(`Processed the GitHub report queue (${queue.delivered || 0} delivered).`);

      const serverResult = await this.checkServers();
      actions.push(`Checked game-server connectivity (${serverResult.offline || 0} offline).`);
      const completedAt = new Date(this.now()).toISOString();
      const summary = { ok: warnings.length === 0 && (serverResult.offline || 0) === 0, actions, warnings };
      this.updateState({
        status: summary.ok ? 'ready' : 'attention',
        lastRecoveryAt: completedAt,
        lastRecoverySummary: summary,
        lastError: warnings[0] || ((serverResult.offline || 0) ? 'One or more game servers are offline.' : null)
      });
      await this.notify('Khaos Nexus guided recovery completed', `${actions.join('\n')}\n${warnings.join('\n')}`.trim(), summary.ok ? 'info' : 'warning').catch(() => {});
      return summary;
    } catch (error) {
      this.updateState({ status: 'attention', lastError: error.message });
      await this.notify('Khaos Nexus recovery failed', error.message, 'error').catch(() => {});
      throw error;
    } finally {
      this.recoveryRunning = false;
    }
  }

  async runMaintenance() {
    if (this.maintenanceRunning) throw new Error('Maintenance Mode is already running.');
    this.maintenanceRunning = true;
    const startedAt = new Date(this.now()).toISOString();
    this.updateState({ status: 'maintenance', maintenanceActive: true, lastError: null });
    const results = [];
    try {
      this.createAutomaticBackup('pre-maintenance');
      results.push({ step: 'backup', ok: true, detail: 'Verified backup created.' });
      await this.notify('Khaos Nexus maintenance starting', this.settings.maintenanceWarning, 'warning').catch(() => {});

      const runtime = this.configStore.getRuntimeBootstrap();
      for (const server of runtime.config.servers.filter((item) => item.enabled !== false)) {
        if (!server.password) {
          results.push({ step: 'server', server: server.name, ok: false, detail: 'RCON password missing.' });
          continue;
        }
        const rcon = this.rconFactory(server);
        try {
          await rcon.execute(commandFor(server, 'broadcast', this.settings.maintenanceWarning));
          await rcon.execute(commandFor(server, 'save'));
          results.push({ step: 'server', server: server.name, ok: true, detail: 'Players warned and world save requested.' });
        } catch (error) {
          results.push({ step: 'server', server: server.name, ok: false, detail: error.message });
        }
      }

      if (this.settings.maintenanceRestartBot) {
        await this.supervisor.restart();
        results.push({ step: 'bot', ok: true, detail: 'Supervised bot restart requested.' });
      }

      const failed = results.filter((item) => !item.ok);
      const summary = { ok: failed.length === 0, startedAt, completedAt: new Date(this.now()).toISOString(), results };
      this.updateState({
        status: summary.ok ? 'ready' : 'attention',
        maintenanceActive: false,
        lastMaintenanceAt: summary.completedAt,
        lastMaintenanceSummary: summary,
        lastError: failed[0]?.detail || null
      });
      await this.notify('Khaos Nexus maintenance completed', summary.ok ? 'All maintenance steps completed.' : `${failed.length} maintenance step(s) need attention.`, summary.ok ? 'info' : 'warning').catch(() => {});
      return summary;
    } catch (error) {
      this.updateState({ status: 'attention', maintenanceActive: false, lastError: error.message });
      await this.notify('Khaos Nexus maintenance failed', error.message, 'error').catch(() => {});
      throw error;
    } finally {
      this.maintenanceRunning = false;
    }
  }

  async schedulerTick() {
    if (this.backupDue()) this.createAutomaticBackup('scheduled');
    const lastCheck = this.state.lastHealthCheckAt ? new Date(this.state.lastHealthCheckAt).getTime() : 0;
    const healthDue = this.now() - lastCheck >= this.settings.healthCheckMinutes * 60 * 1000;
    if (healthDue) await this.checkServers();

    if (this.settings.selfHealingEnabled) {
      const config = this.configStore.getConfig();
      const bot = this.supervisor.getState();
      const hasToken = this.configStore.getPublicConfig().hasDiscordToken;
      const lastRecovery = this.state.lastRecoveryAt ? new Date(this.state.lastRecoveryAt).getTime() : 0;
      const cooldownPassed = this.now() - lastRecovery >= 15 * 60 * 1000;
      if (config.general.autoStartBot && hasToken && bot.status === 'stopped' && cooldownPassed) {
        await this.supervisor.start();
        this.updateState({ lastRecoveryAt: new Date(this.now()).toISOString(), lastRecoverySummary: { ok: true, actions: ['Automatically started the stopped bot runtime.'], warnings: [] } });
        await this.notify('Khaos Nexus self-healed', 'The Discord bot runtime was stopped and has been started automatically.', 'info').catch(() => {});
      }
    }
  }

  destroy() {
    if (this.timer) this.clearIntervalFactory(this.timer);
  }
}

module.exports = { AutonomyService, DEFAULT_SETTINGS, DEFAULT_STATE, ROLE_ORDER, commandFor };
