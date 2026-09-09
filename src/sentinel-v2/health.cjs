'use strict';

function createHealthState({ service = 'nexus-sentinel', version = 'v2' } = {}) {
  const startedAt = Date.now();
  let ready = false;
  let details = {};

  return Object.freeze({
    markReady(nextDetails = {}) {
      ready = true;
      details = { ...details, ...nextDetails };
    },
    markNotReady(reason, nextDetails = {}) {
      ready = false;
      details = { ...details, ...nextDetails, reason: reason || 'not-ready' };
    },
    live() {
      return {
        ok: true,
        service,
        version,
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      };
    },
    ready() {
      return {
        ok: ready,
        service,
        version,
        ...details,
      };
    },
  });
}

module.exports = { createHealthState };
