'use strict';

const PLAYER_NAME = /^[A-Za-z0-9_]{3,16}$/;
const ITEM_ID = /^[a-z0-9_]+:[a-z0-9_./]+$/;
const ENTRY = /([A-Za-z0-9_]{1,16}) \(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})\)/g;

function playerNameOk(value) {
  return PLAYER_NAME.test(String(value || '').trim());
}

function itemIdOk(value) {
  return ITEM_ID.test(String(value || '').trim());
}

function normalizeUuid(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (!/^[0-9a-f]{32}$/.test(raw)) return '';
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

function isPremiumUuid(value) {
  const uuid = normalizeUuid(value);
  if (!uuid) return false;
  const version = uuid.charAt(14);
  const variant = uuid.charAt(19);
  return version === '4' && '89ab'.includes(variant);
}

function parseListUuids(text) {
  const raw = String(text || '');
  if (!/There are \d+ of a max of \d+ players online:/i.test(raw)) {
    return { ok: false, reason: 'unparseable', players: [] };
  }
  const players = [];
  const seen = new Set();
  for (const match of raw.matchAll(ENTRY)) {
    const name = match[1];
    const uuid = normalizeUuid(match[2]);
    if (!uuid || seen.has(uuid) || !playerNameOk(name)) continue;
    seen.add(uuid);
    players.push({ name, uuid });
  }
  return { ok: true, players };
}

function parseDataVector(text) {
  const match = String(text || '').match(/\[([^\]]+)\]/);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => Number(String(part).trim().replace(/[a-z]+$/i, '')));
  if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) return null;
  return parts.map((value) => Math.round(value * 1000) / 1000);
}

function countInventorySlots(text) {
  const slots = new Set();
  for (const match of String(text || '').matchAll(/\bSlot:\s*(\d+)/g)) {
    const slot = Number(match[1]);
    if (slot >= 0 && slot <= 35) slots.add(slot);
  }
  return { occupied: slots.size, free: 36 - slots.size };
}

function parseGiveResponse(text) {
  const raw = String(text || '');
  if (/Gave\s+\d+/i.test(raw)) return { outcome: 'delivered' };
  if (/unknown item|does not exist|not a valid|item not found|couldn't find|no such item/i.test(raw)) {
    return { outcome: 'failed' };
  }
  if (/no player was found|is not online|player not found/i.test(raw)) return { outcome: 'offline' };
  return { outcome: 'unconfirmed' };
}

function tellrawCommand(name, text) {
  if (!playerNameOk(name)) throw new Error('invalid-player-name');
  const payload = JSON.stringify({ text: String(text || '').slice(0, 200), color: 'gold' });
  return `tellraw ${name} ${payload}`;
}

function giveCommand(name, itemId, count) {
  if (!playerNameOk(name)) throw new Error('invalid-player-name');
  if (!itemIdOk(itemId)) throw new Error('invalid-item-id');
  const amount = Number(count);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 64) throw new Error('invalid-item-count');
  return `give ${name} ${itemId} ${amount}`;
}

function dataGetCommand(name, path) {
  if (!playerNameOk(name)) throw new Error('invalid-player-name');
  if (path !== 'Pos' && path !== 'Rotation' && path !== 'Inventory') throw new Error('invalid-data-path');
  return `data get entity ${name} ${path}`;
}

module.exports = {
  PLAYER_NAME,
  ITEM_ID,
  playerNameOk,
  itemIdOk,
  normalizeUuid,
  isPremiumUuid,
  parseListUuids,
  parseDataVector,
  countInventorySlots,
  parseGiveResponse,
  tellrawCommand,
  giveCommand,
  dataGetCommand
};
