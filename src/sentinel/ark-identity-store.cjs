'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_TTL_MS = 10 * 60_000;
const MAX_AUDIT_ENTRIES = 10_000;
const MAX_CHALLENGES = 5000;
const CHALLENGE_RETENTION_MS = 7 * 24 * 60 * 60_000;

class IdentityStateError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = 'IdentityStateError';
    this.code = 'ARK_IDENTITY_STATE_CORRUPT';
    if (cause) this.cause = cause;
  }
}

function cleanId(value, max = 128) {
  return String(value || '').replace(/[\r\n\t]/g, '').trim().slice(0, max);
}

function validDiscordId(value) {
  return /^\d{5,25}$/.test(cleanId(value));
}

function validEosId(value) {
  return /^[A-Za-z0-9_-]{8,128}$/.test(cleanId(value));
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptyIdentityState() {
  return { version: 1, profiles: {}, arkIndex: {}, challenges: {}, audit: [] };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function generateCode(length = 8) {
  let code = '';
  for (let i = 0; i < length; i += 1) code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return code;
}

function challengeTimestamp(challenge = {}) {
  const candidates = [challenge.verifiedAt, challenge.expiresAt, challenge.createdAt]
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : 0;
}

function pruneChallenges(state, now = Date.now()) {
  const entries = Object.entries(state?.challenges || {});
  const kept = [];
  for (const [id, challenge] of entries) {
    const pending = challenge?.state === 'pending';
    const timestamp = challengeTimestamp(challenge);
    if (!pending && timestamp && timestamp < now - CHALLENGE_RETENTION_MS) continue;
    kept.push([id, challenge]);
  }
  if (kept.length > MAX_CHALLENGES) {
    const pending = kept.filter(([, challenge]) => challenge?.state === 'pending');
    const terminal = kept
      .filter(([, challenge]) => challenge?.state !== 'pending')
      .sort((a, b) => challengeTimestamp(b[1]) - challengeTimestamp(a[1]));
    const terminalSlots = Math.max(0, MAX_CHALLENGES - pending.length);
    state.challenges = Object.fromEntries([...pending, ...terminal.slice(0, terminalSlots)]);
  } else {
    state.challenges = Object.fromEntries(kept);
  }
  return state.challenges;
}

function normalizeIdentityState(parsed) {
  if (!plainObject(parsed)) throw new IdentityStateError('ARK identity state root must be a JSON object.');
  if (parsed.version != null && parsed.version !== 1) throw new IdentityStateError(`Unsupported ARK identity state version: ${String(parsed.version).slice(0, 24)}.`);
  for (const key of ['profiles', 'arkIndex', 'challenges']) {
    if (parsed[key] != null && !plainObject(parsed[key])) throw new IdentityStateError(`ARK identity state field ${key} must be an object.`);
  }
  if (parsed.audit != null && !Array.isArray(parsed.audit)) throw new IdentityStateError('ARK identity state field audit must be an array.');

  const state = {
    version: 1,
    profiles: parsed.profiles || {},
    arkIndex: parsed.arkIndex || {},
    challenges: parsed.challenges || {},
    audit: (parsed.audit || []).slice(-MAX_AUDIT_ENTRIES)
  };

  for (const [discordId, profile] of Object.entries(state.profiles)) {
    if (!validDiscordId(discordId) || !plainObject(profile)) throw new IdentityStateError('ARK identity state contains an invalid profile record.');
    if (cleanId(profile.discordUserId) && cleanId(profile.discordUserId) !== discordId) throw new IdentityStateError('ARK identity profile key does not match its Discord user id.');
    if (profile.arkAccounts != null && !Array.isArray(profile.arkAccounts)) throw new IdentityStateError('ARK identity profile arkAccounts must be an array.');
  }

  for (const [eosId, discordIdRaw] of Object.entries(state.arkIndex)) {
    const discordId = cleanId(discordIdRaw);
    if (!validEosId(eosId) || !validDiscordId(discordId)) throw new IdentityStateError('ARK identity index contains an invalid account mapping.');
    const profile = state.profiles[discordId];
    if (!profile) throw new IdentityStateError('ARK identity index references a missing profile.');
    const accounts = Array.isArray(profile.arkAccounts) ? profile.arkAccounts : [];
    if (!accounts.some((item) => cleanId(item?.eosId) === eosId)) throw new IdentityStateError('ARK identity index and profile account list are inconsistent.');
  }

  return state;
}

class ArkIdentityStore {
  constructor(options = {}) {
    const root = options.root || process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data');
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-identities.json');
    this.secretFile = path.join(this.dir, 'ark-identity-secret');
    this.secretWasExplicit = Object.prototype.hasOwnProperty.call(options, 'secret') || Boolean(process.env.NEXUS_IDENTITY_SECRET);
    this.secret = String(Object.prototype.hasOwnProperty.call(options, 'secret') ? options.secret : process.env.NEXUS_IDENTITY_SECRET || '');
    this.now = typeof options.now === 'function' ? options.now : Date.now;
  }

  requireSecret() {
    if (!this.secret && !this.secretWasExplicit) {
      try { this.secret = String(fs.readFileSync(this.secretFile, 'utf8')).trim(); } catch {}
      if (!this.secret) {
        fs.mkdirSync(this.dir, { recursive: true });
        const generated = crypto.randomBytes(32).toString('hex');
        try { fs.writeFileSync(this.secretFile, generated, { mode: 0o600, flag: 'wx' }); } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
        }
        this.secret = String(fs.readFileSync(this.secretFile, 'utf8')).trim();
      }
    }
    if (Buffer.byteLength(this.secret) < 32) throw new Error('NEXUS_IDENTITY_SECRET must contain at least 32 characters.');
  }

  codeHash(code) {
    this.requireSecret();
    return crypto.createHmac('sha256', this.secret).update(String(code || '').trim().toUpperCase()).digest('hex');
  }

  read() {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyIdentityState();
      throw new IdentityStateError('ARK identity state could not be read safely.', error);
    }
    try {
      return normalizeIdentityState(JSON.parse(raw));
    } catch (error) {
      if (error instanceof IdentityStateError) throw error;
      throw new IdentityStateError('ARK identity state contains invalid JSON.', error);
    }
  }

  health() {
    try {
      const state = this.read();
      return {
        ok: true,
        profiles: Object.keys(state.profiles).length,
        linkedArkAccounts: Object.keys(state.arkIndex).length,
        pendingChallenges: Object.values(state.challenges).filter((item) => item?.state === 'pending').length
      };
    } catch (error) {
      return { ok: false, code: error?.code === 'ARK_IDENTITY_STATE_CORRUPT' ? error.code : 'ARK_IDENTITY_STATE_UNAVAILABLE' };
    }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    pruneChallenges(state, this.now());
    const safe = {
      version: 1,
      updatedAt: new Date(this.now()).toISOString(),
      profiles: state.profiles || {},
      arkIndex: state.arkIndex || {},
      challenges: state.challenges || {},
      audit: (state.audit || []).slice(-MAX_AUDIT_ENTRIES)
    };
    normalizeIdentityState(safe);
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return safe;
  }

  audit(state, action, details = {}) {
    state.audit.push({ id: crypto.randomUUID(), action, at: new Date(this.now()).toISOString(), ...details });
  }

  issueChallenge(discordUserId, options = {}) {
    const discordId = cleanId(discordUserId);
    if (!validDiscordId(discordId)) throw new Error('A valid Discord user id is required.');
    this.requireSecret();
    const now = this.now();
    const ttlMs = Math.min(30 * 60_000, Math.max(60_000, Number(options.ttlMs) || DEFAULT_TTL_MS));
    const state = this.read();
    pruneChallenges(state, now);
    for (const challenge of Object.values(state.challenges)) {
      if (challenge.discordUserId === discordId && challenge.state === 'pending') challenge.state = 'superseded';
    }
    const code = generateCode();
    const challenge = {
      id: crypto.randomUUID(),
      discordUserId: discordId,
      codeHash: this.codeHash(code),
      state: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      verifiedAt: ''
    };
    state.challenges[challenge.id] = challenge;
    this.audit(state, 'ark-link-code-issued', { discordUserId: discordId, challengeId: challenge.id });
    this.write(state);
    return { code, challengeId: challenge.id, expiresAt: challenge.expiresAt };
  }

  verifyChallenge({ code, eosId, playerName = '', mapId = '' } = {}) {
    const normalizedCode = cleanId(code, 32).toUpperCase();
    const arkId = cleanId(eosId);
    if (!/^[A-Z2-9]{6,12}$/.test(normalizedCode)) return { ok: false, reason: 'invalid-code' };
    if (!validEosId(arkId)) return { ok: false, reason: 'invalid-eos-id' };
    const state = this.read();
    pruneChallenges(state, this.now());
    const wantedHash = this.codeHash(normalizedCode);
    const challenge = Object.values(state.challenges).find((item) => {
      if (item.state !== 'pending' || typeof item.codeHash !== 'string' || item.codeHash.length !== wantedHash.length) return false;
      return crypto.timingSafeEqual(Buffer.from(item.codeHash), Buffer.from(wantedHash));
    });
    if (!challenge) return { ok: false, reason: 'invalid-code' };
    if (Date.parse(challenge.expiresAt) <= this.now()) {
      challenge.state = 'expired';
      this.audit(state, 'ark-link-code-expired', { discordUserId: challenge.discordUserId, challengeId: challenge.id });
      this.write(state);
      return { ok: false, reason: 'expired-code' };
    }
    const existingOwner = cleanId(state.arkIndex[arkId]);
    if (existingOwner && existingOwner !== challenge.discordUserId) {
      this.audit(state, 'ark-link-conflict', { discordUserId: challenge.discordUserId, eosId: arkId, challengeId: challenge.id });
      this.write(state);
      return { ok: false, reason: 'ark-account-already-linked' };
    }

    const profile = state.profiles[challenge.discordUserId] || {
      id: crypto.randomUUID(), discordUserId: challenge.discordUserId, rankId: 'shadow-recruit', arkAccounts: [], createdAt: new Date(this.now()).toISOString()
    };
    const prior = profile.arkAccounts.find((item) => item.eosId === arkId);
    if (prior) {
      prior.playerName = cleanId(playerName, 80) || prior.playerName;
      prior.lastVerifiedMap = cleanId(mapId, 64) || prior.lastVerifiedMap;
      prior.verifiedAt = new Date(this.now()).toISOString();
    } else {
      profile.arkAccounts.push({ eosId: arkId, playerName: cleanId(playerName, 80), lastVerifiedMap: cleanId(mapId, 64), verifiedAt: new Date(this.now()).toISOString() });
    }
    profile.updatedAt = new Date(this.now()).toISOString();
    state.profiles[challenge.discordUserId] = profile;
    state.arkIndex[arkId] = challenge.discordUserId;
    challenge.state = 'verified';
    challenge.verifiedAt = profile.updatedAt;
    delete challenge.codeHash;
    this.audit(state, 'ark-account-linked', { discordUserId: challenge.discordUserId, eosId: arkId, mapId: cleanId(mapId, 64), challengeId: challenge.id });
    this.write(state);
    return { ok: true, profile: clone(profile) };
  }

  profileByDiscord(discordUserId) {
    const profile = this.read().profiles[cleanId(discordUserId)];
    return profile ? clone(profile) : null;
  }

  profileByArk(eosId) {
    const state = this.read();
    const discordId = state.arkIndex[cleanId(eosId)];
    return discordId && state.profiles[discordId] ? clone(state.profiles[discordId]) : null;
  }

  updateRank(discordUserId, rankId, source = 'discord-role-sync') {
    const discordId = cleanId(discordUserId);
    const state = this.read();
    const profile = state.profiles[discordId];
    if (!profile) return { ok: false, reason: 'profile-not-linked' };
    const nextRank = cleanId(rankId, 48) || 'shadow-recruit';
    if (profile.rankId === nextRank) return { ok: true, changed: false, profile: clone(profile) };
    const previousRankId = profile.rankId;
    profile.rankId = nextRank;
    profile.updatedAt = new Date(this.now()).toISOString();
    this.audit(state, 'linked-rank-updated', { discordUserId: discordId, previousRankId, rankId: nextRank, source: cleanId(source, 64) });
    this.write(state);
    return { ok: true, changed: true, profile: clone(profile) };
  }

  unlinkArk({ discordUserId, eosId, actorId = '', reason = '' } = {}) {
    const discordId = cleanId(discordUserId);
    const arkId = cleanId(eosId);
    const state = this.read();
    const profile = state.profiles[discordId];
    if (!profile || state.arkIndex[arkId] !== discordId) return { ok: false, reason: 'link-not-found' };
    profile.arkAccounts = profile.arkAccounts.filter((item) => item.eosId !== arkId);
    profile.updatedAt = new Date(this.now()).toISOString();
    delete state.arkIndex[arkId];
    this.audit(state, 'ark-account-unlinked', { discordUserId: discordId, eosId: arkId, actorId: cleanId(actorId), reason: cleanId(reason, 240) });
    this.write(state);
    return { ok: true, profile: clone(profile) };
  }
}

module.exports = { CODE_ALPHABET, DEFAULT_TTL_MS, MAX_CHALLENGES, CHALLENGE_RETENTION_MS, IdentityStateError, emptyIdentityState, validDiscordId, validEosId, pruneChallenges, normalizeIdentityState, ArkIdentityStore };
