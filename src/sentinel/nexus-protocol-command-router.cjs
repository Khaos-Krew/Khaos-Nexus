'use strict';

const { normalizeCommandIntent } = require('./nexus-protocol-commands.cjs');
const { ACTIONS, readProtocolAction, planDarkZoneAction } = require('./nexus-protocol-controller.cjs');

function assertParticipantProgressModel(model, accountId) {
  if (!model || model.kind !== 'protocol-participant-progress-view' || Number(model.version) !== 1
    || model.visibility !== 'ephemeral' || model.staleCheckRequired !== true || model.readOnly !== true
    || model.authorizesMutation !== false || model.rewardAuthority !== false
    || model.mutatesPersistence !== false || model.executesServerCommand !== false) {
    throw new Error('Invalid Protocol participant progress read model');
  }
  if (String(model.accountId) !== String(accountId) || String(model.viewerAccountId) !== String(accountId)) {
    throw new Error('Protocol participant progress read model is not bound to the linked account');
  }
  return true;
}

function routeProtocolCommand(input = {}, context = {}) {
  const intent = normalizeCommandIntent(input);
  const shared = {
    snapshot: context.snapshot || {},
    now: context.now,
    accountId: intent.accountId || undefined
  };

  if (intent.kind === 'read' && intent.target === 'protocol_status') {
    return readProtocolAction(ACTIONS.REFRESH, shared);
  }

  if (intent.kind === 'read' && intent.target === 'participant_progress') {
    if (intent.requiresFreshParticipantSnapshot !== true || intent.ephemeral !== true) {
      throw new Error('Protocol progress intent is missing freshness or privacy requirements');
    }
    assertParticipantProgressModel(context.participantProgressModel, intent.accountId);
    return Object.freeze({
      kind: 'view',
      ephemeral: true,
      staleCheckRequired: true,
      accountId: intent.accountId,
      payload: context.participantProgressModel,
      readOnly: true,
      authorizesMutation: false
    });
  }

  if (intent.kind === 'read' && intent.target === 'leaderboard') {
    return readProtocolAction(ACTIONS.LEADERBOARD, {
      ...shared,
      seasonId: context.seasonId,
      leaderboardRows: context.leaderboardRows
    });
  }

  if (intent.kind === 'read' && intent.target === 'dark_zone') {
    return readProtocolAction(ACTIONS.DARK_ZONE, shared);
  }

  if (intent.kind === 'mutation-plan' && intent.target === 'dark_zone_enlist') {
    return planDarkZoneAction(intent.mode === 'tribe' ? ACTIONS.ENLIST_TRIBE : ACTIONS.ENLIST_SOLO, {
      ...shared,
      enlistDelayMs: context.enlistDelayMs
    });
  }

  if (intent.kind === 'mutation-plan' && intent.target === 'dark_zone_withdraw') {
    return planDarkZoneAction(ACTIONS.WITHDRAW, {
      ...shared,
      combatLockMs: context.combatLockMs,
      withdrawalCooldownMs: context.withdrawalCooldownMs
    });
  }

  throw new Error('Unsupported Nexus Protocol command intent');
}

module.exports = { assertParticipantProgressModel, routeProtocolCommand };
