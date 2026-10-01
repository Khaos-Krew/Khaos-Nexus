'use strict';

const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const { parseListUuids, playerNameOk, tellrawCommand, isPremiumUuid } = require('./mc-rcon-text.cjs');

async function verifyMojangProfile(uuid, { fetchImpl, name } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'mojang-unavailable' };
  const id = String(uuid || '').replace(/-/g, '');
  let response;
  try {
    response = await fetchFn(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
  } catch {
    return { ok: false, reason: 'mojang-unavailable' };
  }
  if (!response?.ok) return { ok: false, reason: 'mojang-unavailable' };
  const body = await response.json();
  const returned = String(body?.id || '').replace(/-/g, '').toLowerCase();
  if (!returned || returned !== id.toLowerCase()) return { ok: false, reason: 'mojang-mismatch' };
  if (name && String(body?.name || '').toLowerCase() !== String(name).toLowerCase()) return { ok: false, reason: 'mojang-mismatch' };
  return { ok: true, name: body.name, uuid };
}

async function beginMinecraftLink({ username, discordUserId, requesterName, rcon, points, fetchImpl, env = process.env } = {}) {
  if (!mcPointsFlags(env).pointsEnabled) return { ok: false, reason: 'mc-points-disabled' };
  if (!playerNameOk(username)) return { ok: false, reason: 'invalid-player-name' };
  let listed;
  try {
    listed = parseListUuids(await rcon('list uuids'));
  } catch {
    return { ok: false, reason: 'rcon-failed' };
  }
  if (!listed.ok) return { ok: false, reason: 'rcon-unparseable' };
  const player = listed.players.find((entry) => entry.name.toLowerCase() === String(username).toLowerCase());
  if (!player) return { ok: false, reason: 'player-offline' };
  if (!isPremiumUuid(player.uuid)) return { ok: false, reason: 'uuid-not-premium' };
  const profile = await verifyMojangProfile(player.uuid, { fetchImpl, name: player.name });
  if (!profile.ok) return profile;
  const who = String(requesterName || discordUserId || 'someone').slice(0, 32);
  const challenge = await points.challenge({ discordUserId, mcUuid: player.uuid, mcName: player.name, requesterName: who });
  if (!challenge.ok) return challenge;
  try {
    await rcon(tellrawCommand(player.uuid, `${who} asked to link this account. Code: ${challenge.code}. never share this code. Expires in 10 minutes.`));
  } catch {
    return { ok: false, reason: 'whisper-failed' };
  }
  return { ok: true, mcName: player.name, expiresInSec: challenge.expiresInSec };
}

module.exports = { verifyMojangProfile, beginMinecraftLink };
