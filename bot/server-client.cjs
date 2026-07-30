'use strict';

const { SourceRcon } = require('./rcon.cjs');
const { PalworldRestClient, normalizeServerAddress, summarizeGameData } = require('./palworld-rest.cjs');
const { RustWebRconClient } = require('./rust-webrcon.cjs');
const { SatisfactoryApiClient } = require('./satisfactory-api.cjs');

function isPalworldRest(server = {}) {
  return String(server.game || '').toLowerCase() === 'palworld' && String(server.connectionType || 'rest').toLowerCase() !== 'rcon';
}

function isRustWebRcon(server = {}) {
  return String(server.game || '').toLowerCase() === 'rust';
}

function isSatisfactoryApi(server = {}) {
  return String(server.game || '').toLowerCase() === 'satisfactory';
}

function legacyCommand(server, action, value = '') {
  const game = String(server.game || 'generic').toLowerCase();
  const commands = {
    ark: {
      status: 'ListPlayers', players: 'ListPlayers', save: 'SaveWorld',
      announce: `Broadcast ${value}`, kick: `KickPlayer ${value}`, ban: `BanPlayer ${value}`,
      shutdown: 'DoExit', stop: 'DoExit'
    },
    palworld: {
      status: 'Info', players: 'ShowPlayers', save: 'Save',
      announce: `Broadcast ${value}`, kick: `KickPlayer ${value}`, ban: `BanPlayer ${value}`,
      unban: `UnBanPlayer ${value}`, shutdown: `Shutdown ${value}`, stop: 'DoExit'
    },
    generic: {
      status: server.statusCommand || 'status', players: server.playersCommand || 'list', save: server.saveCommand || 'save-all',
      announce: `${server.broadcastCommand || 'broadcast'} ${value}`, kick: `${server.kickCommand || 'kick'} ${value}`,
      ban: `${server.banCommand || 'ban'} ${value}`, unban: `${server.unbanCommand || 'unban'} ${value}`,
      shutdown: `${server.shutdownCommand || 'shutdown'} ${value}`, stop: server.stopCommand || 'stop'
    }
  };
  return (commands[game] || commands.generic)[action];
}

function formatPlayers(payload) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  if (!players.length) {
    const count = Number(payload?.count);
    return Number.isFinite(count) && count > 0
      ? `${count} player(s) are connected, but this server API does not expose player names.`
      : 'No players are currently connected.';
  }
  return players.map((player) => {
    const name = player.name || player.accountName || player.DisplayName || 'Unknown';
    const id = player.userId || player.playerId || player.identifier || player.steamId || player.SteamID || 'no id';
    const level = player.level ?? player.CurrentLevel;
    const ping = Math.round(Number(player.ping ?? player.Ping) || 0);
    return `${name} | ${id}${level === undefined || level === null ? '' : ` | Lv ${level}`} | ${ping} ms`;
  }).join('\n');
}

class ServerConnection {
  constructor(server, options = {}) {
    this.server = isPalworldRest(server) ? normalizeServerAddress(server) : { ...server };
    this.rest = isPalworldRest(server) ? new PalworldRestClient({ ...this.server, password: server.password }, options.palworld || options) : null;
    this.rust = isRustWebRcon(server) ? new RustWebRconClient({ ...server, password: server.password }, options.rust || options) : null;
    this.satisfactory = isSatisfactoryApi(server) ? new SatisfactoryApiClient({ ...server, password: server.password }, options.satisfactory || options) : null;
    this.rcon = this.rest || this.rust || this.satisfactory ? null : new SourceRcon(server);
  }

  async resolveUserId(identifier) {
    const value = String(identifier || '').trim();
    if (!value) throw new Error('A Palworld player name or user ID is required.');
    const payload = await this.rest.players();
    const lowered = value.toLowerCase();
    const player = (payload.players || []).find((item) => [item.userId, item.playerId, item.name, item.accountName]
      .some((candidate) => String(candidate || '').toLowerCase() === lowered));
    return player?.userId || value;
  }

  async action(action, payload = {}, options = {}) {
    if (this.rust) return this.rust.action(action, payload, { signal: options.signal });
    if (this.satisfactory) return this.satisfactory.action(action, payload, { signal: options.signal });

    if (this.rest) {
      switch (action) {
        case 'status': return { info: await this.rest.info(), metrics: await this.rest.metrics() };
        case 'info': return this.rest.info();
        case 'players': return this.rest.players();
        case 'settings': return this.rest.settings();
        case 'metrics': return this.rest.metrics();
        case 'game-data': return this.rest.gameData();
        case 'game-data-summary': return summarizeGameData(await this.rest.gameData());
        case 'announce': return this.rest.announce(payload.message);
        case 'save': return this.rest.save();
        case 'kick': return this.rest.kick(await this.resolveUserId(payload.userid || payload.player), payload.message);
        case 'ban': return this.rest.ban(await this.resolveUserId(payload.userid || payload.player), payload.message);
        case 'unban': return this.rest.unban(payload.userid || payload.player);
        case 'shutdown': return this.rest.shutdown(payload.waittime, payload.message);
        case 'stop': return this.rest.stop();
        case 'raw': throw new Error('Raw RCON commands are unavailable for a Palworld REST connection. Use a typed Palworld action instead.');
        default: throw new Error(`Unsupported Palworld REST action: ${action}`);
      }
    }

    if (['settings', 'metrics', 'game-data', 'game-data-summary'].includes(action)) {
      throw new Error(`${action} is only available for typed REST/API connections.`);
    }
    if (action === 'raw') return this.rcon.execute(String(payload.command || ''));
    const value = action === 'announce' ? payload.message
      : ['kick', 'ban', 'unban'].includes(action) ? (payload.userid || payload.player)
        : action === 'shutdown' ? `${Math.max(0, Number(payload.waittime) || 0)} ${payload.message || ''}`.trim()
          : '';
    const command = legacyCommand(this.server, action, value);
    if (!command) throw new Error(`Unsupported ${this.server.game || 'generic'} server action: ${action}`);
    return this.rcon.execute(command);
  }

  async execute(command) {
    if (this.rust) {
      const text = String(command || '').trim();
      if (/^(status|serverinfo)$/i.test(text)) return JSON.stringify(await this.rust.action('status'), null, 2);
      if (/^(list|players|playerlist)$/i.test(text)) return formatPlayers(await this.rust.action('players'));
      if (/^(save|save-all)$/i.test(text)) return this.rust.action('save');
      const announce = text.match(/^(?:broadcast|say)\s+(.+)$/i);
      if (announce) return this.rust.action('announce', { message: announce[1] });
      return this.rust.execute(text);
    }
    if (this.satisfactory) {
      const text = String(command || '').trim();
      if (/^(status|serverinfo)$/i.test(text)) return JSON.stringify(await this.satisfactory.action('status'), null, 2);
      if (/^(list|players|playerlist)$/i.test(text)) return formatPlayers(await this.satisfactory.action('players'));
      if (/^(save|save-all)$/i.test(text)) return this.satisfactory.action('save');
      if (/^(shutdown|stop|quit)$/i.test(text)) return this.satisfactory.action('shutdown', { saveFirst: true });
      return this.satisfactory.action('raw', { command: text });
    }
    if (!this.rest) return this.rcon.execute(command);
    const text = String(command || '').trim();
    if (/^Info$/i.test(text)) return JSON.stringify(await this.rest.info(), null, 2);
    if (/^ShowPlayers$/i.test(text)) return formatPlayers(await this.rest.players());
    if (/^Save$/i.test(text)) { await this.rest.save(); return 'World save requested through Palworld REST.'; }
    let match = text.match(/^Broadcast\s+(.+)$/i);
    if (match) { await this.rest.announce(match[1]); return 'Announcement sent through Palworld REST.'; }
    match = text.match(/^KickPlayer\s+(.+)$/i);
    if (match) { await this.action('kick', { player: match[1] }); return 'Player kicked through Palworld REST.'; }
    match = text.match(/^BanPlayer\s+(.+)$/i);
    if (match) { await this.action('ban', { player: match[1] }); return 'Player banned through Palworld REST.'; }
    match = text.match(/^UnBanPlayer\s+(.+)$/i);
    if (match) { await this.action('unban', { player: match[1] }); return 'Player unbanned through Palworld REST.'; }
    match = text.match(/^Shutdown\s+(\d+)(?:\s+(.+))?$/i);
    if (match) { await this.rest.shutdown(Number(match[1]), match[2] || ''); return 'Palworld shutdown scheduled.'; }
    if (/^DoExit$/i.test(text)) { await this.rest.stop(); return 'Palworld force-stop requested.'; }
    throw new Error(`The legacy command “${text}” has no safe Palworld REST equivalent.`);
  }
}

module.exports = { ServerConnection, isPalworldRest, isRustWebRcon, isSatisfactoryApi, legacyCommand, formatPlayers };