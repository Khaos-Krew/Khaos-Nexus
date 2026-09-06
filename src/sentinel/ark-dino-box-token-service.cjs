'use strict';

const crypto = require('node:crypto');
const { connectMysql } = require('./arkshop-mysql.cjs');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { CONFIG } = require('./ark-dino-cache-engine.cjs');
const {
  ORDER_TABLE,
  EVENT_TABLE,
  cleanId,
  shopError,
  orderView,
  ensureSchema,
  claimCacheCooldown,
  committedRoll
} = require('./ark-cache-shop-service.cjs');

const TOKEN_TABLE = 'nexus_dino_box_tokens';
const VALID_CACHE_ID = /^[a-z0-9_-]{1,48}$/;

function normalizeToken(value) {
  const token = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{12,96}$/.test(token)) throw shopError('INVALID_DINO_BOX_TOKEN', 'That Dino Box token is not valid.');
  return token;
}

function tokenSecret(env = process.env) {
  const secret = String(env.NEXUS_DINO_CACHE_TOKEN_SECRET || env.NEXUS_DINO_CACHE_RNG_SECRET || '');
  if (secret.length < 32) throw shopError('DINO_BOX_TOKEN_SECRET_MISSING', 'Dino Box token redemption is not configured yet.');
  return secret;
}

function tokenDigest(value, secret = tokenSecret()) {
  return crypto.createHmac('sha256', secret).update(normalizeToken(value), 'utf8').digest('hex');
}

function generateTokenCode() {
  return `NXC-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
}

async function ensureTokenSchema(connection) {
  await ensureSchema(connection);
  await connection.query(`CREATE TABLE IF NOT EXISTS ${TOKEN_TABLE} (
    id CHAR(36) NOT NULL PRIMARY KEY,
    token_hash CHAR(64) NOT NULL,
    cache_type VARCHAR(64) NOT NULL,
    issued_to_discord_user_id VARCHAR(25) NOT NULL DEFAULT '',
    issued_by_discord_user_id VARCHAR(25) NOT NULL DEFAULT '',
    source_label VARCHAR(100) NOT NULL DEFAULT '',
    expires_at DATETIME(3) NULL,
    redeemed_by_discord_user_id VARCHAR(25) NOT NULL DEFAULT '',
    redeemed_order_id CHAR(36) NULL,
    redeemed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_nexus_dino_box_token_hash (token_hash),
    KEY ix_nexus_dino_box_token_redeem (redeemed_at, expires_at),
    KEY ix_nexus_dino_box_token_user (issued_to_discord_user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

function cacheScope(value) {
  const scope = cleanId(value || '*', 48).toLowerCase();
  if (scope === '*' || scope === 'any') return '*';
  if (!VALID_CACHE_ID.test(scope) || !CONFIG.caches[scope]) throw shopError('INVALID_CACHE', 'That Dino Cache is not available.');
  return scope;
}

class ArkDinoBoxTokenService {
  constructor({
    identityStore = new ArkIdentityStore(),
    connector = connectMysql,
    rngSecret = process.env.NEXUS_DINO_CACHE_RNG_SECRET,
    secret = null
  } = {}) {
    this.identityStore = identityStore;
    this.connector = connector;
    this.rngSecret = rngSecret;
    this.secret = secret;
  }

  linkedAccount(discordUserId) {
    const userId = cleanId(discordUserId, 25);
    const profile = this.identityStore.profileByDiscord(userId);
    const accounts = Array.isArray(profile?.arkAccounts)
      ? profile.arkAccounts.filter((item) => /^[A-Za-z0-9_-]{8,128}$/.test(cleanId(item?.eosId)))
      : [];
    if (!accounts.length) throw shopError('ARK_ACCOUNT_NOT_LINKED', 'Link your Discord account to ARK before redeeming a Dino Box token.');
    accounts.sort((a, b) => Date.parse(b?.verifiedAt || 0) - Date.parse(a?.verifiedAt || 0));
    return accounts[0];
  }

  async issueToken({ cacheId = '*', issuedToDiscordUserId = '', issuedByDiscordUserId = '', sourceLabel = '', expiresAt = null } = {}) {
    const scope = cacheScope(cacheId);
    const issuedTo = cleanId(issuedToDiscordUserId, 25);
    const issuedBy = cleanId(issuedByDiscordUserId, 25);
    if (issuedTo && !/^\d{5,25}$/.test(issuedTo)) throw shopError('INVALID_DISCORD_USER', 'Token recipient must be a valid Discord user.');
    if (issuedBy && !/^\d{5,25}$/.test(issuedBy)) throw shopError('INVALID_DISCORD_USER', 'Token issuer must be a valid Discord user.');
    const expiry = expiresAt ? new Date(expiresAt) : null;
    if (expiry && !Number.isFinite(expiry.getTime())) throw shopError('INVALID_TOKEN_EXPIRY', 'Token expiry is invalid.');

    const code = generateTokenCode();
    const id = crypto.randomUUID();
    const digest = tokenDigest(code, this.secret || tokenSecret());
    const { connection } = await this.connector();
    try {
      await ensureTokenSchema(connection);
      await connection.execute(
        `INSERT INTO ${TOKEN_TABLE} (id, token_hash, cache_type, issued_to_discord_user_id, issued_by_discord_user_id, source_label, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, digest, scope, issuedTo, issuedBy, cleanId(sourceLabel, 100), expiry]
      );
      return { id, code, cacheType: scope, issuedToDiscordUserId: issuedTo, expiresAt: expiry ? expiry.toISOString() : '' };
    } finally {
      await connection.end().catch(() => {});
    }
  }

  async redeem({ discordUserId, cacheId, tokenCode } = {}) {
    const userId = cleanId(discordUserId, 25);
    const type = cleanId(cacheId, 48).toLowerCase();
    if (!/^\d{5,25}$/.test(userId)) throw shopError('INVALID_DISCORD_USER', 'A valid Discord user is required.');
    if (!VALID_CACHE_ID.test(type) || !CONFIG.caches[type]) throw shopError('INVALID_CACHE', 'That Dino Cache is not available.');
    const digest = tokenDigest(tokenCode, this.secret || tokenSecret());
    const account = this.linkedAccount(userId);
    const { connection } = await this.connector();

    try {
      await ensureTokenSchema(connection);
      await connection.beginTransaction();
      try {
        const [tokens] = await connection.execute(`SELECT * FROM ${TOKEN_TABLE} WHERE token_hash=? LIMIT 1 FOR UPDATE`, [digest]);
        const token = tokens[0];
        if (!token) throw shopError('INVALID_DINO_BOX_TOKEN', 'That Dino Box token is invalid or was never issued by Nexus Sentinal.');

        if (token.redeemed_at) {
          if (String(token.redeemed_by_discord_user_id || '') === userId && token.redeemed_order_id) {
            const [orders] = await connection.execute(`SELECT * FROM ${ORDER_TABLE} WHERE id=? LIMIT 1`, [token.redeemed_order_id]);
            if (orders[0]) {
              await connection.commit();
              return { order: orderView(orders[0]), duplicate: true, balance: null, token: true };
            }
          }
          throw shopError('DINO_BOX_TOKEN_USED', 'That Dino Box token has already been redeemed.');
        }

        if (token.expires_at && new Date(token.expires_at).getTime() <= Date.now()) throw shopError('DINO_BOX_TOKEN_EXPIRED', 'That Dino Box token has expired.');
        const scopedCache = String(token.cache_type || '').toLowerCase();
        if (scopedCache !== '*' && scopedCache !== type) throw shopError('DINO_BOX_TOKEN_WRONG_CACHE', `That token is for the ${scopedCache} cache, not this one.`);
        const issuedTo = String(token.issued_to_discord_user_id || '');
        if (issuedTo && issuedTo !== userId) throw shopError('DINO_BOX_TOKEN_NOT_YOURS', 'That Dino Box token was issued to a different Discord account.');

        const cache = CONFIG.caches[type];
        await claimCacheCooldown(connection, userId, type, cache);
        const identity = `dino-box-token:${token.id}:${userId}:${account.eosId}:${type}`;
        const roll = committedRoll(type, this.rngSecret, identity);
        const orderId = crypto.randomUUID();
        const publicCacheId = `NC-${orderId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
        const purchaseNonce = `token:${token.id}`;

        await connection.execute(
          `INSERT INTO ${ORDER_TABLE} (id, public_cache_id, purchase_nonce, discord_user_id, player_eos_id, cache_type, nexus_point_cost, species, rarity, variant, blueprint, rolled_level, sex, state) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'SEALED')`,
          [orderId, publicCacheId, purchaseNonce, userId, account.eosId, type, roll.species, roll.rarity, roll.variant, roll.blueprint, roll.level, roll.sex]
        );
        await connection.execute(`UPDATE ${ORDER_TABLE} SET saddle_reward=?, saddle_state=? WHERE id=?`, [roll.saddle ? JSON.stringify(roll.saddle) : null, roll.saddle ? 'PENDING' : 'NOT_REQUIRED', orderId]);
        await connection.execute(
          `INSERT INTO ${EVENT_TABLE} (order_id, event_type, actor_discord_user_id, details) VALUES (?, 'TOKEN_REDEEMED_SEALED', ?, ?)`,
          [orderId, userId, `Single-use ${type} Dino Box token redeemed; immutable reward sealed and zero ArkShop points charged.`]
        );
        const [updated] = await connection.execute(
          `UPDATE ${TOKEN_TABLE} SET redeemed_by_discord_user_id=?, redeemed_order_id=?, redeemed_at=CURRENT_TIMESTAMP(3) WHERE id=? AND redeemed_at IS NULL`,
          [userId, orderId, token.id]
        );
        if (Number(updated?.affectedRows || 0) !== 1) throw shopError('DINO_BOX_TOKEN_RACE', 'That Dino Box token was redeemed at the same time elsewhere. No duplicate reward was created.');

        await connection.commit();
        const [orders] = await connection.execute(`SELECT * FROM ${ORDER_TABLE} WHERE id=? LIMIT 1`, [orderId]);
        return { order: orderView(orders[0]), duplicate: false, balance: null, token: true };
      } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
      }
    } finally {
      await connection.end().catch(() => {});
    }
  }
}

module.exports = {
  TOKEN_TABLE,
  normalizeToken,
  tokenSecret,
  tokenDigest,
  generateTokenCode,
  ensureTokenSchema,
  cacheScope,
  ArkDinoBoxTokenService
};
