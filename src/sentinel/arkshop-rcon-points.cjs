'use strict';

function validatePlayerId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{5,128}$/.test(id)) throw new Error('ArkShop player/EOS ID contains unsupported characters.');
  return id;
}

function validatePointsAmount(value) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > 2_000_000_000) {
    throw new Error('ArkShop points must be a whole number from 0 to 2,000,000,000.');
  }
  return amount;
}

function parsePlayerPointsReply(value) {
  const text = String(value || '').trim();
  const match = text.match(/Player has\s+(-?\d+)\s+points/i);
  if (!match) throw new Error(`ArkShop could not return that player's points: ${text.slice(0, 240) || 'empty RCON reply'}`);
  return Number(match[1]);
}

async function getPlayerPoints(rcon, playerId) {
  if (!rcon || typeof rcon.execute !== 'function') throw new Error('ARK RCON is unavailable.');
  const id = validatePlayerId(playerId);
  const response = await rcon.execute(`GetPlayerPoints ${id}`);
  return { playerId: id, points: parsePlayerPointsReply(response), response: String(response || '').slice(0, 500) };
}

async function mutatePoints(rcon, operation, playerId, amount) {
  if (!['AddPoints', 'SetPoints'].includes(operation)) throw new Error('Unsupported ArkShop point operation.');
  if (!rcon || typeof rcon.execute !== 'function') throw new Error('ARK RCON is unavailable.');
  const id = validatePlayerId(playerId);
  const safeAmount = validatePointsAmount(amount);
  if (operation === 'AddPoints' && safeAmount === 0) throw new Error('AddPoints requires an amount greater than zero.');
  const response = String(await rcon.execute(`${operation} ${id} ${safeAmount}`) || '').trim();
  const success = operation === 'AddPoints' ? /Successfully added points/i.test(response) : /Successfully set points/i.test(response);
  if (!success) throw new Error(`ArkShop ${operation} failed: ${response.slice(0, 240) || 'empty RCON reply'}`);
  const verified = await getPlayerPoints(rcon, id);
  return { operation, playerId: id, amount: safeAmount, points: verified.points, response: response.slice(0, 500) };
}

async function addPlayerPoints(rcon, playerId, amount) {
  return mutatePoints(rcon, 'AddPoints', playerId, amount);
}

async function setPlayerPoints(rcon, playerId, amount) {
  return mutatePoints(rcon, 'SetPoints', playerId, amount);
}

module.exports = {
  validatePlayerId,
  validatePointsAmount,
  parsePlayerPointsReply,
  getPlayerPoints,
  mutatePoints,
  addPlayerPoints,
  setPlayerPoints
};
