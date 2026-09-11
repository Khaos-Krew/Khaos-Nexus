'use strict';

const {
  ECONOMY_RUNTIME_MODES,
  normalizeMode,
  evaluateNexusEconomyActivation
} = require('./nexus-economy-activation-gate.cjs');
const {
  inspectNexusEconomyReadiness
} = require('./nexus-economy-readiness.cjs');

async function inspectNexusEconomyRuntimeStatus({ pool, schema = 'public', env = process.env } = {}) {
  // Validate runtime mode before touching Postgres. An explicitly-off runtime
  // should remain completely inert, and invalid configuration must fail fast.
  const mode = normalizeMode(env.NEXUS_ECONOMY_RUNTIME_MODE);

  if (mode === ECONOMY_RUNTIME_MODES.OFF) {
    const activation = evaluateNexusEconomyActivation({ readiness: null, env });
    return Object.freeze({
      mode,
      ready: false,
      databaseChecked: false,
      mutationAllowed: false,
      activation
    });
  }

  let readiness;
  try {
    readiness = await inspectNexusEconomyReadiness({ pool, schema });
  } catch (_error) {
    // Runtime-status inspection is an observability path. Database errors are
    // converted into a deterministic fail-closed state without exposing
    // connection details or allowing activation to proceed.
    readiness = Object.freeze({
      ready: false,
      databaseReady: false,
      schema: String(schema || 'public').trim(),
      relations: null,
      missing: [],
      checkedAt: new Date().toISOString(),
      mutationPerformed: false,
      probeFailed: true
    });
  }

  const activation = evaluateNexusEconomyActivation({ readiness, env });

  return Object.freeze({
    mode,
    ready: activation.allowed === true,
    databaseChecked: true,
    mutationAllowed: activation.mutationAllowed === true,
    activation,
    readiness
  });
}

module.exports = {
  inspectNexusEconomyRuntimeStatus
};
