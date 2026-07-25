'use strict';

const crypto = require('node:crypto');

const MAX_HISTORY = 300;
const VALID_ACTIONS = new Set(['kick', 'ban']);

function cleanText(value, max, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function normalizePlayerConsoleConfig(input = {}) {
  return {
    schemaVersion: 1,
    settings: {
      autoRefreshSeconds: clamp(input.settings?.autoRefreshSeconds, 0, 300, 30),
      historyLimit: clamp(input.settings?.historyLimit, 25, MAX_HISTORY, 150),
      tokenLifetimeMinutes: clamp(input.settings?.tokenLifetimeMinutes, 2, 30, 10)
    }
  };
}

function safePlayerName(value) {
  return cleanText(value, 80, 'Unknown Player');
}

function safeReason(value) {
  const reason = cleanText(value, 250);
  if (reason.length < 3) throw new Error('A moderation reason of at least 3 characters is required.');
  return reason;
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function playerToken() {
  return `player-${crypto.randomUUID()}`;
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

function parseRconPlayers(gameInput, payload) {
  const game = cleanText(gameInput, 30, 'generic').toLowerCase();
  const text = String(payload || '').trim();
  if (!text || /no players? (are )?(currently )?connected|no players connected/i.test(text)) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  if (game === 'palworld' && /name\s*,\s*playeruid/i.test(lines[0])) {
    const headers = parseCsvLine(lines.shift()).map((header) => header.toLowerCase());
    return lines.map((line) => {
      const values = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
      return {
        name: safePlayerName(row.name),
        identifier: cleanText(row.playeruid || row.steamid, 150),
        accountType: row.steamid ? 'Steam' : 'Palworld',
        level: null,
        ping: null
      };
    }).filter((player) => player.identifier);
  }

  const players = [];
  for (const line of lines) {
    if (/^(name|playername|connected players|players?)\s*[:,-]?$/i.test(line)) continue;
    const ark = line.match(/^\s*\d+[.)-]\s*(.+?)\s*,\s*([^,\s]+)(?:\s*,.*)?$/);
    if (ark) {
      players.push({
        name: safePlayerName(ark[1]),
        identifier: cleanText(ark[2], 150),
        accountType: game === 'ark' ? 'ARK account' : 'Server account',
        level: null,
        ping: null
      });
      continue;
    }
    const columns = line.split(/[|\t]/).map((value) => value.trim()).filter(Boolean);
    if (columns.length >= 2 && !/^(name|playername|steamid|userid)$/i.test(columns[0])) {
      players.push({
        name: safePlayerName(columns[0]),
        identifier: cleanText(columns[1], 150),
        accountType: 'Server account',
        level: safeNumber(columns[2]),
        ping: safeNumber(columns[3])
      });
      continue;
    }
    const comma = parseCsvLine(line);
    if (comma.length >= 2 && !/^(name|playername)$/i.test(comma[0])) {
      const name = comma[0].replace(/^\d+[.)-]\s*/, '').trim();
      players.push({
        name: safePlayerName(name),
        identifier: cleanText(comma[1], 150),
        accountType: 'Server account',
        level: safeNumber(comma[2]),
        ping: safeNumber(comma[3])
      });
    }
  }
  return players.filter((player) => player.identifier);
}

function normalizeRestPlayers(payload) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  return players.map((player) => ({
    name: safePlayerName(player?.name || player?.accountName),
    identifier: cleanText(player?.userId || player?.playerId, 150),
    accountType: cleanText(player?.platform || player?.accountName ? 'Palworld account' : 'Palworld', 40),
    level: safeNumber(player?.level),
    ping: safeNumber(player?.ping)
  })).filter((player) => player.identifier);
}

function normalizeModerationHistory(input = {}) {
  return {
    id: cleanText(input.id, 100, `moderation-${crypto.randomUUID()}`),
    action: VALID_ACTIONS.has(input.action) ? input.action : 'kick',
    playerName: safePlayerName(input.playerName),
    serverId: cleanText(input.serverId, 100),
    serverName: cleanText(input.serverName, 100, 'Unknown Server'),
    game: cleanText(input.game, 30, 'generic'),
    reason: cleanText(input.reason, 250),
    actorId: cleanText(input.actorId, 100),
    actorName: cleanText(input.actorName, 100, 'Local operator'),
    actorRole: cleanText(input.actorRole, 30, 'operator'),
    time: input.time ? String(input.time) : new Date().toISOString(),
    outcome: ['success', 'failed'].includes(input.outcome) ? input.outcome : 'failed',
    message: cleanText(input.message, 500)
  };
}

module.exports = {
  MAX_HISTORY,
  VALID_ACTIONS,
  normalizePlayerConsoleConfig,
  safePlayerName,
  safeReason,
  playerToken,
  parseRconPlayers,
  normalizeRestPlayers,
  normalizeModerationHistory
};
