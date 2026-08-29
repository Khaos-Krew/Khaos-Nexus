'use strict';

const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { rollCache, DinoCacheJournal } = require('./ark-dino-cache-engine.cjs');

function cleanEosId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(id)) throw new Error('A valid EOS player id is required for dino-cache delivery.');
  return id;
}

function parsePointsResponse(value) {
  const text = String(value ?? '').trim();
  const matches = text.match(/-?\d+/g) || [];
  if (!matches.length) throw new Error('ArkShop did not return a readable points balance.');
  const amount = Number(matches.at(-1));
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('ArkShop returned an invalid points balance.');
  return amount;
}

function buildDinoDepotCommand({ eosId, blueprint, level } = {}) {
  const player = cleanEosId(eosId);
  const dino = String(blueprint || '').trim();
  const lvl = Number(level);
  if (!/^\/Game\/[A-Za-z0-9_./-]{8,220}$/.test(dino)) throw new Error('Dino Depot blueprint path is invalid.');
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > 300) throw new Error('Dino Depot level must be an integer from 1 to 300.');
  const command = `ScriptCommand SpawnDinoInBall -p=${player} -t=${dino} -l=${lvl} -i=1 -a=1`;
  if (command.length > 290) throw new Error('Dino Depot command exceeds its documented command-builder size limit.');
  return command;
}

function assertDeliverableRoll(roll) {
  if (!roll || typeof roll !== 'object') throw new Error('Dino cache roll is missing.');
  if (roll.variant !== 'normal') throw new Error(`Dino cache variant '${roll.variant}' has no verified delivery adapter yet.`);
  if (roll.shiny === true) throw new Error('Shiny dino-cache outcome has no verified targeted delivery adapter yet.');
  return true;
}

class ArkDinoCachePurchaseService {
  constructor({ prefix = 'ARK_GEN1', rcon, journal, rng } = {}) {
    this.prefix = prefix;
    this.rng = rng;
    this.journal = journal || new DinoCacheJournal();
    if (rcon) this.rcon = rcon;
    else {
      const connection = arkServerFromEnv(prefix);
      this.rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
    }
  }

  async points(eosId) {
    const player = cleanEosId(eosId);
    return parsePointsResponse(await this.rcon.execute(`GetPlayerPoints ${player}`));
  }

  async changePoints(eosId, amount) {
    const player = cleanEosId(eosId);
    const delta = Number(amount);
    if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000) throw new Error('Dino cache point delta is invalid.');
    return this.rcon.execute(`ChangePoints ${player} ${delta}`);
  }

  async purchase({ eosId, cacheId } = {}) {
    const player = cleanEosId(eosId);
    const roll = rollCache(cacheId, this.rng);
    assertDeliverableRoll(roll); // Must happen before any charge.

    const balance = await this.points(player);
    if (balance < roll.price) {
      return { ok: false, reason: 'insufficient-points', balance, price: roll.price, cacheId: roll.cacheId };
    }

    const tx = this.journal.create({ eosId: player, cacheId: roll.cacheId, price: roll.price, roll });
    await this.changePoints(player, -roll.price);
    this.journal.transition(tx.id, 'charged');

    try {
      const command = buildDinoDepotCommand({ eosId: player, blueprint: roll.blueprint, level: roll.level });
      const deliveryResponse = await this.rcon.execute(command);
      const delivered = this.journal.transition(tx.id, 'delivered');
      return { ok: true, transactionId: delivered.id, roll, deliveryResponse: String(deliveryResponse || '').slice(0, 300) };
    } catch (error) {
      this.journal.transition(tx.id, 'refund_pending', error?.message || error);
      try {
        await this.changePoints(player, roll.price);
        this.journal.transition(tx.id, 'refunded', error?.message || error);
      } catch (refundError) {
        const wrapped = new Error(`Dino cache delivery failed and automatic refund is still pending: ${String(refundError?.message || refundError).slice(0, 200)}`);
        wrapped.cause = error;
        throw wrapped;
      }
      const wrapped = new Error(`Dino cache delivery failed; ${roll.price} points were refunded.`);
      wrapped.cause = error;
      throw wrapped;
    }
  }
}

module.exports = {
  cleanEosId, parsePointsResponse, buildDinoDepotCommand, assertDeliverableRoll, ArkDinoCachePurchaseService
};
