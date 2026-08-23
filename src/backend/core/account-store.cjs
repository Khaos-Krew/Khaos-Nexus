'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ACCOUNT_ROLES = new Set(['owner', 'co-owner']);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function safeText(value, max = 120) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function normalizeDiscordProfile(profile = {}) {
  const id = safeText(profile.id, 32);
  if (!/^\d{15,24}$/.test(id)) throw new Error('Discord user ID is invalid.');
  return {
    id,
    username: safeText(profile.username, 80),
    globalName: safeText(profile.globalName ?? profile.global_name, 80),
    avatar: safeText(profile.avatar, 160)
  };
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex');
}

function newCode(length = 8) {
  let code = '';
  for (let index = 0; index < length; index += 1) code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return code;
}

class AccountStore {
  constructor({ filePath, now = () => Date.now() } = {}) {
    if (!filePath) throw new Error('AccountStore requires filePath.');
    this.filePath = filePath;
    this.now = now;
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) this.write({ version: 1, accounts: [], pairingCodes: [] });
  }

  read() {
    this.ensure();
    const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    return {
      version: 1,
      accounts: Array.isArray(value.accounts) ? value.accounts : [],
      pairingCodes: Array.isArray(value.pairingCodes) ? value.pairingCodes : []
    };
  }

  write(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, this.filePath);
  }

  cleanup(state) {
    const now = this.now();
    state.pairingCodes = state.pairingCodes.filter((item) => Number(item.expiresAt || 0) > now && !item.usedAt);
    return state;
  }

  list() {
    const state = this.cleanup(this.read());
    this.write(state);
    return state.accounts.map((account) => ({ ...account }));
  }

  findByDiscordId(discordId) {
    const id = safeText(discordId, 32);
    return this.list().find((account) => account.discord?.id === id) || null;
  }

  createPairingCode(role = 'co-owner', ttlMs = 10 * 60 * 1000) {
    role = safeText(role, 32).toLowerCase();
    if (!ACCOUNT_ROLES.has(role)) throw new Error('Unsupported Nexus account role.');
    const state = this.cleanup(this.read());
    if (role === 'owner' && state.accounts.some((account) => account.role === 'owner')) {
      throw new Error('An Owner account already exists. Use Co-Owner for additional household access.');
    }
    const code = newCode();
    const createdAt = this.now();
    state.pairingCodes.push({
      id: crypto.randomUUID(),
      codeHash: hashCode(code),
      role,
      createdAt,
      expiresAt: createdAt + Math.max(60_000, Math.min(Number(ttlMs) || 600_000, 30 * 60_000))
    });
    this.write(state);
    return { code, role, expiresAt: createdAt + Math.max(60_000, Math.min(Number(ttlMs) || 600_000, 30 * 60_000)) };
  }

  redeemPairingCode(code, discordProfile) {
    const profile = normalizeDiscordProfile(discordProfile);
    const state = this.cleanup(this.read());
    const codeHash = hashCode(code);
    const invite = state.pairingCodes.find((item) => item.codeHash === codeHash && !item.usedAt && Number(item.expiresAt) > this.now());
    if (!invite) throw new Error('That Nexus link code is invalid or expired.');
    const existing = state.accounts.find((account) => account.discord?.id === profile.id);
    if (existing) {
      existing.discord = profile;
      existing.updatedAt = new Date(this.now()).toISOString();
      invite.usedAt = this.now();
      this.write(state);
      return { ...existing };
    }
    if (invite.role === 'owner' && state.accounts.some((account) => account.role === 'owner')) throw new Error('An Owner account already exists.');
    const timestamp = new Date(this.now()).toISOString();
    const account = {
      id: crypto.randomUUID(),
      role: invite.role,
      displayName: profile.globalName || profile.username || `Discord ${profile.id}`,
      discord: profile,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.accounts.push(account);
    invite.usedAt = this.now();
    this.write(state);
    return { ...account };
  }

  remove(accountId) {
    const id = safeText(accountId, 64);
    const state = this.cleanup(this.read());
    const account = state.accounts.find((item) => item.id === id);
    if (!account) return false;
    if (account.role === 'owner') throw new Error('The primary Owner account cannot be removed from this screen.');
    state.accounts = state.accounts.filter((item) => item.id !== id);
    this.write(state);
    return true;
  }
}

module.exports = { ACCOUNT_ROLES, AccountStore, hashCode, normalizeDiscordProfile };
