'use strict';

const {
  HEALTH_STATES,
  getNexusEconomyHealthSnapshot
} = require('./nexus-economy-health-snapshot.cjs');

function isHealthyEconomyState(state) {
  return state !== HEALTH_STATES.DEGRADED;
}

async function getNexusEconomyHealthIndicator(options = {}) {
  const snapshot = await getNexusEconomyHealthSnapshot(options);

  return Object.freeze({
    component: snapshot.component,
    healthy: isHealthyEconomyState(snapshot.state),
    state: snapshot.state,
    mode: snapshot.mode,
    ready: snapshot.ready,
    mutationAllowed: snapshot.mutationAllowed,
    reason: snapshot.reason
  });
}

module.exports = {
  isHealthyEconomyState,
  getNexusEconomyHealthIndicator
};
