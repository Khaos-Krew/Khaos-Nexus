'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { TAG_CAP } = require('./tag-validate.cjs');

const DISCORD_ID = /^\d{15,24}$/;
const GAME_ID = /^[a-z0-9_]{1,32}$/;
const PLATFORM_TAG_MAX = 96;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(fn) {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(() => {}, () => {});
    return run;
  }
}

function atomicWrite(filePath, contents) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, `${filePath}.bak`);
  fs.renameSync(tmp, filePath);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return { missing: true };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { invalid: true };
    return { value: parsed };
  } catch {
    return { invalid: true };
  }
}

function emptyState() {
  return { version: 1, users: {} };
}

function assertDiscordId(value) {
  const id = String(value || '').trim();
  if (!DISCORD_ID.test(id)) {
    const error = new Error('A valid Discord user ID is required.');
    error.reason = 'invalid-user';
    throw error;
  }
  return id;
}

function assertGameId(value) {
  const id = String(value || '').trim();
  if (!GAME_ID.test(id)) {
    const error = new Error('Unknown game.');
    error.reason = 'unknown-game';
    throw error;
  }
  return id;
}

class JsonCardStore {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.maxTags = Number.isInteger(options.maxTags) ? options.maxTags : TAG_CAP;
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
    this.mutex = new Mutex();
    this.listeners = [];
    this.state = this.#load();
  }

  onUserChanged(listener) {
    if (typeof listener === 'function') this.listeners.push(listener);
  }

  #notify(userId) {
    if (!this.listeners.length) return;
    let record;
    try { record = this.getUser(userId); } catch { return; }
    for (const listener of this.listeners) {
      try { listener(userId, record); } catch (error) {
        console.error(`[Player Card] store listener failed: ${String(error?.message || error).slice(0, 180)}`);
      }
    }
  }

  #commit(userId) {
    this.#persist();
    this.#notify(userId);
  }

  #load() {
    const main = readJson(this.filePath);
    if (main.value) return this.#normalize(main.value);
    if (!main.missing && main.invalid) {
      const bak = readJson(`${this.filePath}.bak`);
      if (bak.value) {
        console.error('[Player Card] cards.json was unreadable. Loaded the .bak copy.');
        return this.#normalize(bak.value);
      }
      console.error('[Player Card] cards.json was unreadable and no .bak copy was usable.');
    }
    return emptyState();
  }

  #normalize(parsed) {
    const users = parsed.users && typeof parsed.users === 'object' && !Array.isArray(parsed.users) ? parsed.users : {};
    const next = emptyState();
    for (const [userId, record] of Object.entries(users)) {
      if (!DISCORD_ID.test(userId) || !record || typeof record !== 'object') continue;
      next.users[userId] = this.#normalizeUser(userId, record);
    }
    return next;
  }

  #normalizeUser(userId, record) {
    const tags = {};
    const source = record.tags && typeof record.tags === 'object' && !Array.isArray(record.tags) ? record.tags : {};
    for (const [gameId, value] of Object.entries(source)) {
      if (!GAME_ID.test(gameId) || !value || typeof value !== 'object') continue;
      const tag = String(value.tag || '');
      if (!tag || tag.length > 64) continue;
      const entry = {
        tag,
        verified: false,
        updatedAt: String(value.updatedAt || '') || null
      };
      if (gameId === 'other') {
        const game = String(value.game || '').trim();
        if (!game || game.length > 64) continue;
        entry.game = game;
      }
      tags[gameId] = entry;
    }
    const platforms = {};
    const platformSource = record.platforms && typeof record.platforms === 'object' && !Array.isArray(record.platforms)
      ? record.platforms
      : {};
    for (const [platformId, value] of Object.entries(platformSource)) {
      if (!GAME_ID.test(platformId) || !value || typeof value !== 'object') continue;
      const tag = String(value.tag || '');
      if (!tag || tag.length > PLATFORM_TAG_MAX) continue;
      platforms[platformId] = {
        tag,
        verified: false,
        updatedAt: String(value.updatedAt || '') || null
      };
    }
    return {
      hidden: record.hidden === true,
      findable: record.findable === true,
      tags,
      platforms,
      updatedAt: String(record.updatedAt || '') || null,
      userId
    };
  }

  #persist() {
    const payload = {
      version: 1,
      users: {}
    };
    for (const [userId, record] of Object.entries(this.state.users)) {
      const row = {
        hidden: record.hidden === true,
        tags: clone(record.tags),
        platforms: clone(record.platforms || {}),
        updatedAt: record.updatedAt
      };
      if (record.findable === true) row.findable = true;
      payload.users[userId] = row;
    }
    atomicWrite(this.filePath, `${JSON.stringify(payload, null, 2)}\n`);
  }

  #ensure(userId) {
    if (!this.state.users[userId]) {
      this.state.users[userId] = { hidden: false, findable: false, tags: {}, platforms: {}, updatedAt: null, userId };
    }
    return this.state.users[userId];
  }

  getUser(userId) {
    const id = assertDiscordId(userId);
    const record = this.state.users[id];
    if (!record) return { hidden: false, findable: false, tags: {}, platforms: {}, updatedAt: null };
    return {
      hidden: record.hidden === true,
      findable: record.findable === true,
      tags: clone(record.tags),
      platforms: clone(record.platforms || {}),
      updatedAt: record.updatedAt
    };
  }

  userIds() {
    return Object.keys(this.state.users);
  }

  listTags(userId) {
    const user = this.getUser(userId);
    return Object.entries(user.tags).map(([gameId, value]) => ({ gameId, ...value }));
  }

  async setTag(userId, gameId, input = {}) {
    const id = assertDiscordId(userId);
    const game = assertGameId(gameId);
    const tag = String(input.tag || '');
    if (!tag || tag.length > 64) return { ok: false, reason: 'pattern' };
    let otherName = '';
    if (game === 'other') {
      otherName = String(input.game || input.name || '').trim();
      if (otherName.length < 2 || otherName.length > 64) return { ok: false, reason: 'name-empty' };
    }
    return this.mutex.run(() => {
      const user = this.#ensure(id);
      if (!Object.prototype.hasOwnProperty.call(user.tags, game) && Object.keys(user.tags).length >= this.maxTags) {
        return { ok: false, reason: 'tag-cap' };
      }
      const oldTag = user.tags[game]?.tag || null;
      const updatedAt = new Date(this.now()).toISOString();
      const record = { tag, verified: false, updatedAt };
      if (game === 'other') record.game = otherName;
      user.tags[game] = record;
      user.updatedAt = updatedAt;
      this.#commit(id);
      return { ok: true, game, oldTag, tag: clone(record) };
    });
  }

  async removeTag(userId, gameId) {
    const id = assertDiscordId(userId);
    const game = assertGameId(gameId);
    return this.mutex.run(() => {
      const user = this.state.users[id];
      if (!user?.tags?.[game]) return { ok: false, reason: 'not-linked' };
      const removed = clone(user.tags[game]);
      delete user.tags[game];
      user.updatedAt = new Date(this.now()).toISOString();
      this.#commit(id);
      return { ok: true, game, removed };
    });
  }

  listPlatforms(userId) {
    const user = this.getUser(userId);
    return Object.entries(user.platforms).map(([platformId, value]) => ({ platformId, ...value }));
  }

  async setPlatform(userId, platformId, input = {}) {
    const id = assertDiscordId(userId);
    const platform = assertGameId(platformId);
    const tag = String(input.tag || '');
    if (!tag || tag.length > PLATFORM_TAG_MAX) return { ok: false, reason: 'pattern' };
    return this.mutex.run(() => {
      const user = this.#ensure(id);
      if (!user.platforms) user.platforms = {};
      const oldTag = user.platforms[platform]?.tag || null;
      const updatedAt = new Date(this.now()).toISOString();
      const record = { tag, verified: false, updatedAt };
      user.platforms[platform] = record;
      user.updatedAt = updatedAt;
      this.#commit(id);
      return { ok: true, platform, oldTag, tag: clone(record) };
    });
  }

  async removePlatform(userId, platformId) {
    const id = assertDiscordId(userId);
    const platform = assertGameId(platformId);
    return this.mutex.run(() => {
      const user = this.state.users[id];
      if (!user?.platforms?.[platform]) return { ok: false, reason: 'not-linked' };
      const removed = clone(user.platforms[platform]);
      delete user.platforms[platform];
      user.updatedAt = new Date(this.now()).toISOString();
      this.#commit(id);
      return { ok: true, platform, removed };
    });
  }

  async setHidden(userId, hidden) {
    const id = assertDiscordId(userId);
    return this.mutex.run(() => {
      const user = this.#ensure(id);
      user.hidden = hidden === true;
      user.updatedAt = new Date(this.now()).toISOString();
      this.#commit(id);
      return { ok: true, hidden: user.hidden };
    });
  }

  async setFindable(userId, findable) {
    const id = assertDiscordId(userId);
    return this.mutex.run(() => {
      const user = this.#ensure(id);
      user.findable = findable === true;
      user.updatedAt = new Date(this.now()).toISOString();
      this.#commit(id);
      return { ok: true, findable: user.findable === true };
    });
  }
}

module.exports = {
  Mutex,
  atomicWrite,
  JsonCardStore
};
