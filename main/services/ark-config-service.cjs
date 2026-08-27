'use strict';

const crypto = require('node:crypto');
const { PterodactylClient } = require('./pterodactyl-client.cjs');
const { ServerConnection } = require('../../bot/server-client.cjs');
const {
  resolveAllowedPath,
  validateContent,
  setIniValue,
  setJsonValue
} = require('../../shared/ark-server-control.cjs');

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function stamp(now = Date.now()) {
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

class ArkConfigService {
  constructor({ configStore, logger, clientFactory, rconFactory, now = () => Date.now() } = {}) {
    this.configStore = configStore;
    this.logger = logger;
    this.clientFactory = clientFactory || ((provider, token) => new PterodactylClient(provider, token));
    this.rconFactory = rconFactory || ((server) => new ServerConnection(server));
    this.now = now;
  }

  runtimeServer(serverId) {
    const bootstrap = this.configStore?.getRuntimeBootstrap?.();
    const servers = bootstrap?.config?.servers || [];
    const server = servers.find((item) => item.id === serverId);
    if (!server) throw new Error('The selected game server was not found.');
    if (String(server.game || '').toLowerCase() !== 'ark') throw new Error('ARK config control is only available for ARK servers.');
    return server;
  }

  target(serverId, fileKey) {
    const server = this.runtimeServer(serverId);
    const resolved = resolveAllowedPath(server, fileKey);
    const providerId = resolved.control.providerId;
    const identifier = resolved.control.panelServerIdentifier;
    if (!providerId || !identifier) throw new Error('This ARK server is missing its hosted-provider ID or panel server identifier.');
    const runtime = this.configStore.getHostedProviderRuntime?.(providerId);
    if (!runtime?.provider || !runtime?.token) throw new Error('The hosted provider or its protected Client API key is not configured.');
    return {
      server,
      ...resolved,
      identifier,
      client: this.clientFactory(runtime.provider, runtime.token)
    };
  }

  async read(serverId, fileKey) {
    const target = this.target(serverId, fileKey);
    const content = await target.client.fileContents(target.identifier, target.remotePath);
    return {
      serverId,
      serverName: target.server.name,
      fileKey,
      label: target.policy.label,
      remotePath: target.remotePath,
      content,
      hash: sha256(content),
      restartRequired: target.policy.restartRequired
    };
  }

  async preview(serverId, fileKey, content) {
    const current = await this.read(serverId, fileKey);
    const next = validateContent(fileKey, content);
    return {
      ...current,
      content: undefined,
      previousHash: current.hash,
      nextHash: sha256(next),
      changed: current.content !== next,
      previousBytes: Buffer.byteLength(current.content, 'utf8'),
      nextBytes: Buffer.byteLength(next, 'utf8')
    };
  }

  async write(serverId, fileKey, content, { dryRun = false, actor = {} } = {}) {
    const target = this.target(serverId, fileKey);
    const next = validateContent(fileKey, content);
    const previous = await target.client.fileContents(target.identifier, target.remotePath);
    const previousHash = sha256(previous);
    const nextHash = sha256(next);
    if (previous === next) return { changed: false, previousHash, nextHash, restartRequired: target.policy.restartRequired };
    if (dryRun) return { changed: true, dryRun: true, previousHash, nextHash, restartRequired: target.policy.restartRequired };

    const backupPath = `${target.remotePath}.sentinel-backup-${stamp(this.now())}`;
    await target.client.writeFile(target.identifier, backupPath, previous);
    await target.client.writeFile(target.identifier, target.remotePath, next);

    const verified = await target.client.fileContents(target.identifier, target.remotePath);
    if (sha256(verified) !== nextHash) {
      await target.client.writeFile(target.identifier, target.remotePath, previous).catch(() => {});
      throw new Error(`${target.policy.label} verification failed after write; Sentinel attempted an automatic rollback.`);
    }

    let reload = null;
    if (fileKey === 'arkShop') {
      try {
        const command = target.control.arkShopReloadCommand || 'ArkShop.Reload';
        reload = await this.rconFactory(target.server).execute(command);
      } catch (error) {
        const wrapped = new Error(`ArkShop config was written and verified, but ArkShop reload failed: ${error.message}`);
        wrapped.code = 'ARKSHOP_RELOAD_FAILED';
        wrapped.backupPath = backupPath;
        throw wrapped;
      }
    }

    this.logger?.info?.('Guarded ARK config write completed.', {
      serverId,
      serverName: target.server.name,
      fileKey,
      backupPath,
      previousHash,
      nextHash,
      actorId: actor.id || '',
      actorName: actor.name || ''
    });

    return {
      changed: true,
      backupPath,
      previousHash,
      nextHash,
      verified: true,
      restartRequired: target.policy.restartRequired,
      reload: reload === null ? null : String(reload).slice(0, 700)
    };
  }

  async rollback(serverId, fileKey, backupPath, { actor = {} } = {}) {
    const target = this.target(serverId, fileKey);
    const prefix = `${target.remotePath}.sentinel-backup-`;
    if (!String(backupPath || '').startsWith(prefix)) throw new Error('Rollback path is not a Sentinel backup for the selected file.');
    const backup = await target.client.fileContents(target.identifier, backupPath);
    validateContent(fileKey, backup);
    const result = await this.write(serverId, fileKey, backup, { actor });
    return { ...result, restoredFrom: backupPath };
  }

  async setIniValue(serverId, fileKey, section, key, value, options = {}) {
    if (!['gameIni', 'gameUserSettings'].includes(fileKey)) throw new Error('INI editing is limited to Game.ini and GameUserSettings.ini.');
    const current = await this.read(serverId, fileKey);
    return this.write(serverId, fileKey, setIniValue(current.content, section, key, value), options);
  }

  async setArkShopValue(serverId, jsonPath, value, options = {}) {
    const current = await this.read(serverId, 'arkShop');
    return this.write(serverId, 'arkShop', setJsonValue(current.content, jsonPath, value), options);
  }
}

module.exports = { ArkConfigService, sha256, stamp };