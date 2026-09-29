'use strict';

const { isSuffixSlot, lookupKey } = require('./lookup-key.cjs');

function entryId(userId, slot) {
  return `${userId}:${slot}`;
}

class TagIndex {
  constructor() {
    this.ready = false;
    this.full = new Map();
    this.base = new Map();
    this.meta = new Map();
    this.byUser = new Map();
  }

  rebuild(store) {
    this.full.clear();
    this.base.clear();
    this.meta.clear();
    this.byUser.clear();
    const ids = typeof store?.userIds === 'function' ? store.userIds() : [];
    for (const userId of ids) this.updateUser(userId, store.getUser(userId));
    this.ready = true;
    return this;
  }

  updateUser(userId, record) {
    const id = String(userId || '');
    this.removeUser(id);
    if (!record || typeof record !== 'object') return;
    const tags = record.tags && typeof record.tags === 'object' ? record.tags : {};
    const platforms = record.platforms && typeof record.platforms === 'object' ? record.platforms : {};
    for (const [gameId, value] of Object.entries(tags)) {
      this.#add(id, `game:${gameId}`, value?.tag, 'game', gameId);
    }
    for (const [platformId, value] of Object.entries(platforms)) {
      this.#add(id, `platform:${platformId}`, value?.tag, 'platform', platformId);
    }
  }

  removeUser(userId) {
    const ids = this.byUser.get(String(userId || ''));
    if (!ids) return;
    for (const id of ids) this.#drop(id);
    this.byUser.delete(String(userId || ''));
  }

  #add(userId, slot, tag, kind, id) {
    const text = String(tag || '');
    if (!text) return;
    const key = lookupKey(slot, text);
    if (!key.full) return;
    const token = entryId(userId, slot);
    const meta = {
      userId,
      slot,
      tag: text,
      kind,
      id,
      fullKey: key.full,
      baseKey: isSuffixSlot(slot) ? key.base : null
    };
    this.meta.set(token, meta);
    this.#link(this.full, key.full, token);
    if (meta.baseKey) this.#link(this.base, meta.baseKey, token);
    let owned = this.byUser.get(userId);
    if (!owned) {
      owned = new Set();
      this.byUser.set(userId, owned);
    }
    owned.add(token);
  }

  #link(map, key, token) {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(token);
  }

  #drop(token) {
    const meta = this.meta.get(token);
    if (!meta) return;
    this.#unlink(this.full, meta.fullKey, token);
    if (meta.baseKey) this.#unlink(this.base, meta.baseKey, token);
    this.meta.delete(token);
  }

  #unlink(map, key, token) {
    const set = map.get(key);
    if (!set) return;
    set.delete(token);
    if (!set.size) map.delete(key);
  }

  #kept(token, slot) {
    const meta = this.meta.get(token);
    if (!meta) return null;
    if (slot && meta.slot !== slot) return null;
    return meta;
  }

  findExact({ full, base, hasSuffix = false, slot = null } = {}) {
    const hits = [];
    const seen = new Set();
    const push = (token) => {
      if (seen.has(token)) return;
      const meta = this.#kept(token, slot);
      if (!meta) return;
      seen.add(token);
      hits.push(meta);
    };
    if (hasSuffix) {
      for (const token of this.full.get(full) || []) push(token);
      return hits;
    }
    for (const token of this.full.get(full) || []) {
      const meta = this.meta.get(token);
      if (meta && !isSuffixSlot(meta.slot)) push(token);
    }
    const baseKey = base || full;
    for (const token of this.base.get(baseKey) || []) {
      const meta = this.meta.get(token);
      if (meta && isSuffixSlot(meta.slot)) push(token);
    }
    return hits;
  }

  findPrefix({ prefix, hasSuffix = false, slot = null } = {}) {
    const needle = String(prefix || '');
    if (!needle) return [];
    const hits = [];
    for (const meta of this.meta.values()) {
      if (slot && meta.slot !== slot) continue;
      const key = hasSuffix ? meta.fullKey : (isSuffixSlot(meta.slot) ? meta.baseKey : meta.fullKey);
      if (key && key.startsWith(needle)) hits.push(meta);
    }
    return hits;
  }

  snapshot() {
    const rows = [];
    for (const [key, set] of this.full) {
      for (const token of set) rows.push(['full', key, token]);
    }
    for (const [key, set] of this.base) {
      for (const token of set) rows.push(['base', key, token]);
    }
    rows.sort((left, right) => left.join('\0').localeCompare(right.join('\0')));
    return rows;
  }
}

module.exports = { TagIndex };
