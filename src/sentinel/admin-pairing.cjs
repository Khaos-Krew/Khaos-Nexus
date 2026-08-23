'use strict';

const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function cleanCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
}

function hashCode(value) {
  return crypto.createHash('sha256').update(cleanCode(value), 'utf8').digest('hex');
}

function randomPart(length = 4) {
  let value = '';
  for (let index = 0; index < length; index += 1) value += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return value;
}

class AdminPairingStore {
  constructor(options = {}) {
    this.ttlMs = Math.max(60_000, Number(options.ttlMs || 5 * 60_000));
    this.maxActive = Math.max(1, Number(options.maxActive || 20));
    this.entries = new Map();
  }

  prune(now = Date.now()) {
    for (const [hash, item] of this.entries) if (item.expiresAt <= now) this.entries.delete(hash);
    while (this.entries.size > this.maxActive) this.entries.delete(this.entries.keys().next().value);
  }

  create(actorId = '') {
    this.prune();
    const code = `NXA-${randomPart()}-${randomPart()}`;
    const expiresAt = Date.now() + this.ttlMs;
    this.entries.set(hashCode(code), { actorId: String(actorId || ''), expiresAt });
    this.prune();
    return { code, expiresAt: new Date(expiresAt).toISOString() };
  }

  consume(code) {
    this.prune();
    const key = hashCode(code);
    const item = this.entries.get(key) || null;
    if (!item) return null;
    this.entries.delete(key);
    if (item.expiresAt <= Date.now()) return null;
    return { ...item };
  }
}

const adminPairingStore = new AdminPairingStore();

module.exports = { ALPHABET, AdminPairingStore, adminPairingStore, cleanCode, hashCode };
