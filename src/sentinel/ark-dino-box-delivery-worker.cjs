'use strict';

const { connectMysql } = require('./arkshop-mysql.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { ORDER_TABLE, EVENT_TABLE, ensureSchema } = require('./ark-cache-shop-service.cjs');
const { buildDinoDepotCommand } = require('./ark-dino-cache-purchase.cjs');

const INSTALLED = Symbol.for('khaos.nexus.dino.box.delivery.worker');
let timer = null;
let running = false;

function deliveryPrefix(env = process.env) {
  return String(env.NEXUS_DINO_CACHE_DELIVERY_PREFIX || 'ARK_MAP2').trim().toUpperCase();
}

async function ensureDeliveryState(connection) {
  const [columns] = await connection.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='state' LIMIT 1`,
    [ORDER_TABLE]
  );
  const type = String(columns[0]?.COLUMN_TYPE || '');
  if (type && !type.includes("'SENT_UNCONFIRMED'")) {
    await connection.query(
      `ALTER TABLE ${ORDER_TABLE} MODIFY COLUMN state ENUM('SEALED','AWAITING_DELIVERY','DELIVERING','SENT_UNCONFIRMED','DELIVERED','DELIVERY_FAILED') NOT NULL DEFAULT 'SEALED'`
    );
  }
}

function classifyRconResult(result) {
  const response = String(result?.response || '').trim();
  if (/(unknown command|not found|invalid|failed|error|no player)/i.test(response)) {
    return { state: 'DELIVERY_FAILED', failureClass: 'REJECTED', details: response.slice(0, 480) };
  }
  if (result?.status === 'sent_no_reply' || result?.status === 'sent_blank_reply' || /server received\.\s*but no response/i.test(response)) {
    return { state: 'SENT_UNCONFIRMED', failureClass: 'UNCONFIRMED', details: response || result?.status || 'RCON command sent without a definitive delivery acknowledgement.' };
  }
  return { state: 'DELIVERED', failureClass: '', details: response || 'RCON command acknowledged.' };
}

async function claimOne(connection) {
  await connection.beginTransaction();
  try {
    const [rows] = await connection.query(
      `SELECT * FROM ${ORDER_TABLE} WHERE state='AWAITING_DELIVERY' ORDER BY revealed_at ASC, created_at ASC LIMIT 1 FOR UPDATE`
    );
    const row = rows[0];
    if (!row) {
      await connection.commit();
      return null;
    }
    const prefix = deliveryPrefix();
    await connection.execute(
      `UPDATE ${ORDER_TABLE} SET state='DELIVERING', delivery_server_id=?, delivery_map_name=?, delivery_attempts=delivery_attempts+1, failure_class='', error_message='' WHERE id=? AND state='AWAITING_DELIVERY'`,
      [prefix.toLowerCase(), prefix === 'ARK_MAP2' ? (process.env.ARK_MAP2_NAME || 'Astraeos') : (process.env[`${prefix}_NAME`] || prefix), row.id]
    );
    await connection.execute(
      `INSERT INTO ${EVENT_TABLE} (order_id, event_type, details) VALUES (?, 'DELIVERY_STARTED', ?)`,
      [row.id, `Sentinal claimed revealed Dino Cache for ${prefix} RCON delivery.`]
    );
    await connection.commit();
    return { ...row, deliveryPrefix: prefix };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

async function finishDelivery(connection, row, outcome) {
  const deliveredAtSql = outcome.state === 'DELIVERED' ? ', delivered_at=CURRENT_TIMESTAMP(3)' : '';
  await connection.execute(
    `UPDATE ${ORDER_TABLE} SET state=?, failure_class=?, error_message=?${deliveredAtSql} WHERE id=? AND state='DELIVERING'`,
    [outcome.state, outcome.failureClass || '', String(outcome.details || '').slice(0, 500), row.id]
  );
  await connection.execute(
    `INSERT INTO ${EVENT_TABLE} (order_id, event_type, details) VALUES (?, ?, ?)`,
    [row.id, outcome.state, String(outcome.details || '').slice(0, 500)]
  );
}

async function deliverOne({ connector = connectMysql } = {}) {
  const { connection } = await connector();
  try {
    await ensureSchema(connection);
    await ensureDeliveryState(connection);
    const row = await claimOne(connection);
    if (!row) return { skipped: 'none-awaiting' };

    const server = arkServerFromEnv(row.deliveryPrefix);
    if (!server.enabled || !server.host || !server.port || !server.password) {
      const outcome = { state: 'DELIVERY_FAILED', failureClass: 'RCON_CONFIG', details: `${row.deliveryPrefix} RCON configuration is incomplete or disabled.` };
      await finishDelivery(connection, row, outcome);
      return { orderId: row.id, ...outcome };
    }

    const command = buildDinoDepotCommand({
      eosId: row.player_eos_id,
      blueprint: row.blueprint,
      level: Number(row.rolled_level),
      sex: row.sex
    });
    let result;
    try {
      result = await new ArkRconClient(server).executeDetailed(command);
    } catch (error) {
      const outcome = { state: 'SENT_UNCONFIRMED', failureClass: 'RCON_AMBIGUOUS', details: `RCON result was ambiguous after delivery claim: ${String(error?.message || error).slice(0, 400)}` };
      await finishDelivery(connection, row, outcome);
      return { orderId: row.id, command, ...outcome };
    }

    const outcome = classifyRconResult(result);
    await finishDelivery(connection, row, outcome);
    console.log('[dino-cache-delivery]', JSON.stringify({ orderId: row.id, publicCacheId: row.public_cache_id, server: row.deliveryPrefix, rconStatus: result.status, state: outcome.state }));
    return { orderId: row.id, publicCacheId: row.public_cache_id, command, rconStatus: result.status, ...outcome };
  } finally {
    await connection.end().catch(() => {});
  }
}

async function runCycle() {
  if (running) return { skipped: 'busy' };
  running = true;
  try {
    const results = [];
    for (let index = 0; index < 10; index += 1) {
      const result = await deliverOne();
      results.push(result);
      if (result?.skipped === 'none-awaiting') break;
    }
    return results;
  } finally {
    running = false;
  }
}

function installArkDinoBoxDeliveryWorker() {
  if (globalThis[INSTALLED]) return false;
  globalThis[INSTALLED] = true;
  const interval = Math.max(5000, Math.min(60000, Number(process.env.NEXUS_DINO_CACHE_DELIVERY_POLL_MS || 10000)));
  setTimeout(() => runCycle().catch((error) => console.error('[dino-cache-delivery] startup cycle failed:', String(error?.message || error).slice(0, 500))), 2000).unref?.();
  timer = setInterval(() => runCycle().catch((error) => console.error('[dino-cache-delivery] cycle failed:', String(error?.message || error).slice(0, 500))), interval);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Dino Cache delivery worker enabled (${deliveryPrefix()}, ${interval}ms).`);
  return true;
}

module.exports = { deliveryPrefix, ensureDeliveryState, classifyRconResult, claimOne, finishDelivery, deliverOne, runCycle, installArkDinoBoxDeliveryWorker };
