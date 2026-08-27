'use strict';

const { normalizeArkControl, normalizeArkShopMysql } = require('../shared/ark-server-control.cjs');
const { ArkConfigService } = require('./services/ark-config-service.cjs');
const { ArkShopMysqlService } = require('./services/arkshop-mysql-service.cjs');

let installed = false;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function envKey(server) {
  return `ARK_${String(server?.name || server?.id || 'SERVER').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

function withEnvironment(server) {
  if (String(server?.game || '').toLowerCase() !== 'ark') return server;
  const prefix = envKey(server);
  const configured = normalizeArkControl(server.arkControl || {});
  return {
    ...server,
    arkControl: normalizeArkControl({
      ...configured,
      providerId: configured.providerId || process.env[`${prefix}_PANEL_PROVIDER_ID`] || '',
      panelServerIdentifier: configured.panelServerIdentifier || process.env[`${prefix}_PANEL_SERVER_ID`] || '',
      paths: {
        gameUserSettings: configured.paths.gameUserSettings || process.env[`${prefix}_GAMEUSERSETTINGS_PATH`] || '',
        gameIni: configured.paths.gameIni || process.env[`${prefix}_GAMEINI_PATH`] || '',
        arkShop: configured.paths.arkShop || process.env[`${prefix}_ARKSHOP_CONFIG_PATH`] || ''
      },
      arkShopReloadCommand: configured.arkShopReloadCommand || process.env[`${prefix}_ARKSHOP_RELOAD_COMMAND`] || 'ArkShop.Reload'
    })
  };
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosArkControlPatched) return;

  class ArkControlConfigStore extends Original {
    constructor(...args) {
      super(...args);
      let changed = false;
      for (const server of this.config.servers) {
        if (String(server.game || '').toLowerCase() !== 'ark') continue;
        const nextControl = normalizeArkControl(server.arkControl || {});
        const nextMysql = normalizeArkShopMysql(server.arkShopMysql || {});
        if (JSON.stringify(server.arkControl || null) !== JSON.stringify(nextControl)) { server.arkControl = nextControl; changed = true; }
        if (JSON.stringify(server.arkShopMysql || null) !== JSON.stringify(nextMysql)) { server.arkShopMysql = nextMysql; changed = true; }
      }
      if (changed) this.saveConfig();
    }

    upsertServer(server, password) {
      const id = super.upsertServer(server, password);
      const stored = this.config.servers.find((item) => item.id === id);
      if (stored && String(stored.game || '').toLowerCase() === 'ark') {
        stored.arkControl = normalizeArkControl(server.arkControl || stored.arkControl || {});
        stored.arkShopMysql = normalizeArkShopMysql(server.arkShopMysql || stored.arkShopMysql || {});
        this.saveConfig();
      }
      return id;
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      config.servers = config.servers.map((server) => String(server.game || '').toLowerCase() === 'ark' ? {
        ...server,
        hasArkShopMysqlPassword: Boolean(this.secrets.arkShopMysqlPasswords?.[server.id])
      } : server);
      return config;
    }

    getSecretValues() {
      return [...super.getSecretValues(), ...Object.values(this.secrets.arkShopMysqlPasswords || {})].filter(Boolean);
    }

    setArkShopMysqlPassword(serverId, password) {
      if (!this.config.servers.some((server) => server.id === serverId && String(server.game || '').toLowerCase() === 'ark')) {
        throw new Error('The selected ARK server was not found.');
      }
      const value = String(password || '');
      this.secrets.arkShopMysqlPasswords ||= {};
      if (value) this.secrets.arkShopMysqlPasswords[serverId] = value;
      else delete this.secrets.arkShopMysqlPasswords[serverId];
      this.saveSecrets();
      return { serverId, hasPassword: Boolean(value) };
    }

    getArkShopMysqlRuntime(serverId) {
      const server = this.config.servers.find((item) => item.id === serverId);
      if (!server || String(server.game || '').toLowerCase() !== 'ark') throw new Error('The selected ARK server was not found.');
      const base = normalizeArkShopMysql(server.arkShopMysql || {});
      return normalizeArkShopMysql({
        ...base,
        host: base.host || process.env.ARKSHOP_MYSQL_HOST || '',
        port: base.port || Number(process.env.ARKSHOP_MYSQL_PORT) || 3306,
        database: base.database || process.env.ARKSHOP_MYSQL_DATABASE || '',
        user: base.user || process.env.ARKSHOP_MYSQL_USER || '',
        ssl: base.ssl || /^(1|true|yes)$/i.test(process.env.ARKSHOP_MYSQL_SSL || '')
      }) && {
        ...normalizeArkShopMysql({
          ...base,
          host: base.host || process.env.ARKSHOP_MYSQL_HOST || '',
          port: base.port || Number(process.env.ARKSHOP_MYSQL_PORT) || 3306,
          database: base.database || process.env.ARKSHOP_MYSQL_DATABASE || '',
          user: base.user || process.env.ARKSHOP_MYSQL_USER || '',
          ssl: base.ssl || /^(1|true|yes)$/i.test(process.env.ARKSHOP_MYSQL_SSL || '')
        }),
        password: this.secrets.arkShopMysqlPasswords?.[serverId] || process.env.ARKSHOP_MYSQL_PASSWORD || ''
      };
    }

    getRuntimeBootstrap() {
      const runtime = super.getRuntimeBootstrap();
      runtime.config.servers = runtime.config.servers.map(withEnvironment);
      return runtime;
    }
  }

  Object.defineProperty(ArkControlConfigStore, '__khaosArkControlPatched', { value: true });
  target.ConfigStore = ArkControlConfigStore;
}

function patchSupervisor() {
  const target = require('./services/bot-supervisor.cjs');
  const prototype = target.BotSupervisor?.prototype;
  if (!prototype || prototype.__khaosArkControlPatched) return;
  const original = prototype.handleMessage;

  prototype.handleMessage = function arkAwareHandleMessage(message) {
    if (message?.type !== 'ark-control-request') return original.call(this, message);
    const payload = message.payload || {};
    const requestId = String(payload.requestId || '');
    const ownerUserId = String(this.configStore.getConfig()?.discord?.ownerUserId || '');
    const respond = (ok, value) => this.child?.postMessage({
      type: 'ark-control-response',
      payload: { requestId, ok, ...(ok ? { result: value } : { error: String(value?.message || value).slice(0, 1000) }) }
    });

    if (!requestId) return;
    if (!ownerUserId || String(payload.userId || '') !== ownerUserId) {
      respond(false, new Error('ARK configuration and ArkShop database controls are Owner-only.'));
      return;
    }

    const service = new ArkConfigService({ configStore: this.configStore, logger: this.logger });
    const mysql = new ArkShopMysqlService({ configStore: this.configStore });
    Promise.resolve().then(async () => {
      const args = payload.args || {};
      switch (payload.operation) {
        case 'read': return service.read(args.serverId, args.fileKey);
        case 'preview': return service.preview(args.serverId, args.fileKey, args.content);
        case 'set-ini': return service.setIniValue(args.serverId, args.fileKey, args.section, args.key, args.value, { dryRun: Boolean(args.dryRun), actor: { id: payload.userId } });
        case 'set-arkshop': return service.setArkShopValue(args.serverId, args.jsonPath, args.value, { dryRun: Boolean(args.dryRun), actor: { id: payload.userId } });
        case 'rollback': return service.rollback(args.serverId, args.fileKey, args.backupPath, { actor: { id: payload.userId } });
        case 'mysql-probe': return mysql.probe(args.serverId);
        default: throw new Error('Unsupported ARK control operation.');
      }
    }).then((result) => respond(true, result)).catch((error) => {
      this.logger?.error?.('ARK control request failed.', { operation: payload.operation, message: error.message });
      respond(false, error);
    });
  };

  Object.defineProperty(prototype, '__khaosArkControlPatched', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchSupervisor();
}

module.exports = { install, patchConfigStore, patchSupervisor, withEnvironment, envKey };