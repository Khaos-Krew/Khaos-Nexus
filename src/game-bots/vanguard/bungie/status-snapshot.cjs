'use strict';

let snapshot = {
  configured: false,
  rps: 5,
  inFlight: 0,
  requests: 0,
  manifestVersion: '',
  degraded: false,
  reason: ''
};

function updateBungieStatus(partial = {}) {
  snapshot = { ...snapshot, ...partial };
  return snapshot;
}

function bungieStatus() {
  return { ...snapshot };
}

function resetBungieStatus() {
  snapshot = {
    configured: false,
    rps: 5,
    inFlight: 0,
    requests: 0,
    manifestVersion: '',
    degraded: false,
    reason: ''
  };
  return snapshot;
}

module.exports = { updateBungieStatus, bungieStatus, resetBungieStatus };
