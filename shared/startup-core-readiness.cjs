'use strict';

const REQUIRED_CHECKS = Object.freeze({
  'profile-location': Object.freeze(['pass']),
  'config-file': Object.freeze(['pass', 'warn']),
  'data-integrity': Object.freeze(['pass']),
  'data-write': Object.freeze(['pass']),
  'secure-storage': Object.freeze(['pass', 'warn']),
  'config-store': Object.freeze(['pass']),
  'renderer-bridge': Object.freeze(['pass'])
});

const NON_BLOCKING_CHECKS = Object.freeze(new Set([
  'discord-restore',
  'renderer-modules',
  'startup-timeout'
]));

function checkMap(health) {
  return new Map((health?.checks || []).map((check) => [String(check?.id || ''), check]));
}

function readiness(health) {
  const checks = checkMap(health);
  const blockers = [];

  if (!health?.configStoreReady) blockers.push('configuration services are not ready');
  if (!health?.rendererBridgeReady) blockers.push('the protected renderer bridge is not ready');

  for (const [id, allowedStatuses] of Object.entries(REQUIRED_CHECKS)) {
    const check = checks.get(id);
    if (!check) {
      blockers.push(`${id} has not reported`);
      continue;
    }
    if (!allowedStatuses.includes(String(check.status || ''))) {
      blockers.push(`${id} is ${check.status || 'unknown'}`);
    }
  }

  for (const check of health?.checks || []) {
    if (!check?.critical || check.status !== 'fail' || NON_BLOCKING_CHECKS.has(check.id)) continue;
    blockers.push(`${check.id} failed: ${check.detail || check.label || 'unknown failure'}`);
  }

  return {
    ready: blockers.length === 0,
    blockers,
    discordDesktopSignInRequired: false,
    optionalModuleCompletionRequired: false
  };
}

module.exports = {
  REQUIRED_CHECKS,
  NON_BLOCKING_CHECKS,
  checkMap,
  readiness
};
