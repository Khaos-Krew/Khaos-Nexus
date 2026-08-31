'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { setIniValue } = require('./ark-config-manager.cjs');

const ALLOWED_ACTIONS = new Set(['server.status', 'server.players', 'server.save', 'server.broadcast', 'config.plan']);
function clean(value, max = 240) { return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function correlationId(value = '') { const supplied = clean(value, 80); if (supplied && /^[A-Za-z0-9._:-]{8,80}$/.test(supplied)) return supplied; return `ark-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`; }
function parsePlayers(raw = '') {
  const text = String(raw || '').trim();
  if (!text || /no players connected/i.test(text)) return [];
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const stripped = line.replace(/^\d+\.\s*/, '').trim();
    const match = stripped.match(/^(.*?)(?:,\s*([0-9a-f]{20,}|[A-Za-z0-9_-]{24,}))?$/i);
    return { name: clean(match?.[1] || stripped, 80), eosId: clean(match?.[2] || '', 100) };
  }).filter((player) => player.name);
}
function defaultAuditPath() { const root = process.env.NEXUS_DATA_DIR ? path.resolve(process.env.NEXUS_DATA_DIR) : path.resolve(__dirname, '../..', 'data'); return path.join(root, 'ark-backend-audit.jsonl'); }

class ArkBackendControl {
  constructor(options = {}) { this.registry = options.registry || new ArkClusterRegistry(); this.auditPath = options.auditPath || defaultAuditPath(); this.logger = options.logger || console; this.completed = new Map(); this.maxCompleted = Math.max(50, Number(options.maxCompleted) || 500); }
  listServers() { return this.registry.list({ includeDisabled: false }).map((server) => ({ id: server.id, name: server.name, mapName: server.mapName, envPrefix: server.envPrefix, maintenance: server.maintenance === true, restartRequired: server.restartRequired === true, runtime: server.runtime })); }
  resolveServer(value) {
    const requested = clean(value, 100).toLowerCase(); if (!requested) throw new Error('ARK server is required.');
    const servers = this.registry.list({ includeDisabled: true });
    let record = servers.find((item) => [item.id, item.name, item.mapName, item.envPrefix].some((candidate) => String(candidate || '').toLowerCase() === requested));
    if (!record && requested === 'map1') record = servers.find((item) => item.envPrefix === 'ARK_GEN1') || null;
    if (!record && requested === 'map2') record = servers.find((item) => item.envPrefix === 'ARK_MAP2') || null;
    if (!record) throw new Error(`Unknown ARK server: ${clean(value, 100)}`); if (record.enabled === false) throw new Error(`ARK server ${record.name} is disabled.`); return record;
  }
  rcon(record) { const config = arkServerFromEnv(record.envPrefix); if (!config.host || !config.port || !config.password) throw new Error(`RCON is not fully configured for ${record.name}.`); return new ArkRconClient(config); }
  remember(id, result) { this.completed.set(id, result); while (this.completed.size > this.maxCompleted) this.completed.delete(this.completed.keys().next().value); }
  audit(entry) { try { fs.mkdirSync(path.dirname(this.auditPath), { recursive: true }); fs.appendFileSync(this.auditPath, `${JSON.stringify(entry)}\n`, 'utf8'); } catch (error) { this.logger.error?.('[ARK Backend Audit]', error); } }
  async execute(input = {}, context = {}) {
    const action = clean(input.action, 60).toLowerCase(); if (!ALLOWED_ACTIONS.has(action)) throw new Error(`Unsupported ARK backend action: ${action || '(missing)'}.`);
    const id = correlationId(input.correlationId || context.correlationId); if (this.completed.has(id)) return { ...this.completed.get(id), replayed: true };
    const startedAt = new Date().toISOString(); const started = Date.now(); let server = null;
    try {
      server = this.resolveServer(input.serverId || input.server || input.map); let data;
      if (action === 'server.status' || action === 'server.players') {
        const raw = await this.rcon(server).execute('ListPlayers'); const players = parsePlayers(raw);
        const runtime = { state: 'online', playerCount: players.length, players, lastCheckedAt: new Date().toISOString(), lastOnlineAt: new Date().toISOString(), lastError: '' };
        try { this.registry.updateRuntime(server.id, runtime); } catch {}
        data = action === 'server.players' ? { players, playerCount: players.length } : { state: 'online', playerCount: players.length, maintenance: server.maintenance === true, restartRequired: server.restartRequired === true };
      } else if (action === 'server.save') { const response = await this.rcon(server).execute('SaveWorld'); data = { saved: true, response: clean(response, 300) }; }
      else if (action === 'server.broadcast') { const message = clean(input.message, 220); if (!message) throw new Error('Broadcast message is required.'); const response = await this.rcon(server).execute(`Broadcast ${message}`); data = { broadcast: true, message, response: clean(response, 300) }; }
      else if (action === 'config.plan') {
        const fileKey = clean(input.fileKey, 20).toLowerCase(); if (!['gus', 'game'].includes(fileKey)) throw new Error('config.plan currently allows only gus or game INI files.');
        const section = clean(input.section, 160); const key = clean(input.key, 160); if (!section || !key) throw new Error('config.plan requires section and key.');
        const plan = await setIniValue({ prefix: server.envPrefix, fileKey, section, key, value: String(input.value ?? ''), dryRun: true }); data = { ...plan, fileKey, section, key, value: String(input.value ?? '').slice(0, 500) };
      }
      const result = { ok: true, action, correlationId: id, server: { id: server.id, name: server.name, mapName: server.mapName, envPrefix: server.envPrefix }, data, llmCalls: 0, durationMs: Date.now() - started, completedAt: new Date().toISOString() };
      this.remember(id, result); this.audit({ ...result, source: clean(context.source || 'admin-api', 80), startedAt }); return result;
    } catch (error) {
      const failure = { ok: false, action, correlationId: id, server: server ? { id: server.id, name: server.name, mapName: server.mapName, envPrefix: server.envPrefix } : null, code: 'ARK_BACKEND_OPERATION_FAILED', message: clean(error?.message || error, 300), llmCalls: 0, durationMs: Date.now() - started, completedAt: new Date().toISOString() };
      this.remember(id, failure); this.audit({ ...failure, source: clean(context.source || 'admin-api', 80), startedAt }); return failure;
    }
  }
}
module.exports = { ALLOWED_ACTIONS, ArkBackendControl, clean, correlationId, parsePlayers };
