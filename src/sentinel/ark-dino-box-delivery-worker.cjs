'use strict';

const { submitSaddle } = require('./ark-cache-saddles.cjs');
const { connectMysql } = require('./arkshop-mysql.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ORDER_TABLE, EVENT_TABLE, ensureSchema } = require('./ark-cache-shop-service.cjs');

const INSTALLED = Symbol.for('khaos.nexus.dino.box.delivery.worker');
let timer = null;
let running = false;

function deliveryPrefixes(env = process.env) {
  const configured = String(env.NEXUS_DINO_CACHE_DELIVERY_PREFIXES || 'ARK_GEN1,ARK_MAP2')
    .split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  return [...new Set(configured)].filter((value) => /^ARK_[A-Z0-9_]+$/.test(value));
}

function eligibleDeliveryPrefixes(env = process.env, registry = new ArkClusterRegistry()) {
  let records = [];
  try { records = registry?.list?.({ includeDisabled: true }) || []; }
  catch (error) {
    console.warn('[dino-cache-delivery] ARK registry unavailable; preserving environment routing:', String(error?.message || error).slice(0, 180));
  }
  const byPrefix = new Map(records.map((record) => [String(record?.envPrefix || '').trim().toUpperCase(), record]));
  return deliveryPrefixes(env).filter((prefix) => {
    const record = byPrefix.get(prefix);
    if (!record) return true;
    return record.enabled !== false && record.connections?.rcon !== false;
  });
}

function buildDiscordCacheDinoCommand({ eosId, blueprint, level, sex = '' } = {}) {
  const player = String(eosId || '').trim();
  const dino = String(blueprint || '').trim();
  const lvl = Number(level);
  const normalizedSex = String(sex || '').trim().toLowerCase();
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(player)) throw new Error('A valid EOS player id is required for Dino Cache delivery.');
  if (!/^\/(?:Game|SDinoVariants)\/[A-Za-z0-9_./-]{8,220}$/.test(dino)) throw new Error('Dino Depot blueprint path is invalid.');
  if (!Number.isInteger(lvl) || lvl < 200 || lvl > 300) throw new Error('Dino Depot cache level must be 200-300.');
  const femaleFlag = normalizedSex === 'female' ? ' -f=1' : normalizedSex === 'male' ? ' -f=0' : '';
  return `scriptcommand SpawnDinoInBall -t=${dino} -p=${player} -l=${lvl} -i=0 -a=1 -c=1${femaleFlag}`;
}

async function ensureDeliveryState(connection) {
  const [columns] = await connection.query(`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME='state' LIMIT 1`, [ORDER_TABLE]);
  const type = String(columns[0]?.COLUMN_TYPE || '');
  if (type && !type.includes("'SENT_UNCONFIRMED'")) {
    await connection.query(`ALTER TABLE ${ORDER_TABLE} MODIFY COLUMN state ENUM('SEALED','AWAITING_DELIVERY','DELIVERING','SENT_UNCONFIRMED','DELIVERED','DELIVERY_FAILED') NOT NULL DEFAULT 'SEALED'`);
  }
}

function classifyRconResult(result) {
  const response = String(result?.response || '').trim();
  if (/(unknown command|not found|invalid|failed|error|no player)/i.test(response)) return { state: 'DELIVERY_FAILED', failureClass: 'REJECTED', details: response.slice(0, 480) };
  if (result?.status === 'sent_no_reply' || result?.status === 'sent_blank_reply' || /server received\.\s*but no response/i.test(response)) {
    return { state: 'SENT_UNCONFIRMED', failureClass: 'UNCONFIRMED', details: response || result?.status || 'RCON command sent without definitive delivery acknowledgement.' };
  }
  return { state: 'DELIVERED', failureClass: '', details: response || 'RCON command acknowledged.' };
}

async function findOnlineServer(eosId, env = process.env, { registry = new ArkClusterRegistry(), clientFactory = (server) => new ArkRconClient(server) } = {}) {
  const matches = [];
  for (const prefix of eligibleDeliveryPrefixes(env, registry)) {
    const server = arkServerFromEnv(prefix, env);
    if (!server.enabled || !server.host || !server.port || !server.password) continue;
    try {
      const result = await clientFactory(server, prefix).executeDetailed('ListPlayers');
      const response = String(result?.response || '');
      if (response.includes(String(eosId))) matches.push({ prefix, server, response });
    } catch (error) {
      console.warn('[dino-cache-delivery] ListPlayers probe failed', prefix, String(error?.message || error).slice(0, 180));
    }
  }
  if (matches.length > 1) throw new Error(`Linked EOS appears online on multiple ARK maps: ${matches.map((item) => item.prefix).join(', ')}`);
  return matches[0] || null;
}

async function nextAwaiting(connection) {
  const [rows] = await connection.query(`SELECT * FROM ${ORDER_TABLE} WHERE state='AWAITING_DELIVERY' ORDER BY revealed_at ASC, created_at ASC LIMIT 1`);
  return rows[0] || null;
}

async function claimOne(connection, row, target) {
  await connection.beginTransaction();
  try {
    const [locked] = await connection.execute(`SELECT * FROM ${ORDER_TABLE} WHERE id=? AND state='AWAITING_DELIVERY' LIMIT 1 FOR UPDATE`, [row.id]);
    if (!locked[0]) { await connection.commit(); return null; }
    const mapName = process.env[`${target.prefix}_NAME`] || (target.prefix === 'ARK_GEN1' ? 'Genesis 1' : target.prefix === 'ARK_MAP2' ? 'Astraeos' : target.prefix);
    await connection.execute(`UPDATE ${ORDER_TABLE} SET state='DELIVERING', delivery_server_id=?, delivery_map_name=?, delivery_attempts=delivery_attempts+1, failure_class='', error_message='' WHERE id=? AND state='AWAITING_DELIVERY'`, [target.prefix.toLowerCase(), mapName, row.id]);
    await connection.execute(`INSERT INTO ${EVENT_TABLE} (order_id, event_type, details) VALUES (?, 'DELIVERY_STARTED', ?)`, [row.id, `Sentinal located linked EOS online on ${target.prefix} and claimed Dino Cache for RCON delivery.`]);
    await connection.commit();
    return { ...locked[0], deliveryPrefix: target.prefix, server: target.server };
  } catch (error) { await connection.rollback().catch(() => {}); throw error; }
}

async function finishDelivery(connection, row, outcome) {
  const deliveredAtSql = outcome.state === 'DELIVERED' ? ', delivered_at=CURRENT_TIMESTAMP(3)' : '';
  await connection.execute(`UPDATE ${ORDER_TABLE} SET state=?, failure_class=?, error_message=?${deliveredAtSql} WHERE id=? AND state='DELIVERING'`, [outcome.state, outcome.failureClass || '', String(outcome.details || '').slice(0, 500), row.id]);
  await connection.execute(`INSERT INTO ${EVENT_TABLE} (order_id, event_type, details) VALUES (?, ?, ?)`, [row.id, outcome.state, String(outcome.details || '').slice(0, 500)]);
}

async function deliverOne({ connector = connectMysql } = {}) {
  const { connection } = await connector();
  try {
    await ensureSchema(connection);
    await ensureDeliveryState(connection);
    const pending = await nextAwaiting(connection);
    if (!pending) return { skipped: 'none-awaiting' };
    const target = await findOnlineServer(pending.player_eos_id);
    if (!target) return { skipped: 'player-offline', orderId: pending.id, publicCacheId: pending.public_cache_id };
    const row = await claimOne(connection, pending, target);
    if (!row) return { skipped: 'claim-race' };
    const command = buildDiscordCacheDinoCommand({ eosId: row.player_eos_id, blueprint: row.blueprint, level: Number(row.rolled_level), sex: row.sex });
    let result;
    try { result = await new ArkRconClient(row.server).executeDetailed(command); }
    catch (error) {
      const outcome = { state: 'SENT_UNCONFIRMED', failureClass: 'RCON_AMBIGUOUS', details: `RCON result ambiguous after delivery claim: ${String(error?.message || error).slice(0, 400)}` };
      await finishDelivery(connection, row, outcome);
      return { orderId: row.id, command, ...outcome };
    }
    const outcome = classifyRconResult(result);
    await finishDelivery(connection, row, outcome);
    console.log('[dino-cache-delivery]', JSON.stringify({ orderId: row.id, publicCacheId: row.public_cache_id, server: row.deliveryPrefix, rconStatus: result.status, state: outcome.state }));
    return { orderId: row.id, publicCacheId: row.public_cache_id, command, rconStatus: result.status, server: row.deliveryPrefix, ...outcome };
  } finally { await connection.end().catch(() => {}); }
}

async function deliverSaddle({ connector = connectMysql, submit = submitSaddle } = {}) {
  const { connection } = await connector();
  try {
    await ensureSchema(connection);
    const [rows] = await connection.query(`SELECT * FROM ${ORDER_TABLE} WHERE state='DELIVERED' AND saddle_state='PENDING' ORDER BY delivered_at ASC LIMIT 1`);
    const row = rows[0];
    if (!row) return {skipped:'none-awaiting-saddle'};
    const [claim] = await connection.execute(`UPDATE ${ORDER_TABLE} SET saddle_state='SENDING' WHERE id=? AND saddle_state='PENDING'`, [row.id]);
    if (claim.affectedRows !== 1) return {skipped:'claim-race'};
    let saddleState = 'SENT_UNCONFIRMED';
    try { const result = await submit(row); if (result.state === 'DELIVERED') saddleState = 'DELIVERED'; } catch { /* Never retry an uncertain item grant automatically. */ }
    await connection.execute(`UPDATE ${ORDER_TABLE} SET saddle_state=? WHERE id=? AND saddle_state='SENDING'`, [saddleState,row.id]);
    return {orderId:row.id,saddleState};
  } finally {await connection.end().catch(()=>{});}
}

async function runCycle() {
  if (running) return { skipped: 'busy' };
  running = true;
  try {
    const results = [];
    for (let index = 0; index < 10; index += 1) {
      const result = await deliverOne();
      results.push(result);
      if (result?.skipped) break;
    }
    if (process.env.NEXUS_CACHE_SADDLE_ENDPOINT && process.env.NEXUS_CACHE_SADDLE_SECRET) results.push(await deliverSaddle());
    return results;
  } finally { running = false; }
}

function installArkDinoBoxDeliveryWorker() {
  if (globalThis[INSTALLED]) return false;
  globalThis[INSTALLED] = true;
  const interval = Math.max(5000, Math.min(60000, Number(process.env.NEXUS_DINO_CACHE_DELIVERY_POLL_MS || 10000)));
  setTimeout(() => runCycle().catch((error) => console.error('[dino-cache-delivery] startup cycle failed:', String(error?.message || error).slice(0, 500))), 2000).unref?.();
  timer = setInterval(() => runCycle().catch((error) => console.error('[dino-cache-delivery] cycle failed:', String(error?.message || error).slice(0, 500))), interval);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Dino Cache delivery worker enabled (online-map routing: ${eligibleDeliveryPrefixes().join(', ') || 'none'}, ${interval}ms).`);
  return true;
}

module.exports = { deliverSaddle, deliveryPrefixes, eligibleDeliveryPrefixes, buildDiscordCacheDinoCommand, ensureDeliveryState, classifyRconResult, findOnlineServer, nextAwaiting, claimOne, finishDelivery, deliverOne, runCycle, installArkDinoBoxDeliveryWorker };
