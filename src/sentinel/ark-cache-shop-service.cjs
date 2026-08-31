'use strict';

const crypto = require('node:crypto');
const { connectMysql } = require('./arkshop-mysql.cjs');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { CONFIG, deterministicRng, rollCache } = require('./ark-dino-cache-engine.cjs');
const { auditArkShopClusterDatabase } = require('./arkshop-cluster-economy-guard.cjs');

const ORDER_TABLE = 'nexus_discord_cache_orders';
const EVENT_TABLE = 'nexus_discord_cache_events';
const VALID_CACHE_ID = /^[a-z0-9_-]{1,48}$/;

function safeName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error('Unsafe ArkShop schema identifier.');
  return `\`${name}\``;
}

function cleanId(value, max = 128) {
  return String(value || '').trim().slice(0, max);
}

function shopError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function orderView(row = {}) {
  if (!row) return null;
  return {
    id: String(row.id || ''), publicCacheId: String(row.public_cache_id || ''), purchaseNonce: String(row.purchase_nonce || ''),
    discordUserId: String(row.discord_user_id || ''), playerEosId: String(row.player_eos_id || ''), cacheType: String(row.cache_type || ''),
    pointCost: Number(row.nexus_point_cost || 0), species: String(row.species || ''), rarity: String(row.rarity || ''), variant: String(row.variant || ''),
    blueprint: String(row.blueprint || ''), level: Number(row.rolled_level || 0), sex: String(row.sex || ''), state: String(row.state || ''),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '', deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : ''
  };
}

function pickLinkedArkAccount(profile) {
  const accounts = Array.isArray(profile?.arkAccounts) ? profile.arkAccounts.filter((item) => /^[A-Za-z0-9_-]{8,128}$/.test(cleanId(item?.eosId))) : [];
  if (!accounts.length) throw shopError('ARK_ACCOUNT_NOT_LINKED', 'Link your Discord account to ARK before buying a Dino Cache.');
  accounts.sort((a, b) => Date.parse(b?.verifiedAt || 0) - Date.parse(a?.verifiedAt || 0));
  return accounts[0];
}

function assertEconomyReady(result = {}) {
  if (result?.ok === true) return result;
  const mode = cleanId(result?.mode || 'unverified', 64);
  throw shopError('CLUSTER_ECONOMY_NOT_READY', `Cache purchases are temporarily locked because the ARK shared-MySQL economy is not verified (${mode}). No Nexus Points were charged.`);
}

async function ensureSchema(connection) {
  await connection.query(`CREATE TABLE IF NOT EXISTS ${ORDER_TABLE} (
    id CHAR(36) NOT NULL PRIMARY KEY, public_cache_id VARCHAR(24) NOT NULL, purchase_nonce VARCHAR(80) NOT NULL,
    discord_user_id VARCHAR(25) NOT NULL, player_eos_id VARCHAR(128) NOT NULL, cache_type VARCHAR(64) NOT NULL,
    nexus_point_cost INT UNSIGNED NOT NULL, species VARCHAR(100) NOT NULL, rarity VARCHAR(16) NOT NULL, variant VARCHAR(16) NOT NULL,
    blueprint VARCHAR(255) NOT NULL, rolled_level SMALLINT UNSIGNED NOT NULL, sex ENUM('male','female') NOT NULL,
    state ENUM('AWAITING_DELIVERY','DELIVERING','DELIVERED','DELIVERY_FAILED') NOT NULL DEFAULT 'AWAITING_DELIVERY',
    delivery_server_id VARCHAR(64) NOT NULL DEFAULT '', delivery_map_name VARCHAR(100) NOT NULL DEFAULT '', delivery_attempts INT UNSIGNED NOT NULL DEFAULT 0,
    failure_class VARCHAR(32) NOT NULL DEFAULT '', error_message VARCHAR(500) NOT NULL DEFAULT '', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    delivered_at DATETIME(3) NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_nexus_discord_cache_public (public_cache_id), UNIQUE KEY uq_nexus_discord_cache_nonce (purchase_nonce),
    KEY ix_nexus_discord_cache_user (discord_user_id, created_at), KEY ix_nexus_discord_cache_delivery (state, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await connection.query(`CREATE TABLE IF NOT EXISTS ${EVENT_TABLE} (
    sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, order_id CHAR(36) NOT NULL, event_type VARCHAR(40) NOT NULL,
    actor_discord_user_id VARCHAR(25) NOT NULL DEFAULT '', details VARCHAR(500) NOT NULL DEFAULT '', created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY ix_nexus_discord_cache_event_order (order_id, sequence_id), CONSTRAINT fk_nexus_discord_cache_event_order FOREIGN KEY (order_id)
      REFERENCES ${ORDER_TABLE}(id) ON DELETE RESTRICT ON UPDATE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function arkShopColumns(connection, database, table) {
  const [rows] = await connection.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [database, table]);
  const byLower = new Map(rows.map((row) => [String(row.COLUMN_NAME).toLowerCase(), String(row.COLUMN_NAME)]));
  const points = ['points', 'point'].map((key) => byLower.get(key)).find(Boolean);
  if (!points) throw shopError('ARKSHOP_POINTS_COLUMN_MISSING', 'ArkShop points column could not be identified safely.');
  const ids = ['eosid','eos_id','eos','steamid','steam_id','playerid','player_id'].map((key) => byLower.get(key)).filter(Boolean);
  if (!ids.length) throw shopError('ARKSHOP_ID_COLUMN_MISSING', 'ArkShop player identity column could not be identified safely.');
  return { points, ids };
}

async function findPointsAccount(connection, dbConfig, eosId, { lock = false } = {}) {
  const columns = await arkShopColumns(connection, dbConfig.database, dbConfig.table);
  const table = safeName(dbConfig.table);
  for (const idColumn of columns.ids) {
    const [rows] = await connection.execute(`SELECT ${safeName(idColumn)} AS player_id, ${safeName(columns.points)} AS points FROM ${table} WHERE ${safeName(idColumn)}=? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [eosId]);
    if (rows[0]) return { idColumn, pointsColumn: columns.points, row: rows[0] };
  }
  throw shopError('ARKSHOP_PLAYER_NOT_FOUND', 'Your linked ARK account was not found in the current ArkShop points database.');
}

async function existingByNonce(connection, nonce) {
  const [rows] = await connection.execute(`SELECT * FROM ${ORDER_TABLE} WHERE purchase_nonce=? LIMIT 1`, [nonce]);
  return rows[0] || null;
}

function committedRoll(cacheId, secret, identity) {
  const rng = deterministicRng(secret, identity);
  const roll = rollCache(cacheId, rng);
  const sex = rng() < 0.5 ? 'female' : 'male';
  return Object.freeze({ ...roll, sex });
}

class ArkCacheShopService {
  constructor({ identityStore = new ArkIdentityStore(), connector = connectMysql, rngSecret = process.env.NEXUS_DINO_CACHE_RNG_SECRET, economyAuditor = auditArkShopClusterDatabase } = {}) {
    this.identityStore = identityStore; this.connector = connector; this.rngSecret = rngSecret; this.economyAuditor = economyAuditor;
  }

  linkedAccount(discordUserId) { return pickLinkedArkAccount(this.identityStore.profileByDiscord(cleanId(discordUserId, 25))); }
  async economyStatus() { try { return await this.economyAuditor(); } catch (error) { return { ok:false, mode:'audit-failed', error:String(error?.message || error).slice(0,180) }; } }

  async shopper(discordUserId) {
    const account = this.linkedAccount(discordUserId);
    const economy = await this.economyStatus();
    const { connection, config } = await this.connector();
    try {
      const points = await findPointsAccount(connection, config, account.eosId);
      return { discordUserId: cleanId(discordUserId, 25), account, points: Number(points.row.points || 0), economy };
    } finally { await connection.end().catch(() => {}); }
  }

  async purchase({ discordUserId, cacheId, purchaseNonce } = {}) {
    const userId = cleanId(discordUserId, 25), type = cleanId(cacheId, 48).toLowerCase(), nonce = cleanId(purchaseNonce, 80);
    if (!/^\d{5,25}$/.test(userId)) throw shopError('INVALID_DISCORD_USER', 'A valid Discord user is required.');
    if (!VALID_CACHE_ID.test(type) || !CONFIG.caches[type]) throw shopError('INVALID_CACHE', 'That Dino Cache is not available.');
    if (!nonce) throw shopError('INVALID_PURCHASE_NONCE', 'Discord purchase identity is missing.');
    assertEconomyReady(await this.economyStatus());
    const account = this.linkedAccount(userId), cache = CONFIG.caches[type];
    const { connection, config } = await this.connector();
    try {
      await ensureSchema(connection);
      await connection.beginTransaction();
      try {
        const existing = await existingByNonce(connection, nonce);
        if (existing) { await connection.commit(); return { order: orderView(existing), duplicate: true, balance: null }; }
        if (cache.cooldownHours > 0) {
          const cutoff = new Date(Date.now() - cache.cooldownHours * 60 * 60 * 1000);
          const [recent] = await connection.execute(`SELECT public_cache_id, created_at FROM ${ORDER_TABLE} WHERE discord_user_id=? AND cache_type=? AND created_at>=? ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [userId, type, cutoff]);
          if (recent[0]) throw shopError('CACHE_COOLDOWN', `${type === 'apex' ? 'Apex' : 'This'} Cache is still on cooldown.`);
        }
        const wallet = await findPointsAccount(connection, config, account.eosId, { lock: true });
        const balance = Number(wallet.row.points || 0);
        if (!Number.isSafeInteger(balance) || balance < cache.price) throw shopError('INSUFFICIENT_POINTS', `You need ${cache.price.toLocaleString('en-US')} Nexus Points for this cache. Current balance: ${Math.max(0, balance || 0).toLocaleString('en-US')}.`);
        const identity = `discord-cache:${nonce}:${userId}:${account.eosId}:${type}`, roll = committedRoll(type, this.rngSecret, identity), id = crypto.randomUUID();
        const publicCacheId = `NC-${id.replace(/-/g, '').slice(0, 12).toUpperCase()}`, table = safeName(config.table);
        const debit = await connection.execute(`UPDATE ${table} SET ${safeName(wallet.pointsColumn)}=${safeName(wallet.pointsColumn)}-? WHERE ${safeName(wallet.idColumn)}=? AND ${safeName(wallet.pointsColumn)}>=?`, [cache.price, account.eosId, cache.price]);
        if (Number(debit?.[0]?.affectedRows || 0) !== 1) throw shopError('POINT_DEBIT_FAILED', 'Nexus Points changed during checkout; the cache was not purchased.');
        await connection.execute(`INSERT INTO ${ORDER_TABLE} (id, public_cache_id, purchase_nonce, discord_user_id, player_eos_id, cache_type, nexus_point_cost, species, rarity, variant, blueprint, rolled_level, sex, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AWAITING_DELIVERY')`, [id, publicCacheId, nonce, userId, account.eosId, type, cache.price, roll.species, roll.rarity, roll.variant, roll.blueprint, roll.level, roll.sex]);
        await connection.execute(`INSERT INTO ${EVENT_TABLE} (order_id, event_type, actor_discord_user_id, details) VALUES (?, 'PURCHASE_ROLLED', ?, ?)`, [id, userId, `Discord-first immutable ${type} cache roll committed before reveal animation.`]);
        await connection.commit();
        const [rows] = await connection.execute(`SELECT * FROM ${ORDER_TABLE} WHERE id=? LIMIT 1`, [id]);
        return { order: orderView(rows[0]), duplicate: false, balance: balance - cache.price };
      } catch (error) { await connection.rollback().catch(() => {}); throw error; }
    } finally { await connection.end().catch(() => {}); }
  }

  async rewards(discordUserId, limit = 8) {
    const userId = cleanId(discordUserId, 25), safeLimit = Math.max(1, Math.min(20, Number(limit) || 8));
    const { connection } = await this.connector();
    try { await ensureSchema(connection); const [rows] = await connection.query(`SELECT * FROM ${ORDER_TABLE} WHERE discord_user_id=? ORDER BY created_at DESC LIMIT ${safeLimit}`, [userId]); return rows.map(orderView); }
    finally { await connection.end().catch(() => {}); }
  }
}

module.exports = { ORDER_TABLE, EVENT_TABLE, safeName, cleanId, shopError, orderView, pickLinkedArkAccount, assertEconomyReady, ensureSchema, arkShopColumns, findPointsAccount, committedRoll, ArkCacheShopService };
