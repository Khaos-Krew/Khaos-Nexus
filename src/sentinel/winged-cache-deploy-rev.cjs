'use strict';

// Deployment marker for the Winged Cache rollout. Keeping this under src/**
// guarantees Railway rebuilds the current branch head, including config/ark/**.
module.exports = Object.freeze({
  feature: 'winged-cache',
  revision: '2026-09-07-live-1'
});
