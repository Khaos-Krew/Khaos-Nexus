'use strict';

function safeText(value, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function evaluateManualForgeSubmission(prepared = {}, context = {}) {
  const blockers = [];
  const incident = prepared.incident || {};
  const decision = prepared.decision || {};
  const handoff = prepared.handoff || null;
  const forgeConfig = context.forgeConfig || {};
  const actorId = safeText(context.actorId, 80);

  if (!incident.id) blockers.push('incident-missing');
  if (incident.status !== 'open') blockers.push('incident-not-open');
  if (!decision.mayPrepareManualHandoff) blockers.push('policy-blocked');
  if (!handoff) blockers.push('handoff-missing');
  if (!actorId) blockers.push('actor-missing');
  if (!forgeConfig.enabled) blockers.push('forge-disabled');
  if (!forgeConfig.baseUrlConfigured) blockers.push('forge-endpoint-missing');
  if (!forgeConfig.tokenConfigured) blockers.push('forge-token-missing');

  const action = handoff?.command === 'forge repair' ? 'repair' : handoff?.command === 'forge build' ? 'build' : '';
  if (!action) blockers.push('unsupported-handoff');
  if (action === 'repair' && !/^forge\/[A-Za-z0-9._/-]+$/.test(String(handoff?.branch || ''))) blockers.push('invalid-repair-branch');
  if (!safeText(handoff?.goal, 12000)) blockers.push('goal-missing');

  return {
    version: 1,
    allowed: blockers.length === 0,
    action,
    actorId: actorId || null,
    incidentId: safeText(incident.id, 40) || null,
    branch: action === 'repair' ? safeText(handoff?.branch, 240) || null : null,
    goal: safeText(handoff?.goal, 12000),
    requiresInteractiveConfirmation: true,
    automaticSubmissionAllowed: false,
    automaticExecutionAllowed: false,
    automaticMergeAllowed: false,
    automaticDeployAllowed: false,
    automaticRestartAllowed: false,
    blockers
  };
}

module.exports = {
  safeText,
  evaluateManualForgeSubmission
};
