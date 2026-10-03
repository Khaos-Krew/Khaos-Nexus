'use strict';

const { THROTTLE_CAP_SECONDS } = require('./errors.cjs');

function createLimiter({ rps = 5, now = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const rate = Math.max(1, Math.min(10, Number(rps) || 5));
  const interval = 1000 / rate;
  let nextAt = 0;
  let chain = Promise.resolve();
  const lanes = new Map();
  let inFlight = 0;
  let requests = 0;

  function acquire(endpoint = '') {
    const lane = String(endpoint || '');
    const run = chain.then(async () => {
      const wait = Math.max(0, nextAt - now());
      if (wait > 0) await sleep(wait);
      const at = now();
      nextAt = at + interval;
      requests += 1;
      return at;
    });
    chain = run.then(() => undefined, () => undefined);
    return run.then(async () => {
      const extra = Math.max(0, (lanes.get(lane) || 0) - now());
      if (extra > 0) await sleep(extra);
      return now();
    });
  }

  function pause(endpoint, seconds) {
    const lane = String(endpoint || '');
    const span = Math.min(THROTTLE_CAP_SECONDS, Number(seconds));
    if (!lane || !(span > 0)) return;
    const until = now() + (span * 1000);
    lanes.set(lane, Math.max(lanes.get(lane) || 0, until));
  }

  function enter() {
    inFlight += 1;
  }

  function leave() {
    inFlight = Math.max(0, inFlight - 1);
  }

  function stats() {
    return {
      rps: rate,
      inFlight,
      requests,
      paused: [...lanes.entries()].filter(([, until]) => until > now()).map(([endpoint]) => endpoint)
    };
  }

  return { acquire, pause, enter, leave, stats };
}

module.exports = { createLimiter };
