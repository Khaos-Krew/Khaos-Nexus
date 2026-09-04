'use strict';

const { deterministicRng, rollCache } = require('./ark-dino-cache-engine.cjs');

function cleanEosId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(id)) throw new Error('A valid EOS player id is required for dino-cache delivery.');
  return id;
}

function parsePointsResponse(value) {
  const matches = String(value ?? '').trim().match(/-?\d+/g) || [];
  if (!matches.length) throw new Error('ArkShop did not return a readable points balance.');
  const amount = Number(matches.at(-1));
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('ArkShop returned an invalid points balance.');
  return amount;
}

function buildDinoDepotCommand({ eosId, blueprint, level, sex = '' } = {}) {
  const player = cleanEosId(eosId);
  const dino = String(blueprint || '').trim();
  const lvl = Number(level);
  const normalizedSex = String(sex || '').trim().toLowerCase();
  if (!/^\/(?:Game|SDinoVariants)\/[A-Za-z0-9_./-]{8,220}$/.test(dino)) throw new Error('Dino Depot blueprint path is invalid.');
  if (!Number.isInteger(lvl) || lvl < 200 || lvl > 300) throw new Error('Dino Depot cache level must be an integer from 200 to 300.');
  if (normalizedSex && !['male', 'female'].includes(normalizedSex)) throw new Error('Dino Depot cache sex must be male or female.');
  const femaleFlag = normalizedSex ? ` -f=${normalizedSex === 'female' ? 1 : 0}` : '';
  const command = `scriptcommand SpawnDinoInBall -t=${dino} -p=${player} -l=${lvl} -i=0 -a=1 -c=1${femaleFlag}`;
  if (command.length > 320) throw new Error('Dino Depot command exceeds the safe RCON command length.');
  return command;
}

function assertDeliverableRoll(roll) {
  if (!roll || !['normal', 'x', 's'].includes(roll.variant) || roll.variantFallback || roll.shiny === true) throw new Error('Dino cache roll is not deliverable.');
  if (roll.variant === 'x' && !String(roll.blueprint || '').startsWith('/Game/Genesis/Dinos/BiomeVariants/')) throw new Error('X outcome lacks a verified X blueprint.');
  if (roll.variant === 's' && !String(roll.blueprint || '').startsWith('/SDinoVariants/')) throw new Error('S outcome lacks a verified S blueprint.');
  return true;
}

function classifyDeliveryResponse(value) {
  const response = String(value ?? '').trim();
  if (!response) return { outcome: 'AMBIGUOUS', reason: 'Dino Depot returned no delivery acknowledgement.' };
  if (/(unknown command|not found|invalid|failed|error|no player)/i.test(response)) return { outcome: 'FAILED', reason: response.slice(0, 500) };
  if (/server received\.\s*but no response/i.test(response)) return { outcome: 'AMBIGUOUS', reason: response.slice(0, 500) };
  return { outcome: 'DELIVERED' };
}

class DinoCacheRedemptionProcessor {
  constructor({ store, rconForServer, rngSecret = process.env.NEXUS_DINO_CACHE_RNG_SECRET } = {}) {
    if (!store || typeof store.ingestPurchase !== 'function') throw new Error('Dino Cache processor requires a transaction store.');
    if (typeof rconForServer !== 'function') throw new Error('Dino Cache processor requires a Sentinel-owned RCON resolver.');
    this.store = store; this.rconForServer = rconForServer; this.rngSecret = rngSecret;
  }

  async acceptVerifiedPurchase(purchase) {
    const ingested = await this.store.ingestPurchase(purchase);
    let row = ingested.row;
    if (row.state === 'PENDING') {
      const identity = `${row.source_system}:${row.source_server_id}:${row.source_transaction_id}`;
      const roll = rollCache(row.cache_type, deterministicRng(this.rngSecret, identity));
      if (roll.price !== Number(row.nexus_point_cost)) {
        return this.store.markFailed(row.id, 'PRICE_MISMATCH', 'Verified ArkShop purchase price does not match the centrally configured cache price.');
      }
      assertDeliverableRoll(roll);
      row = await this.store.persistRoll(row.id, roll);
    }
    return row;
  }

  async deliver(row) {
    if (!row || !['ROLLED', 'RETRY'].includes(row.state)) return row;
    const claimed = await this.store.claimDelivery(row.id);
    if (claimed.state !== 'DELIVERING') return claimed;
    const command = buildDinoDepotCommand({ eosId: claimed.player_eos_id, blueprint: claimed.blueprint, level: Number(claimed.rolled_level), sex: claimed.sex });
    let response;
    try { response = await this.rconForServer(claimed.server_id).execute(command); }
    catch (error) { return this.store.markFailed(claimed.id, 'AMBIGUOUS', `RCON delivery acknowledgement was lost: ${String(error?.message || error).slice(0, 400)}`); }
    const result = classifyDeliveryResponse(response);
    return result.outcome === 'DELIVERED'
      ? this.store.markDelivered(claimed.id)
      : this.store.markFailed(claimed.id, result.outcome === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'REJECTED', result.reason);
  }
}

module.exports = { cleanEosId, parsePointsResponse, buildDinoDepotCommand, assertDeliverableRoll, classifyDeliveryResponse, DinoCacheRedemptionProcessor };
