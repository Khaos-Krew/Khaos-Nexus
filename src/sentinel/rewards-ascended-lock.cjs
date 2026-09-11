'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
const tails = new Map();
// Both delivery adapters share this lane, including config write, reload and reward send.
// Sentinel remains one replica; distinct maps may run concurrently.
function withRewardsLock(prefix, fn) {
  const key = String(prefix).trim().toUpperCase();
  if (context.getStore() === key) return fn();
  const prior = tails.get(key) || Promise.resolve();
  const next = prior.catch(() => {}).then(() => context.run(key, fn));
  tails.set(key, next);
  return next.finally(() => { if (tails.get(key) === next) tails.delete(key); });
}
module.exports = { withRewardsLock };
