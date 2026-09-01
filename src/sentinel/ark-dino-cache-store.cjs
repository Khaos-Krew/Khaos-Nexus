'use strict';

const crypto = require('node:crypto');

const STATES = Object.freeze(['PURCHASED', 'SEALED', 'REVEALED', 'DELIVERING', 'DELIVERED', 'FAILED', 'RETRY']);
const TRANSITIONS = Object.freeze({
  PURCHASED: ['SEALED', 'FAILED'],
  SEALED: ['REVEALED', 'FAILED'],
  REVEALED: ['DELIVERING', 'FAILED'],
  DELIVERING: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: ['RETRY'],
  RETRY: ['DELIVERING', 'FAILED']
});

function text(value, max) { return String(value || '').replace(/[\r\n\0]+/g, ' ').trim().slice(0, max); }
function sourceKey(purchase) { return `${text(purchase.sourceSystem, 32)}:${text(purchase.sourceServerId, 100)}:${text(purchase.sourceTransactionId, 128)}`; }
function eosSet(values = []) { return new Set((Array.isArray(values) ? values : [values]).map((value) => text(value, 96)).filter(Boolean)); }

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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PURCHASED') ON DUPLICATE KEY UPDATE id=id`,
      [record.id, record.sourceSystem, record.sourceServerId, record.sourceTransactionId, record.sourceItemName, record.playerEosId, record.playerAccountId, record.serverId, record.mapName, record.cacheType, record.pointCost]);
    const row = await this.bySource(record.sourceSystem, record.sourceServerId, record.sourceTransactionId);
    if (row?.id === record.id) await this.event(record.id, null, 'PURCHASED', 'verified shop purchase ingested');
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
    return this.transition(id, ['PURCHASED'], 'SEALED', async () => {
      if (!['normal', 'x', 's'].includes(roll?.variant) || roll?.shiny === true || !Number.isInteger(roll?.level) || roll.level < 200 || roll.level > 300) throw new Error('Refusing to persist an invalid Dino Cache roll.');
      if (!text(roll.species, 100) || !text(roll.blueprint, 255)) throw new Error('Refusing to seal an incomplete Dino Cache roll.');
      await this.db.execute(`UPDATE nexus_dino_cache_transactions SET species=?, variant=?, blueprint=?, rolled_level=?, rolled_at=CURRENT_TIMESTAMP(3), state='SEALED', failure_class='', error_message='' WHERE id=? AND state='PURCHASED'`, [text(roll.species, 100), roll.variant, text(roll.blueprint, 255), roll.level, id]);
    }, 'fixed reward rolled and sealed before reveal');
  }

  async sealedForPlayers(playerEosIds, limit = 25) {
    const ids = [...eosSet(playerEosIds)];
    if (!ids.length) return [];
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await this.db.query(`SELECT id, source_item_name, server_id, map_name, cache_type, nexus_point_cost, state, created_at FROM nexus_dino_cache_transactions WHERE player_eos_id IN (${placeholders}) AND state='SEALED' ORDER BY created_at ASC LIMIT ${safeLimit}`, ids);
    return rows;
  }

  async revealOwned(id, playerEosIds) {
    const owners = eosSet(playerEosIds);
    if (!owners.size) throw new Error('A linked ARK account is required to reveal this cache.');
    return this.transition(id, ['SEALED'], 'REVEALED', async (row) => {
      if (!owners.has(text(row.player_eos_id, 96))) throw new Error('This sealed cache belongs to a different linked ARK account.');
      await this.db.execute(`UPDATE nexus_dino_cache_transactions SET state='REVEALED', revealed_at=CURRENT_TIMESTAMP(3), failure_class='', error_message='' WHERE id=? AND state='SEALED'`, [id]);
    }, 'reward revealed by linked Discord owner');
  }

  async markAnnounced(id) {
    const row = await this.byId(id);
    if (!row || !['REVEALED', 'DELIVERING', 'DELIVERED'].includes(row.state) || row.announced_at) return row;
    await this.db.execute('UPDATE nexus_dino_cache_transactions SET announced_at=CURRENT_TIMESTAMP(3) WHERE id=? AND announced_at IS NULL', [id]);
    return this.byId(id);
  }

  async claimDelivery(id) {
    return this.transition(id, ['REVEALED', 'RETRY'], 'DELIVERING', async (row) => {
      await this.db.execute(`UPDATE nexus_dino_cache_transactions SET state='DELIVERING', delivery_attempts=delivery_attempts+1, delivery_started_at=CURRENT_TIMESTAMP(3), failure_class='', error_message='' WHERE id=? AND state=?`, [id, row.state]);
    }, 'revealed reward claimed for delivery');
  }

  async markDelivered(id) {
    return this.transition(id, ['DELIVERING'], 'DELIVERED', async () => {
      await this.db.execute(`UPDATE nexus_dino_cache_transactions SET state='DELIVERED', delivered_at=CURRENT_TIMESTAMP(3), failure_class='', error_message='' WHERE id=? AND state='DELIVERING'`, [id]);
    }, 'Dino Ball delivery acknowledged');
  }

  async markFailed(id, failureClass, reason) {
    const row = await this.byId(id);
    if (!row || !['PURCHASED', 'SEALED', 'REVEALED', 'DELIVERING', 'RETRY'].includes(row.state)) return row;
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
    const [rows] = await this.db.query(`SELECT * FROM nexus_dino_cache_transactions WHERE state IN ('REVEALED','RETRY') ORDER BY COALESCE(revealed_at, created_at) ASC LIMIT ${safeLimit}`);
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
