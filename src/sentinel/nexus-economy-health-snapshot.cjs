'use strict';

const {
  inspectNexusEconomyRuntimeStatus
} = require('./nexus-economy-runtime-status.cjs');

const HEALTH_STATES = Object.freeze({
  DISABLED: 'disabled',
  DEGRADED: 'degraded',
  READY: 'ready',
  ACTIVE: 'active'
});

function deriveState(status) {
  if (!status || status.mode === 'off') return HEALTH_STATES.DISABLED;
  if (status.mutationAllowed === true) return HEALTH_STATES.ACTIVE;
  if (status.ready === true) return HEALTH_STATES.READY;
  return HEALTH_STATES.DEGRADED;
}

async function getNexusEconomyHealthSnapshot({ pool, schema = 'public', env = process.env } = {}) {
  const status = await inspectNexusEconomyRuntimeStatus({ pool, schema, env });
  const activation = status.activation || {};

  return Object.freeze({
    component: 'nexus-economy',
    state: deriveState(status),
    mode: status.mode,
    databaseChecked: status.databaseChecked === true,
    ready: status.ready === true,
    mutationAllowed: status.mutationAllowed === true,
    reason: typeof activation.reason === 'string' ? activation.reason : 'unknown'
  });
}

module.exports = {
  HEALTH_STATES,
  deriveState,
  getNexusEconomyHealthSnapshot
};
