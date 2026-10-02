'use strict';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

function createCache({ ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const rows = new Map();

  function get(key) {
    const row = rows.get(String(key));
    if (!row) return undefined;
    if (now() >= row.expires) {
      rows.delete(String(key));
      return undefined;
    }
    return row.value;
  }

  function set(key, value, ttl = ttlMs) {
    rows.set(String(key), { value, expires: now() + ttl });
    return value;
  }

  function deleteKey(key) {
    rows.delete(String(key));
  }

  function clear() {
    rows.clear();
  }

  return { get, set, delete: deleteKey, clear, ttlMs };
}

module.exports = { DEFAULT_TTL_MS, createCache };
