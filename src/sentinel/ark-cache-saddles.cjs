'use strict';
const crypto = require('node:crypto');
// Explicit equipment catalog: null means no saddle, never an inferred default.
const NO_SADDLE = new Set(['Moschops','Gigantopithecus','Angler','Onyc','Pyromane','Cosmo','Oasisaur','Armadoggo']);
const SADDLE_SPECIES = new Set(['Parasaur','Carbonemys','Trike','Pteranodon','Ichthyosaurus','Raptor','Carnotaurus','Dire Bear','Therizinosaur','Thylacoleo','Sarco','Beelzebufo','Kaprosuchus','Baryonyx','Ankylosaurus','Doedicurus','Sabertooth','Argentavis','Allosaurus','Rex','Yutyrannus','Megalodon','Dunkleosteus','Basilosaurus','Plesiosaur','Mosasaurus','Araneo','Arthropluera','Megalosaurus','Giganotosaurus','Carcharodontosaurus','Rhyniognatha','Dreadmare','Burrowbuck']);
const TIERS = Object.freeze(['RAMSHACKLE','APPRENTICE','JOURNEYMAN','MASTERCRAFT']);
function saddleReward(species, secret, identity) {
  if (NO_SADDLE.has(species)) return null;
  if (!SADDLE_SPECIES.has(species)) throw new Error('SADDLE_SPECIES_NOT_REVIEWED');
  if (String(secret || '').length < 32) throw new Error('Saddle RNG secret is required');
  const roll = crypto.createHmac('sha256', secret).update(`saddle:${identity}`).digest().readUInt32BE(0) / 0x100000000;
  return Object.freeze({species, quality:roll < .05 ? 'MASTERCRAFT' : roll < .25 ? 'JOURNEYMAN' : roll < .65 ? 'APPRENTICE' : 'RAMSHACKLE', quantity:1});
}
function parseSaddle(value) {
  const reward = typeof value === 'string' ? JSON.parse(value) : value;
  if (!reward) return null;
  if (!SADDLE_SPECIES.has(reward.species) || !TIERS.includes(reward.quality) || reward.quantity !== 1) throw new Error('INVALID_SADDLE_REWARD');
  return reward;
}
// The native item adapter must resolve canonical species to matching equipment,
// enforce armor caps, and persist idempotency before an EOS-targeted grant.
async function submitSaddle(row, { fetchImpl = fetch, env = process.env } = {}) {
  const reward = parseSaddle(row.saddle_reward);
  if (!reward) return {state:'NOT_REQUIRED'};
  const endpoint = env.NEXUS_CACHE_SADDLE_ENDPOINT;
  const secret = env.NEXUS_CACHE_SADDLE_SECRET;
  if (!endpoint || !secret || secret.length < 32) throw new Error('SADDLE_ADAPTER_NOT_CONFIGURED');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:') throw new Error('SADDLE_ADAPTER_REQUIRES_HTTPS');
  const idempotencyKey = `cache-saddle:${row.id}`;
  const response = await fetchImpl(url, {method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'content-type':'application/json',authorization:`Bearer ${secret}`},
    body:JSON.stringify({idempotencyKey, playerId:row.player_eos_id, serverId:row.delivery_server_id, reward})});
  if (!response.ok) throw new Error('SADDLE_ADAPTER_REJECTED');
  const result = await response.json();
  if (result.idempotencyKey !== idempotencyKey || result.state !== 'DELIVERED') throw new Error('SADDLE_DELIVERY_UNCONFIRMED');
  return {state:'DELIVERED'};
}
module.exports = {NO_SADDLE,SADDLE_SPECIES,TIERS,saddleReward,parseSaddle,submitSaddle};
