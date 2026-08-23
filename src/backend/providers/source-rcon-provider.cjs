'use strict';

const { SourceRcon } = require('../transports/source-rcon.cjs');

const RCON_ACTIONS = Object.freeze(['status', 'players', 'save', 'broadcast']);

function safeMessage(value, max = 500) {
  const text = String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!text) return '';
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
  return {
    count: Number(match[1]),
    maxPlayers: Number(match[2]),
    players: names.map((name) => ({ name })),
    raw: text
  };
}

class SourceRconProvider {
  constructor(moduleId, connection = {}, options = {}) {
    if (!['ark', 'minecraft'].includes(moduleId)) throw new Error(`Source RCON provider does not support ${moduleId}.`);
    this.moduleId = moduleId;
    this.client = options.client || new SourceRcon(connection);
    this.connected = true;
    this.providerKind = `${moduleId}-rcon`;
    this.supportedActions = [...RCON_ACTIONS];
  }

  commandFor(actionId, payload = {}) {
    if (this.moduleId === 'ark') {
      if (actionId === 'status' || actionId === 'players') return 'ListPlayers';
      if (actionId === 'save') return 'SaveWorld';
      if (actionId === 'broadcast') {
        const message = safeMessage(payload.message || payload.input);
        return message ? `Broadcast ${message}` : '';
      }
    }
    if (this.moduleId === 'minecraft') {
      if (actionId === 'status' || actionId === 'players') return 'list';
      if (actionId === 'save') return 'save-all flush';
      if (actionId === 'broadcast') {
        const message = safeMessage(payload.message || payload.input);
        return message ? `say ${message}` : '';
      }
    }
    return '';
  }

  async invoke(actionId, payload = {}) {
    if (!this.supportedActions.includes(actionId)) throw new Error(`${this.moduleId} RCON does not support ${actionId}.`);
    const command = this.commandFor(actionId, payload);
    if (!command && actionId === 'broadcast') {
      return { usage: `Use /nexus run module:${this.moduleId} action:broadcast input:<message>.` };
    }
    if (!command) throw new Error(`${this.moduleId} RCON has no safe command mapping for ${actionId}.`);
    const raw = await this.client.execute(command);
    if (actionId === 'status') {
      if (this.moduleId === 'ark') return { online: true, players: parseArkPlayers(raw), raw };
      return { online: true, ...parseMinecraftPlayers(raw) };
    }
    if (actionId === 'players') {
      if (this.moduleId === 'ark') {
        const players = parseArkPlayers(raw);
        return { count: players.length, players, raw };
      }
      return parseMinecraftPlayers(raw);
    }
    return { accepted: true, response: raw || `${actionId} accepted.` };
  }
}

module.exports = {
  SourceRconProvider,
  RCON_ACTIONS,
  safeMessage,
  parseArkPlayers,
  parseMinecraftPlayers
};
