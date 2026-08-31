'use strict';

const crypto = require('node:crypto');
const { ChannelType } = require('discord.js');
const { connectMysql } = require('./arkshop-mysql.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const STATES = Object.freeze(['ACTIVE', 'TAMED', 'KILLED', 'DESPAWNED', 'FAILED', 'UNKNOWN']);
const TERMINAL = new Set(['TAMED', 'KILLED', 'DESPAWNED']);
const clean = (value, max = 160) => String(value || '').replace(/[\r\n\0|]+/g, ' ').replace(/[@`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function enabled(env = process.env) { return String(env.NEXUS_SHINY_INGEST_ENABLED || 'false').toLowerCase() === 'true'; }

function validIngestToken(provided, expected = process.env.NEXUS_SHINY_INGEST_TOKEN) {
  const left = Buffer.from(String(provided || '')); const right = Buffer.from(String(expected || ''));
  return right.length >= 32 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function webhookText(payload = {}) {
  const values = [payload.content, payload.message, payload.text];
  for (const embed of Array.isArray(payload.embeds) ? payload.embeds : []) values.push(embed?.title, embed?.description, ...(embed?.fields || []).flatMap((field) => [field?.name, field?.value]));
  return values.map((value) => String(value || '')).filter(Boolean).join('\n').slice(0, 8000);
}

function parseShinyWebhook(payload) {
  const marker = webhookText(payload).split(/\r?\n/).find((line) => /NEXUS\|(ACTIVE|TAMED|KILLED|DESPAWNED)\|/i.test(line));
  if (!marker) throw new Error('Shiny webhook does not contain the configured Nexus marker.');
  const parts = marker.slice(marker.toUpperCase().indexOf('NEXUS|')).split('|');
  const state = String(parts[1] || '').toUpperCase();
  if (!STATES.includes(state) || !['ACTIVE', ...TERMINAL].includes(state)) throw new Error('Unsupported Shiny lifecycle event.');
  const dinoName = clean(parts[2], 160); const detail = clean(parts[3], 160); const serverName = clean(parts[4], 100); const mapName = clean(parts[5], 100);
  if (!dinoName || !mapName) throw new Error('Shiny webhook is missing dino or map identity.');
  if (/\b(?:lat|latitude|lon|long|longitude)\b\s*[:=]?\s*-?\d/i.test(detail)) throw new Error('Coordinate-bearing Shiny notifications are not accepted.');
  const event = { state, dinoName, serverName, mapName, regionName: state === 'ACTIVE' ? detail : '', playerName: TERMINAL.has(state) ? detail : '' };
  event.correlationKey = hash(`${mapName.toLowerCase()}|${dinoName.toLowerCase()}`);
  event.fingerprint = hash(JSON.stringify(event));
  return Object.freeze(event);
}

function resolveServer(event, registry) {
  const target = `${event.serverName} ${event.mapName}`.toLowerCase();
  return registry.list().find((server) => [server.id, server.name, server.mapName].some((value) => target.includes(String(value || '').toLowerCase()))) || null;
}

class NexusAnomalyStore {
  constructor(connection) { if (!connection?.execute || !connection?.beginTransaction) throw new Error('NexusAnomalyStore requires a mysql2 promise connection.'); this.db = connection; }

  async ingest(event, serverId = '') {
    await this.db.beginTransaction();
    try {
      const [duplicate] = await this.db.execute('SELECT anomaly_id FROM nexus_anomaly_events WHERE event_fingerprint=? LIMIT 1 FOR UPDATE', [event.fingerprint]);
      if (duplicate[0]) { await this.db.rollback(); return { duplicate: true, anomalyId: duplicate[0].anomaly_id, state: event.state }; }
      let anomalyId = crypto.randomUUID(); let state = event.state; let reason = '';
      if (event.state === 'ACTIVE') {
        await this.db.execute(`INSERT INTO nexus_anomalies (id, correlation_key, server_id, server_name, map_name, dino_name, region_name, state, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', CURRENT_TIMESTAMP(3))`, [anomalyId, event.correlationKey, serverId, event.serverName, event.mapName, event.dinoName, event.regionName]);
      } else {
        const [active] = await this.db.execute(`SELECT id FROM nexus_anomalies WHERE correlation_key=? AND state='ACTIVE' ORDER BY opened_at DESC LIMIT 2 FOR UPDATE`, [event.correlationKey]);
        if (active.length === 1) {
          anomalyId = active[0].id;
          await this.db.execute('UPDATE nexus_anomalies SET state=?, player_name=?, closed_at=CURRENT_TIMESTAMP(3) WHERE id=? AND state=\'ACTIVE\'', [event.state, event.playerName, anomalyId]);
        } else {
          state = 'UNKNOWN'; reason = active.length ? 'ambiguous active anomaly match' : 'no active anomaly match';
          await this.db.execute(`INSERT INTO nexus_anomalies (id, correlation_key, server_id, server_name, map_name, dino_name, player_name, state, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'UNKNOWN', CURRENT_TIMESTAMP(3))`, [anomalyId, event.correlationKey, serverId, event.serverName, event.mapName, event.dinoName, event.playerName]);
        }
      }
      const summary = clean(reason || `${event.state} ${event.dinoName} on ${event.mapName}`, 500);
      await this.db.execute('INSERT INTO nexus_anomaly_events (anomaly_id, event_fingerprint, event_type, event_summary) VALUES (?, ?, ?, ?)', [anomalyId, event.fingerprint, event.state, summary]);
      await this.db.commit();
      return { duplicate: false, anomalyId, state, sourceState: event.state, reason };
    } catch (error) {
      await this.db.rollback().catch(() => {});
      if (error?.code === 'ER_DUP_ENTRY') {
        const [duplicate] = await this.db.execute('SELECT anomaly_id FROM nexus_anomaly_events WHERE event_fingerprint=? LIMIT 1', [event.fingerprint]);
        if (duplicate[0]) return { duplicate: true, anomalyId: duplicate[0].anomaly_id, state: event.state };
      }
      throw error;
    }
  }
}

async function anomalyPreflight(connection) {
  if (String(process.env.ARKSHOP_DB_MODE || '').toLowerCase() !== 'mysql') throw new Error('Nexus anomaly lifecycle storage requires the shared MySQL backend.');
  const [rows] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('nexus_anomalies','nexus_anomaly_events')");
  if (new Set(rows.map((row) => row.TABLE_NAME)).size !== 2) throw new Error('Nexus anomaly MySQL migration 002 has not been applied.');
}

async function ensureAnomalyChannel(guild) {
  const channels = await guild.channels.fetch();
  let channel = channels.find((item) => item.type === ChannelType.GuildText && String(item.name).toLowerCase() === 'nexus-anomalies');
  if (channel) return { channel, created: false };
  const parent = channels.find((item) => item.type === ChannelType.GuildCategory && /\bark\b/i.test(String(item.name))) || channels.find((item) => item.type === ChannelType.GuildCategory && /nexus hq/i.test(String(item.name)));
  channel = await guild.channels.create({ name: 'nexus-anomalies', type: ChannelType.GuildText, ...(parent ? { parent: String(parent.id) } : {}), topic: 'Coordinate-free Shiny and Nexus Anomaly lifecycle alerts maintained by Nexus Sentinel.', reason: 'Nexus Sentinel anomaly lifecycle feed' });
  return { channel, created: true };
}

function announcement(event, result) {
  const region = event.regionName ? ` in **${event.regionName}**` : '';
  const player = event.playerName ? ` by **${event.playerName}**` : '';
  if (event.state === 'ACTIVE') return `🧬 **Nexus Anomaly detected**\nA **${event.dinoName}** anomaly has emerged on **${event.mapName}**${region}. Coordinates are intentionally withheld.`;
  if (result.state === 'UNKNOWN') return `⚠️ **Nexus Anomaly needs correlation review**\nA **${event.state.toLowerCase()}** event was received for **${event.dinoName}** on **${event.mapName}**, but Sentinel could not uniquely match an active lifecycle.`;
  const verbs = { TAMED: 'was tamed', KILLED: 'was killed', DESPAWNED: 'has dissipated' };
  return `🧬 **Nexus Anomaly ${event.state.toLowerCase()}**\nThe **${event.dinoName}** anomaly on **${event.mapName}** ${verbs[event.state]}${player}.`;
}

async function relayCrossChat(message, registry) {
  if (String(process.env.NEXUS_SHINY_CROSSCHAT_ENABLED || 'false').toLowerCase() !== 'true') return { sent: 0, skipped: 'disabled' };
  const oneLine = clean(message.replace(/\*+/g, ''), 360); let sent = 0;
  for (const server of registry.list({ includeDisabled: false })) {
    if (server.connections?.rcon !== true) continue;
    const connection = arkServerFromEnv(server.envPrefix);
    if (!connection.enabled) continue;
    await new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password }).execute(`ServerChat [Nexus Anomaly] ${oneLine}`);
    sent += 1;
  }
  return { sent };
}

async function handleShinyWebhook({ token, payload, controller, connector = connectMysql, registry = new ArkClusterRegistry() } = {}) {
  if (!enabled()) return { status: 503, body: { ok: false, code: 'SHINY_INGEST_DISABLED' } };
  if (!validIngestToken(token)) return { status: 401, body: { ok: false, code: 'SHINY_INGEST_UNAUTHORIZED' } };
  if (!controller?.guild) return { status: 503, body: { ok: false, code: 'SENTINAL_STARTING' } };
  const event = parseShinyWebhook(payload);
  const server = resolveServer(event, registry);
  const { connection } = await connector(); let result;
  try { await anomalyPreflight(connection); result = await new NexusAnomalyStore(connection).ingest(event, server?.id || ''); }
  finally { await connection.end().catch(() => {}); }
  if (!result.duplicate) {
    const message = announcement(event, result);
    const { channel } = await ensureAnomalyChannel(controller.guild);
    await channel.send({ content: message.slice(0, 1900), allowedMentions: { parse: [] } });
    await relayCrossChat(message, registry).catch(() => ({ sent: 0, failed: true }));
  }
  return { status: 202, body: { ok: true, accepted: true, duplicate: result.duplicate, anomalyId: result.anomalyId, state: result.state } };
}

module.exports = { STATES, TERMINAL, enabled, validIngestToken, webhookText, parseShinyWebhook, resolveServer, NexusAnomalyStore, anomalyPreflight, ensureAnomalyChannel, announcement, relayCrossChat, handleShinyWebhook };
