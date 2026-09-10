'use strict';

const { connectMysql } = require('./arkshop-mysql.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { ArkClusterRegistry } = require('./ark-cluster-registry.cjs');
const { ORDER_TABLE, EVENT_TABLE, ensureSchema } = require('./ark-cache-shop-service.cjs');
const { saddleCommand } = require('./ark-cache-receipts.cjs');
const {
  backendMode,
  fallbackEnabled,
  inspectRewardsAscended,
  deliverWithRewardsAscended
} = require('./rewards-ascended-delivery.cjs');

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
  if (!/^\/(?:Game|SDinoVariants|RunicWyverns)\/[A-Za-z0-9_./-]{8,220}$/.test(dino)) throw new Error('Dino Depot blueprint path is invalid.');
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
  if (!response || !/\b(success|successfully|delivered|spawned|given)\b/i.test(response)) return { state:'SENT_UNCONFIRMED',failureClass:'UNCONFIRMED',details:response||'No definitive delivery acknowledgement.' };
  return { state: 'DELIVERED', failureClass: '', details: response };
}

async function findOnlineServer(eosId, env = process.env, { registry = new ArkClusterRegistry(), clientFactory = (server) => new ArkRconClient(server) } = {}) {
  const matches = [];
  for (const prefix of eligibleDeliveryPrefixes(env, registry)) {
    const server = arkServerFromEnv(prefix, env);
    if (!server.enabled || !server.host || !server.port || !server.password) continue;
    try {
      const result = await clientFactory(server, prefix).executeDetailed('ListPlayers');
      const response = String(result?.response || '');
      if (response.split(/[^A-Za-z0-9_-]+/).includes(String(eosId))) matches.push({ prefix, server, response });
    } catch (error) {
      console.warn('[dino-cache-delivery] ListPlayers probe failed', prefix, String(error?.message || error).slice(0, 180));
    }
  }
  if (matches.length > 1) throw new Error(`Linked EOS appears online on multiple ARK maps: ${matches.map((item) => item.prefix).join(', ')}`);
  return matches[0] || null;
}

async function nextAwaiting(connection) {
  const [rows] = await connection.query(`SELECT * FROM ${ORDER_TABLE} WHERE state='AWAITING_DELIVERY' ORDER BY updated_at ASC, created_at ASC LIMIT 1`);
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

async function acknowledgeDino(connection, row, details = 'Dino component acknowledged; never automatically spawn it again.') {
  await connection.execute(
    `INSERT INTO ${EVENT_TABLE} (order_id,event_type,details) SELECT ?,'DINO_ACKNOWLEDGED',? WHERE NOT EXISTS (SELECT 1 FROM ${EVENT_TABLE} WHERE order_id=? AND event_type='DINO_ACKNOWLEDGED')`,
    [row.id, String(details).slice(0, 500), row.id]
  );
}

async function markCombinedSaddleDelivered(connection, row, saddle) {
  if (!saddle || saddle.state === 'DELIVERED') return false;
  const details = 'Saddle embedded in the RewardsAscended cryopodded dino reward.';
  await connection.execute(`UPDATE nexus_cache_saddle_delivery SET state='DELIVERED', error_message=? WHERE order_id=? AND state<>'DELIVERED'`, [details, row.id]);
  await connection.execute(`INSERT INTO ${EVENT_TABLE} (order_id,event_type,details) VALUES (?,'SADDLE_ACKNOWLEDGED',?)`, [row.id, details]);
  return true;
}

async function deferForSaddleTarget(connection, row, target) {
  const details = `Dino delivered; saddle is waiting for a verified ARK player ID on ${target.prefix}.`;
  await connection.execute(
    `UPDATE ${ORDER_TABLE} SET state='AWAITING_DELIVERY', failure_class='SADDLE_TARGET_PENDING', error_message=?, updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND state='DELIVERING'`,
    [details, row.id]
  );
  await connection.execute(
    `UPDATE nexus_cache_saddle_delivery SET state='PENDING', error_message=? WHERE order_id=? AND state<>'DELIVERED'`,
    [details, row.id]
  );
  await connection.execute(`INSERT INTO ${EVENT_TABLE} (order_id,event_type,details) VALUES (?,'SADDLE_TARGET_PENDING',?)`, [row.id, details]);
  return { skipped: 'saddle-player-id-unverified', orderId: row.id, publicCacheId: row.public_cache_id, dinoDelivered: true, server: row.deliveryPrefix };
}

async function finishDinoDepotPath({ connection, row, target, saddle, result, outcome, command, clientFactory }) {
  if (outcome.state === 'DELIVERED') {
    await acknowledgeDino(connection, row);
    if (saddle && saddle.state !== 'DELIVERED') {
      const [targets] = await connection.execute('SELECT * FROM nexus_cache_delivery_targets WHERE eos_id=? AND server_prefix=?',[row.player_eos_id,target.prefix]);
      const playerTarget = targets[0];
      if (!playerTarget) {
        const deferred = await deferForSaddleTarget(connection, row, target);
        console.log('[dino-cache-delivery]', JSON.stringify({ orderId: row.id, publicCacheId: row.public_cache_id, backend: 'dinodepot', server: row.deliveryPrefix, rconStatus: result?.status, state: 'AWAITING_DELIVERY', reason: deferred.skipped, dinoDelivered: true }));
        return { ...deferred, backend: 'dinodepot', command, rconStatus: result?.status };
      }
      await connection.execute("UPDATE nexus_cache_saddle_delivery SET state='DELIVERING' WHERE order_id=? AND state='PENDING'",[row.id]);
      let saddleOutcome;
      try { saddleOutcome = classifyRconResult(await clientFactory(row.server).executeDetailed(saddleCommand(playerTarget.ark_player_id,saddle.blueprint))); }
      catch(error) { saddleOutcome={state:'SENT_UNCONFIRMED',failureClass:'SADDLE_AMBIGUOUS',details:String(error.message)}; }
      await connection.execute('UPDATE nexus_cache_saddle_delivery SET state=?,error_message=? WHERE order_id=?',[saddleOutcome.state,saddleOutcome.details.slice(0,500),row.id]);
      if (saddleOutcome.state !== 'DELIVERED') Object.assign(outcome,saddleOutcome);
    }
  }
  await finishDelivery(connection, row, outcome);
  console.log('[dino-cache-delivery]', JSON.stringify({ orderId: row.id, publicCacheId: row.public_cache_id, backend: 'dinodepot', server: row.deliveryPrefix, rconStatus: result?.status, state: outcome.state }));
  return { orderId: row.id, publicCacheId: row.public_cache_id, backend: 'dinodepot', command, rconStatus: result?.status, server: row.deliveryPrefix, ...outcome };
}

async function deliverOne({ connector = connectMysql, findServer = findOnlineServer, clientFactory = server => new ArkRconClient(server) } = {}) {
  const { connection } = await connector();
  try {
    await ensureSchema(connection);
    await ensureDeliveryState(connection);
    await connection.query(`UPDATE ${ORDER_TABLE} SET state='SENT_UNCONFIRMED',failure_class='STALE_CLAIM',error_message='Delivery claim interrupted; verify inventory before retry.' WHERE state='DELIVERING' AND updated_at < CURRENT_TIMESTAMP(3) - INTERVAL 10 MINUTE`);
    const pending = await nextAwaiting(connection);
    if (!pending) return { skipped: 'none-awaiting' };
    const target = await findServer(pending.player_eos_id);
    if (!target) {
      await connection.execute(`UPDATE ${ORDER_TABLE} SET updated_at=CURRENT_TIMESTAMP(3) WHERE id=? AND state='AWAITING_DELIVERY'`,[pending.id]);
      return { skipped: 'player-offline', orderId: pending.id, publicCacheId: pending.public_cache_id };
    }
    const [saddles] = await connection.execute('SELECT * FROM nexus_cache_saddle_delivery WHERE order_id=?',[pending.id]);
    const saddle = saddles[0];
    const row = await claimOne(connection, pending, target);
    if (!row) return { skipped: 'claim-race' };

    const [acks] = await connection.execute(`SELECT sequence_id FROM ${EVENT_TABLE} WHERE order_id=? AND event_type='DINO_ACKNOWLEDGED' LIMIT 1`,[row.id]);
    const alreadyAcknowledged = acks.length > 0;

    if (!alreadyAcknowledged && backendMode() === 'rewardsascended') {
      try {
        const client = clientFactory(row.server);
        const delivery = await deliverWithRewardsAscended({ prefix: target.prefix, row, saddleBlueprint: saddle?.blueprint || '', client });
        const outcome = delivery.outcome;
        if (outcome.state === 'DELIVERED') {
          await acknowledgeDino(connection, row, `RewardsAscended acknowledged ${delivery.configured.rewardId}; never automatically give this cache again.`);
          await markCombinedSaddleDelivered(connection, row, saddle);
        }
        await finishDelivery(connection, row, outcome);
        console.log('[dino-cache-delivery]', JSON.stringify({ orderId: row.id, publicCacheId: row.public_cache_id, backend: 'rewardsascended', rewardId: delivery.configured.rewardId, configChanged: delivery.configured.changed, server: row.deliveryPrefix, rconStatus: delivery.result?.status || 'ambiguous', state: outcome.state }));
        return { orderId: row.id, publicCacheId: row.public_cache_id, backend: 'rewardsascended', rewardId: delivery.configured.rewardId, command: delivery.command, rconStatus: delivery.result?.status, server: row.deliveryPrefix, ...outcome };
      } catch (error) {
        const beforeRewardSend = error?.beforeRewardSend === true || ['REWARDS_ASCENDED_NOT_FOUND','REWARDS_ASCENDED_VERSION_UNSUPPORTED','REWARDS_ASCENDED_OVERRIDE_REQUIRES_PATH'].includes(String(error?.code || ''));
        if (!beforeRewardSend || !fallbackEnabled()) {
          const outcome = { state: 'DELIVERY_FAILED', failureClass: 'REWARDS_ASCENDED_SETUP', details: String(error?.message || error).slice(0, 480) };
          await finishDelivery(connection, row, outcome);
          return { orderId: row.id, publicCacheId: row.public_cache_id, backend: 'rewardsascended', server: row.deliveryPrefix, ...outcome };
        }
        console.warn('[dino-cache-delivery] RewardsAscended unavailable before reward send; using Dino Depot fallback:', target.prefix, String(error?.message || error).slice(0, 300));
      }
    }

    let command = '';
    let result;
    let outcome;
    if (alreadyAcknowledged) {
      result = { status: 'success', response: 'Dino already delivered successfully' };
      outcome = { state: 'DELIVERED', failureClass: '', details: result.response };
    } else {
      command = buildDiscordCacheDinoCommand({ eosId: row.player_eos_id, blueprint: row.blueprint, level: Number(row.rolled_level), sex: row.sex });
      try { result = await clientFactory(row.server).executeDetailed(command); }
      catch (error) {
        outcome = { state: 'SENT_UNCONFIRMED', failureClass: 'RCON_AMBIGUOUS', details: `RCON result ambiguous after delivery claim: ${String(error?.message || error).slice(0, 400)}` };
        await finishDelivery(connection, row, outcome);
        return { orderId: row.id, publicCacheId: row.public_cache_id, backend: 'dinodepot', command, server: row.deliveryPrefix, ...outcome };
      }
      outcome = classifyRconResult(result);
    }
    return await finishDinoDepotPath({ connection, row, target, saddle, result, outcome, command, clientFactory });
  } finally { await connection.end().catch(() => {}); }
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
    return results;
  } finally { running = false; }
}

function installArkDinoBoxDeliveryWorker() {
  if (globalThis[INSTALLED]) return false;
  globalThis[INSTALLED] = true;
  const interval = Math.max(5000, Math.min(60000, Number(process.env.NEXUS_DINO_CACHE_DELIVERY_POLL_MS || 10000)));
  if (backendMode() === 'rewardsascended') {
    for (const prefix of eligibleDeliveryPrefixes()) {
      const probe = setTimeout(() => inspectRewardsAscended(prefix)
        .then((status) => console.log('[dino-cache-delivery] RewardsAscended probe', JSON.stringify({ prefix, found: status.found, version: status.version, configFile: status.configFile, usesOverride: status.usesOverride, reason: status.reason || '' })))
        .catch((error) => console.warn('[dino-cache-delivery] RewardsAscended probe failed', prefix, String(error?.message || error).slice(0, 300))), 1000);
      probe.unref?.();
    }
  }
  setTimeout(() => runCycle().catch((error) => console.error('[dino-cache-delivery] startup cycle failed:', String(error?.message || error).slice(0, 500))), 2000).unref?.();
  timer = setInterval(() => runCycle().catch((error) => console.error('[dino-cache-delivery] cycle failed:', String(error?.message || error).slice(0, 500))), interval);
  timer.unref?.();
  console.log(`[Nexus Sentinal] Dino Cache delivery worker enabled (backend=${backendMode()}, fallback=${fallbackEnabled() ? 'dinodepot' : 'off'}, online-map routing: ${eligibleDeliveryPrefixes().join(', ') || 'none'}, ${interval}ms).`);
  return true;
}

module.exports = { deliveryPrefixes, eligibleDeliveryPrefixes, buildDiscordCacheDinoCommand, ensureDeliveryState, classifyRconResult, findOnlineServer, nextAwaiting, claimOne, finishDelivery, acknowledgeDino, markCombinedSaddleDelivered, deferForSaddleTarget, finishDinoDepotPath, deliverOne, runCycle, installArkDinoBoxDeliveryWorker };
