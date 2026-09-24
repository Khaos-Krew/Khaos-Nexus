'use strict';

class TtlCache {
  constructor({ ttlMs = 60_000, now = () => Date.now(), load } = {}) {
    if (typeof load !== 'function') throw new Error('Cache load function is required.');
    this.ttlMs = Math.max(1000, Number(ttlMs) || 60_000);
    this.now = now;
    this.load = load;
    this.value = null;
    this.at = 0;
    this.pending = null;
  }

  fresh() {
    return Boolean(this.value) && this.now() - this.at < this.ttlMs;
  }

  async get() {
    if (this.fresh()) return { value: this.value, cached: true };
    if (this.pending) return this.pending;
    this.pending = (async () => {
      try {
        this.value = await this.load();
        this.at = this.now();
        return { value: this.value, cached: false };
      } finally {
        this.pending = null;
      }
    })();
    return this.pending;
  }
}

module.exports = { TtlCache };
