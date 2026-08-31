'use strict';

const crypto = require('node:crypto');
const STATES = Object.freeze(['PENDING', 'ROLLED', 'DELIVERING', 'DELIVERED', 'FAILED', 'RETRY']);
const TRANSITIONS = Object.freeze({ PENDING: ['ROLLED', 'FAILED'], ROLLED: ['DELIVERING', 'FAILED'], DELIVERING: ['DELIVERED', 'FAILED'], DELIVERED: [], FAILED: ['RETRY'], RETRY: ['DELIVERING', 'FAILED'] });

function text(value, max) { return String(value || '').replace(/[\r\n\0]+/g, ' ').trim().slice(0, max); }
function sourceKey(purchase) { return `${text(purchase.sourceSystem, 32)}:${text(purchase.sourceServerId, 100)}:${text(purchase.sourceTransactionId, 128)}`; }

class DinoCacheStore {
  constructor(connection) {
    if (!connection?.execute || !connection?.beginTransaction) throw new Error('DinoCacheStore requires a mysql2 promise connection.');
    this.db = connection;
  }

  async ingestPurchase(purchase) {
    const record = {
      id: crypto.randomUUID(), sourceSystem: text(purchase.sourceSystem, 32), sourceServerId: text(purchase.sourceServerId, 100), sourceTransactionId: text(purchase.sourceTransactionId, 128),
      sourceItemName: text(purchase.sourceItemName, 255), playerEosId: text(purchase.playerEosId, 96), playerAccountId: text(purchase.playerAccountId, 128),
      serverId: text(purchase.serverId, 64), mapName: text(purchase.mapName, 100), cacheType: text(purchase.cacheType, 64), pointCost: Number(purchase.pointCost)
    };
    if (!record.sourceSystem || !record.sourceServerId || !record.sourceTransactionId || !record.sourceItemName || !record.playerEosId || !record.serverId || !record.cacheType || !Number.isSafeInteger(record.pointCost) || record.pointCost <= 0) throw new Error('Dino Cache purchase receipt is incomplete.');
    await this.db.execute(`INSERT INTO nexus_dino_cache_transactions
      (id, source_system, source_server_id, source_transaction_id, source_item_name, player_eos_id, player_account_id, server_id, map_name, cache_type, nexus_point_cost, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING') ON DUPLICATE KEY UPDATE id=id`,
      [record.id, record.sourceSystem, record.sourceServerId, record.sourceTransactionId, record.sourceItemName, record.playerEosId, record.playerAccountId, record.serverId, record.mapName, record.cacheType, record.pointCost]);
    const row = await this.bySource(record.sourceSystem, record.sourceServerId, record.sourceTransactionId);
    if (row?.id === record.id) await this.event(record.id, null, 'PENDING', 'verified ArkShop purchase ingested');
    return { row, inserted: row?.id === record.id, sourceKey: sourceKey(purchase) };
  }

  async bySource(system, server, transactionId) {
    const [rows] = await this.db.execute('SELECT * FROM nexus_dino_cache_transactions WHERE source_system=? AND source_server_id=? AND source_transaction_id=? LIMIT 1', [system, server, transactionId]);
    return rows[0] || null;
  }

  async byId(id, lock = false) {
    const [rows] = await this.db.execute(`SELECT * FROM nexus_dino_cache_transactions WHERE id=? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [id]);
    return rows[0] || null;
  }

  async event(id, from, to, reason = '') {
    await this.db.execute('INSERT INTO nexus_dino_cache_events (transaction_id, from_state, to_state, reason) VALUES (?, ?, ?, ?)', [id, from, to, text(reason, 500)]);
  }

  async persistRoll(id, roll) {
    return this.transition(id, ['PENDING'], 'ROLLED', async () => {
      if (!['normal', 'x', 's'].includes(roll?.variant) || roll?.shiny === true || !Number.isInteger(roll?.level) || roll.level < 200 || roll.level > 300) throw new Error('Refusing to persist an invalid Dino Cache roll.');
      await this.db.execute(`UPDATE nexus_dino_cache_transactions SET species=?, variant=?, blueprint=?, rolled_level=?, rolled_at=CURRENT_TIMESTAMP(3), state='ROLLED', failure_class='', error_message='' WHERE id=? AND state='PENDING'`, [text(roll.species, 100), roll.variant, text(roll.blueprint, 255), roll.level, id]);
    }, 'roll persisted before delivery');
  }

  async claimDelivery(id) {
    return this.transition(id, ['ROLLED', 'RETRY'], 'DELIVERING', async (row) => {
      await this.db.execute(`UPDATE nexus_dino_cache_transactions SET state='DELIVERING', delivery_attempts=delivery_attempts+1, delivery_started_at=CURRENT_TIMESTAMP(3), failure_class='', error_message='' WHERE id=? AND state=?`, [id, row.state]);
    }, 'delivery claimed');
  }

  async markDelivered(id) {
    return this.transition(id, ['DELIVERING'], 'DELIVERED', async () => {
      await this.db.execute(`UPDATE nexus_dino_cache_transactions SET state='DELIVERED', delivered_at=CURRENT_TIMESTAMP(3), failure_class='', error_message='' WHERE id=? AND state='DELIVERING'`, [id]);
    }, 'Dino Ball delivery acknowledged');
  }

  async markFailed(id, failureClass, reason) {
    const row = await this.byId(id);
    if (!row || !['PENDING', 'ROLLED', 'DELIVERING', 'RETRY'].includes(row.state)) return row;
    return this.transition(id, [row.state], 'FAILED', async () => {
      await this.db.execute('UPDATE nexus_dino_cache_transactions SET state=\'FAILED\', failure_class=?, error_message=? WHERE id=? AND state=?', [text(failureClass, 32), text(reason, 500), id, row.state]);
    }, reason);
  }

  async approveRetry(id, reason) {
    if (!text(reason, 500)) throw new Error('A manual inventory-verification reason is required before retry.');
    return this.transition(id, ['FAILED'], 'RETRY', async () => {
      await this.db.execute(`UPDATE nexus_dino_cache_transactions SET state='RETRY', error_message=? WHERE id=? AND state='FAILED'`, [text(reason, 500), id]);
    }, reason);
  }

  async actionable(limit = 25) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
    const [rows] = await this.db.query(`SELECT * FROM nexus_dino_cache_transactions WHERE state IN ('ROLLED','RETRY') ORDER BY created_at ASC LIMIT ${safeLimit}`);
    return rows;
  }

  async failStaleDeliveries(minutes = 10) {
    const safeMinutes = Math.max(1, Math.min(1440, Number(minutes) || 10));
    const [rows] = await this.db.query(`SELECT id FROM nexus_dino_cache_transactions WHERE state='DELIVERING' AND delivery_started_at < (CURRENT_TIMESTAMP(3) - INTERVAL ${safeMinutes} MINUTE)`);
    for (const row of rows) await this.markFailed(row.id, 'AMBIGUOUS', 'Sentinel restarted or lost delivery acknowledgement; inventory verification required before manual retry.');
    return rows.length;
  }

  async transition(id, allowed, next, action, reason) {
    if (!STATES.includes(next)) throw new Error(`Unknown Dino Cache state '${next}'.`);
    await this.db.beginTransaction();
    try {
      const row = await this.byId(id, true);
      if (!row) throw new Error('Unknown Dino Cache transaction.');
      if (!allowed.includes(row.state) || !TRANSITIONS[row.state].includes(next)) { await this.db.rollback(); return row; }
      await action(row);
      await this.event(id, row.state, next, reason);
      await this.db.commit();
      return this.byId(id);
    } catch (error) { await this.db.rollback().catch(() => {}); throw error; }
  }
}

module.exports = { STATES, TRANSITIONS, sourceKey, DinoCacheStore };
