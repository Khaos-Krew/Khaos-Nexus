'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { SourceRcon } = require('../transports/source-rcon.cjs');

const COMMON_ACTIONS = Object.freeze(['status', 'players', 'servers', 'save', 'broadcast', 'kick', 'ban', 'unban', 'rcon']);

function safeMessage(value, max = 500) {
  const text = String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return text || '';
}

function safeArgument(value, max = 160) {
  const text = safeMessage(value, max);
  if (!text) return '';
  if (/[;\u0000]/.test(text)) throw new Error('RCON arguments cannot contain semicolons or control characters.');
  return text;
}

function parseArkPlayers(response) {
  const text = String(response || '').trim();
  if (!text || /no players connected/i.test(text)) return [];
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const normalized = line.replace(/^\d+\.\s*/, '');
    const parts = normalized.split(',').map((part) => part.trim()).filter(Boolean);
    return { name: parts[0] || normalized, id: parts[1] || '' };
  });
}

function parseMinecraftPlayers(response) {
  const text = String(response || '').trim();
  const match = /there are\s+(\d+)\s+of a max of\s+(\d+)\s+players online:?\s*(.*)$/i.exec(text);
  if (!match) return { count: null, maxPlayers: null, players: [], raw: text };
  const names = String(match[3] || '').split(',').map((name) => name.trim()).filter(Boolean);
  return { count: Number(match[1]), maxPlayers: Number(match[2]), players: names.map((name) => ({ name })), raw: text };
}

function serverName(server, index) {
  return safeMessage(server.name || server.id || server.map || `server-${index + 1}`, 80).toLowerCase().replace(/[^a-z0-9._ -]+/g, '').trim() || `server-${index + 1}`;
}

function normalizeServerDefinitions(connection = {}) {
  const raw = Array.isArray(connection.servers) && connection.servers.length ? connection.servers : [connection];
  return raw.map((server, index) => ({ ...connection, ...server, servers: undefined, name: serverName(server, index) }));
}

function splitTarget(payload = {}, servers = []) {
  const explicit = safeMessage(payload.server || payload.serverId, 80);
  let input = safeMessage(payload.input, 1200);
  if (explicit) return { server: explicit, input };
  const pipe = input.indexOf('|');
  if (pipe > 0) {
    const candidate = input.slice(0, pipe).trim();
    const match = servers.find((server) => server.name.toLowerCase() === candidate.toLowerCase());
    if (match) return { server: match.name, input: input.slice(pipe + 1).trim() };
  }
  return { server: '', input };
}

async function backupEntries(rootPath) {
  const value = safeMessage(rootPath, 1000);
  if (!value) return [];
  const root = path.resolve(value);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const rows = [];
  for (const entry of entries.slice(0, 100)) {
    try {
      const stat = await fs.stat(path.join(root, entry.name));
      rows.push({ name: entry.name.slice(0, 220), directory: entry.isDirectory(), size: entry.isFile() ? stat.size : null, modifiedAt: stat.mtime.toISOString() });
    } catch {}
  }
  return rows.sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt))).slice(0, 20);
}

class SourceRconProvider {
  constructor(moduleId, connection = {}, options = {}) {
    if (!['ark', 'minecraft'].includes(moduleId)) throw new Error(`Source RCON provider does not support ${moduleId}.`);
    this.moduleId = moduleId;
    this.connection = connection;
    this.servers = normalizeServerDefinitions(connection);
    this.clients = new Map();
    for (let index = 0; index < this.servers.length; index += 1) {
      const server = this.servers[index];
      const provided = options.clients?.[server.name] || (this.servers.length === 1 ? options.client : null);
      this.clients.set(server.name, provided || new SourceRcon(server));
    }
    this.connected = true;
    this.providerKind = `${moduleId}-rcon${this.servers.length > 1 ? '-cluster' : ''}`;
    this.supportedActions = [...COMMON_ACTIONS];
    if (moduleId === 'ark') this.supportedActions.push('mods');
    if (moduleId === 'minecraft') this.supportedActions.push('whitelist', 'modpack');
    if (this.servers.some((server) => server.backupPath)) this.supportedActions.push('backups');
    if (this.servers.some((server) => server.restartOnExit === true || server.restartCommand)) this.supportedActions.push('restart');
  }

  selectedServers(payload = {}, requireExplicit = false) {
    const parsed = splitTarget(payload, this.servers);
    if (parsed.server) {
      const found = this.servers.find((server) => server.name.toLowerCase() === parsed.server.toLowerCase());
      if (!found) throw new Error(`Unknown ${this.moduleId} server: ${parsed.server}.`);
      return { servers: [found], input: parsed.input };
    }
    if (requireExplicit && this.servers.length > 1) throw new Error(`This action needs a server prefix because multiple servers are configured. Use <server>|<input>. Available: ${this.servers.map((server) => server.name).join(', ')}`);
    return { servers: this.servers, input: parsed.input };
  }

  clientFor(server) { return this.clients.get(server.name); }

  async execute(server, command) { return this.clientFor(server).execute(command); }

  async statusFor(server) {
    try {
      const raw = await this.execute(server, this.moduleId === 'ark' ? 'ListPlayers' : 'list');
      if (this.moduleId === 'ark') {
        const players = parseArkPlayers(raw);
        return { server: server.name, online: true, count: players.length, players, raw };
      }
      const parsed = parseMinecraftPlayers(raw);
      return { server: server.name, online: true, ...parsed };
    } catch (error) {
      return { server: server.name, online: false, error: safeMessage(error?.message || error, 300) };
    }
  }

  async status(payload = {}) {
    const { servers } = this.selectedServers(payload);
    const results = await Promise.all(servers.map((server) => this.statusFor(server)));
    return { online: results.some((item) => item.online), serverCount: results.length, servers: results };
  }

  async players(payload = {}) {
    const status = await this.status(payload);
    const players = [];
    for (const server of status.servers) for (const player of server.players || []) players.push({ server: server.server, ...player });
    return { count: players.length, players, servers: status.servers.map(({ players: omitted, raw: rawOmitted, ...server }) => server) };
  }

  async runAcross(servers, commandFactory) {
    const results = [];
    for (const server of servers) {
      try { results.push({ server: server.name, ok: true, response: await this.execute(server, commandFactory(server)) }); }
      catch (error) { results.push({ server: server.name, ok: false, error: safeMessage(error?.message || error, 300) }); }
    }
    if (!results.some((item) => item.ok)) throw new Error(results.map((item) => `${item.server}: ${item.error}`).join(' | '));
    return results;
  }

  restartCommand(server, seconds) {
    if (server.restartCommand) return String(server.restartCommand).replace(/\{seconds\}/g, String(seconds));
    if (server.restartOnExit === true) return this.moduleId === 'ark' ? 'DoExit' : 'stop';
    return '';
  }

  async invoke(actionId, payload = {}) {
    if (!this.supportedActions.includes(actionId)) throw new Error(`${this.moduleId} RCON does not support ${actionId} on the configured connection.`);
    if (actionId === 'servers') return { servers: this.servers.map((server) => ({ name: server.name, host: server.host, port: server.port, restartConfigured: Boolean(server.restartCommand || server.restartOnExit), backupsConfigured: Boolean(server.backupPath) })) };
    if (actionId === 'status') return this.status(payload);
    if (actionId === 'players') return this.players(payload);

    if (actionId === 'save') {
      const { servers } = this.selectedServers(payload);
      return { accepted: true, results: await this.runAcross(servers, () => this.moduleId === 'ark' ? 'SaveWorld' : 'save-all flush') };
    }

    if (actionId === 'broadcast') {
      const selected = this.selectedServers(payload);
      const message = safeMessage(payload.message || selected.input, 500);
      if (!message) return { usage: `Use /nexus run module:${this.moduleId} action:broadcast input:<message>, or <server>|<message>.` };
      return { accepted: true, results: await this.runAcross(selected.servers, () => this.moduleId === 'ark' ? `Broadcast ${message}` : `say ${message}`) };
    }

    if (['kick', 'ban', 'unban'].includes(actionId)) {
      const selected = this.selectedServers(payload, true);
      const target = safeArgument(payload.target || payload.player || selected.input, 160);
      if (!target) return { usage: `Use /nexus run module:${this.moduleId} action:${actionId} input:${this.servers.length > 1 ? '<server>|' : ''}<player>.` };
      let command;
      if (this.moduleId === 'ark') command = actionId === 'kick' ? `KickPlayer ${target}` : actionId === 'ban' ? `BanPlayer ${target}` : `UnBanPlayer ${target}`;
      else command = actionId === 'kick' ? `kick ${target}` : actionId === 'ban' ? `ban ${target}` : `pardon ${target}`;
      return { accepted: true, results: await this.runAcross(selected.servers, () => command) };
    }

    if (actionId === 'whitelist') {
      const { servers } = this.selectedServers(payload);
      return { results: await this.runAcross(servers, () => 'whitelist list') };
    }

    if (actionId === 'restart') {
      const selected = this.selectedServers(payload, true);
      const seconds = Math.max(0, Math.min(3600, Math.floor(Number(payload.seconds || selected.input || 60) || 60)));
      const servers = selected.servers.filter((server) => this.restartCommand(server, seconds));
      if (!servers.length) throw new Error('Restart is not configured for the selected server. Set restartOnExit=true when a supervisor restarts the process, or provide restartCommand.');
      return {
        accepted: true,
        seconds,
        results: await this.runAcross(servers, (server) => this.restartCommand(server, seconds)),
        note: 'Nexus issued the configured server-side restart/exit command. Process restart still depends on the host supervisor when restartOnExit is used.'
      };
    }

    if (actionId === 'rcon') {
      const selected = this.selectedServers(payload, true);
      const command = safeMessage(payload.command || selected.input, 2000);
      if (!command) return { usage: `Use /nexus run module:${this.moduleId} action:rcon input:${this.servers.length > 1 ? '<server>|' : ''}<command>.` };
      return { results: await this.runAcross(selected.servers, () => command) };
    }

    if (actionId === 'mods') {
      return { servers: this.servers.map((server) => ({ server: server.name, mods: Array.isArray(server.mods) ? server.mods : Array.isArray(this.connection.mods) ? this.connection.mods : [] })) };
    }

    if (actionId === 'modpack') {
      return { servers: this.servers.map((server) => ({ server: server.name, modpack: server.modpack || this.connection.modpack || null })) };
    }

    if (actionId === 'backups') {
      const rows = [];
      for (const server of this.servers) {
        if (!server.backupPath) { rows.push({ server: server.name, configured: false, files: [] }); continue; }
        try { rows.push({ server: server.name, configured: true, files: await backupEntries(server.backupPath) }); }
        catch (error) { rows.push({ server: server.name, configured: true, files: [], error: safeMessage(error?.message || error, 300) }); }
      }
      return { servers: rows };
    }

    throw new Error(`Unsupported ${this.moduleId} action: ${actionId}`);
  }
}

module.exports = {
  SourceRconProvider, COMMON_ACTIONS, safeMessage, safeArgument, parseArkPlayers, parseMinecraftPlayers,
  normalizeServerDefinitions, splitTarget, backupEntries
};
