'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { readConfig, setIniValue, discoverPaths } = require('./ark-config-manager.cjs');
const { pollCluster } = require('./ark-cluster-monitor.cjs');
const { performRestart, waitForRecovery } = require('./ark-restart-scheduler-extension.cjs');

const ALLOWED_ACTIONS = new Set([
  'server.status',
  'server.players',
  'server.save',
  'server.broadcast',
  'server.restart',
  'cluster.health',
  'config.plan',
  'config.apply'
]);

function clean(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function correlationId(value = '') {
  const supplied = clean(value, 80);
  if (supplied && /^[A-Za-z0-9._:-]{8,80}$/.test(supplied)) return supplied;
  return `ark-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
}
function sha256(value) { return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex'); }
function configPlanHash({ serverId, fileKey, section, key, value, currentHash }) {
  return sha256(JSON.stringify({ version: 1, serverId: clean(serverId, 64).toLowerCase(), fileKey: clean(fileKey, 20).toLowerCase(), section: clean(section, 160), key: clean(key, 160), value: String(value ?? ''), currentHash: clean(currentHash, 64).toLowerCase() }));
}
function parsePlayers(raw = '') {
  const text = String(raw || '').trim();
  if (!text || /no players connected/i.test(text)) return [];
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const stripped = line.replace(/^\d+\.\s*/, '').trim();
    const match = stripped.match(/^(.*?)(?:,\s*([0-9a-f]{20,}|[A-Za-z0-9_-]{24,}))?$/i);
    return { name: clean(match?.[1] || stripped, 80), eosId: clean(match?.[2] || '', 100) };
  }).filter((player) => player.name);
}
function defaultAuditPath() {
  const root = process.env.NEXUS_DATA_DIR ? path.resolve(process.env.NEXUS_DATA_DIR) : path.resolve(__dirname, '../..', 'data');
  return path.join(root, 'ark-backend-audit.jsonl');
}
function validateIniInput(input = {}) {
  const fileKey = clean(input.fileKey, 20).toLowerCase();
  if (!['gus', 'game'].includes(fileKey)) throw new Error('Config operations currently allow only gus or game INI files.');
  const section = clean(input.section, 160);
  const key = clean(input.key, 160);
  if (!section || !key) throw new Error('Config operation requires section and key.');
  if (/\r|\n|\[|\]/.test(key)) throw new Error('INI key contains invalid characters.');
  return { fileKey, section, key, value: String(input.value ?? '').slice(0, 1000) };
}

class ArkBackendControl {
  constructor(options = {}) {
    this.registry = options.registry || new ArkClusterRegistry();
    this.auditPath = options.auditPath || defaultAuditPath();
    this.logger = options.logger || console;
    this.completed = new Map();
    this.maxCompleted = Math.max(50, Number(options.maxCompleted) || 500);
    this.readConfig = options.readConfig || readConfig;
    this.setIniValue = options.setIniValue || setIniValue;
    this.discoverPaths = options.discoverPaths || discoverPaths;
    this.pollCluster = options.pollCluster || pollCluster;
    this.performRestart = options.performRestart || performRestart;
    this.waitForRecovery = options.waitForRecovery || waitForRecovery;
  }

  listServers() {
    return this.registry.list({ includeDisabled: true }).map((server) => ({
      id: server.id,
      name: server.name,
      mapName: server.mapName,
      envPrefix: server.envPrefix,
      enabled: server.enabled !== false,
      maintenance: server.maintenance === true,
      restartRequired: server.restartRequired === true,
      runtime: server.runtime
    }));
  }

  resolveServer(value) {
    const requested = clean(value, 100).toLowerCase();
    if (!requested) throw new Error('ARK server is required.');
    const servers = this.registry.list({ includeDisabled: true });
    let record = servers.find((item) => [item.id, item.name, item.mapName, item.envPrefix].some((candidate) => String(candidate || '').toLowerCase() === requested));
    if (!record && requested === 'map1') record = servers.find((item) => item.envPrefix === 'ARK_GEN1') || null;
    if (!record && requested === 'map2') record = servers.find((item) => item.envPrefix === 'ARK_MAP2') || null;
    if (!record) throw new Error(`Unknown ARK server: ${clean(value, 100)}`);
    if (record.enabled === false) throw new Error(`ARK server ${record.name} is disabled.`);
    return record;
  }

  rcon(record) {
    const config = arkServerFromEnv(record.envPrefix);
    if (!config.host || !config.port || !config.password) throw new Error(`RCON is not fully configured for ${record.name}.`);
    return new ArkRconClient(config);
  }

  remember(id, result) {
    this.completed.set(id, result);
    while (this.completed.size > this.maxCompleted) this.completed.delete(this.completed.keys().next().value);
  }
  audit(entry) {
    try {
      fs.mkdirSync(path.dirname(this.auditPath), { recursive: true });
      fs.appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) { this.logger.error?.('[ARK Backend Audit]', error); }
  }

  async clusterHealth() {
    const polled = await this.pollCluster(this.registry);
    const servers = [];
    for (const record of polled.servers) {
      const enabled = record.enabled !== false;
      let configAccess = enabled ? { ok: false, files: {}, error: '' } : { ok: false, files: {}, error: '', skipped: 'server-disabled' };
      if (enabled && record.connections?.sftp !== false) {
        try {
          const paths = await this.discoverPaths(record.envPrefix);
          const files = Object.fromEntries(Object.entries(paths).map(([key, result]) => [key, { found: result?.found === true, discovered: result?.discovered === true }]));
          configAccess = { ok: Object.values(files).some((item) => item.found), files, error: '' };
        } catch (error) { configAccess = { ok: false, files: {}, error: clean(error?.message || error, 240) }; }
      }
      servers.push({
        id: record.id,
        name: record.name,
        mapName: record.mapName,
        envPrefix: record.envPrefix,
        enabled,
        state: enabled ? (record.runtime?.state || 'offline') : 'disabled',
        playerCount: enabled ? (Number(record.runtime?.playerCount) || 0) : 0,
        latencyMs: enabled ? (record.runtime?.latencyMs ?? null) : null,
        lastCheckedAt: record.runtime?.lastCheckedAt || '',
        lastError: record.runtime?.lastError || '',
        configAccess,
        restartRequired: record.restartRequired === true,
        restartReason: record.restartReason || ''
      });
    }
    return { summary: polled.summary, servers, checkedAt: polled.checkedAt };
  }

  async planConfig(server, input) {
    const change = validateIniInput(input);
    const current = await this.readConfig(server.envPrefix, change.fileKey);
    const currentHash = sha256(current.text);
    const preview = await this.setIniValue({ prefix: server.envPrefix, ...change, dryRun: true });
    const planHash = configPlanHash({ serverId: server.id, ...change, currentHash });
    return { ...preview, fileKey: change.fileKey, section: change.section, key: change.key, value: change.value, currentHash, planHash, approvalRequired: preview.changed === true, applyAction: 'config.apply' };
  }

  async applyConfig(server, input) {
    if (input.approved !== true) throw new Error('config.apply requires approved=true.');
    const suppliedPlanHash = clean(input.planHash, 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(suppliedPlanHash)) throw new Error('config.apply requires a valid planHash from config.plan.');
    const change = validateIniInput(input);
    const current = await this.readConfig(server.envPrefix, change.fileKey);
    const currentHash = sha256(current.text);
    const expectedPlanHash = configPlanHash({ serverId: server.id, ...change, currentHash });
    if (!crypto.timingSafeEqual(Buffer.from(suppliedPlanHash), Buffer.from(expectedPlanHash))) throw new Error('Config plan is stale or does not match this change. Run config.plan again before applying.');
    const result = await this.setIniValue({ prefix: server.envPrefix, ...change, dryRun: false });
    if (result.restartRequired && typeof this.registry.setRestartRequired === 'function') this.registry.setRestartRequired(server.id, { required: true, reason: `${change.fileKey}:${change.section}.${change.key} changed`, transactionId: clean(input.correlationId, 80) });
    return { ...result, fileKey: change.fileKey, section: change.section, key: change.key, planHash: suppliedPlanHash, verified: true, rollbackOnVerificationFailure: true };
  }

  async restartServer(server, input) {
    if (input.approved !== true) throw new Error('server.restart requires approved=true.');
    const confirmation = clean(input.confirmation, 100).toLowerCase();
    if (confirmation !== String(server.id).toLowerCase()) throw new Error(`server.restart requires confirmation=${server.id}.`);
    const rawPlayers = await this.rcon(server).execute('ListPlayers');
    const players = parsePlayers(rawPlayers);
    if (players.length && input.allowPlayers !== true) throw new Error(`Restart blocked: ${players.length} player(s) are connected. Set allowPlayers=true only after warnings/approval.`);
    const runtime = arkServerFromEnv(server.envPrefix);
    const recovery = async (target, options = {}) => {
      const recovered = await this.waitForRecovery(target, options);
      if (recovered && typeof this.registry.setRestartRequired === 'function') {
        try { this.registry.setRestartRequired(server.id, { required: false, transactionId: clean(input.correlationId, 80) }); } catch {}
      }
      return recovered;
    };
    const accepted = await this.performRestart(runtime, { prefix: server.envPrefix, recovery });
    return { accepted: true, method: 'citadel-gamecp', playerCountAtApproval: players.length, recoveryMonitoring: true, restartRequiredWillClearOnRecovery: true, host: { action: accepted.action, previousState: accepted.previousState, acceptedStatus: accepted.acceptedStatus } };
  }

  async execute(input = {}, context = {}) {
    const action = clean(input.action, 60).toLowerCase();
    if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Unsupported ARK backend action: ${action || '(missing)'}.`);
    const id = correlationId(input.correlationId || context.correlationId);
    if (this.completed.has(id)) return { ...this.completed.get(id), replayed: true };
    const startedAt = new Date().toISOString();
    const started = Date.now();
    let server = null;
    try {
      let data;
      if (action === 'cluster.health') data = await this.clusterHealth();
      else {
        server = this.resolveServer(input.serverId || input.server || input.map);
        if (action === 'server.status' || action === 'server.players') {
          const raw = await this.rcon(server).execute('ListPlayers');
          const players = parsePlayers(raw);
          const runtime = { state: 'online', playerCount: players.length, players, lastCheckedAt: new Date().toISOString(), lastOnlineAt: new Date().toISOString(), lastError: '' };
          try { this.registry.updateRuntime(server.id, runtime); } catch {}
          data = action === 'server.players' ? { players, playerCount: players.length } : { state: 'online', playerCount: players.length, maintenance: server.maintenance === true, restartRequired: server.restartRequired === true };
        } else if (action === 'server.save') {
          const response = await this.rcon(server).execute('SaveWorld');
          data = { saved: true, response: clean(response, 300) };
        } else if (action === 'server.broadcast') {
          const message = clean(input.message, 220);
          if (!message) throw new Error('Broadcast message is required.');
          const response = await this.rcon(server).execute(`Broadcast ${message}`);
          data = { broadcast: true, message, response: clean(response, 300) };
        } else if (action === 'server.restart') data = await this.restartServer(server, { ...input, correlationId: id });
        else if (action === 'config.plan') data = await this.planConfig(server, input);
        else if (action === 'config.apply') data = await this.applyConfig(server, { ...input, correlationId: id });
      }
      const result = { ok: true, action, correlationId: id, server: server ? { id: server.id, name: server.name, mapName: server.mapName, envPrefix: server.envPrefix } : null, data, llmCalls: 0, durationMs: Date.now() - started, completedAt: new Date().toISOString() };
      this.remember(id, result);
      this.audit({ ...result, source: clean(context.source || 'admin-api', 80), startedAt });
      return result;
    } catch (error) {
      const failure = { ok: false, action, correlationId: id, server: server ? { id: server.id, name: server.name, mapName: server.mapName, envPrefix: server.envPrefix } : null, code: 'ARK_BACKEND_OPERATION_FAILED', message: clean(error?.message || error, 300), llmCalls: 0, durationMs: Date.now() - started, completedAt: new Date().toISOString() };
      this.remember(id, failure);
      this.audit({ ...failure, source: clean(context.source || 'admin-api', 80), startedAt });
      return failure;
    }
  }
}

module.exports = { ALLOWED_ACTIONS, ArkBackendControl, clean, configPlanHash, correlationId, parsePlayers, sha256, validateIniInput };
