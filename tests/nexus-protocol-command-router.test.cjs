'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { routeProtocolCommand } = require('../src/sentinel/nexus-protocol-command-router.cjs');
const { DARK_ZONE_STATES } = require('../src/sentinel/nexus-protocol-core.cjs');

function snapshot() {
  return {
    revision: 7,
    seasons: { current: { id: 'current', name: 'Current', startsAt: 1, endsAt: 0, status: 'active' } },
    protocolRuns: {}, participants: {}, darkZone: {}
  };
}

function progressModel(overrides = {}) {
  return {
    version: 1,
    kind: 'protocol-participant-progress-view',
    purpose: 'participant_progress_view',
    viewerAccountId: 'acct1',
    accountId: 'acct1',
    runId: 'run-1',
    ledgerRevision: 4,
    snapshotDigest: 'a'.repeat(64),
    progress: { activeMinutes: 20, objectiveContribution: 2, killContribution: 1, deaths: 0, completed: false, processedEvents: 4 },
    scoring: { eligible: true, score: 30, rawScore: 30, withheldScore: 0 },
    updatedAt: 1000,
    visibility: 'ephemeral',
    staleCheckRequired: true,
    readOnly: true,
    authorizesMutation: false,
    rewardAuthority: false,
    mutatesPersistence: false,
    executesServerCommand: false,
    ...overrides
  };
}

test('/protocol progress routes only an account-bound fresh ephemeral model', () => {
  const result = routeProtocolCommand({ command: 'protocol', subcommand: 'progress', accountId: 'acct1' }, {
    snapshot: snapshot(), participantProgressModel: progressModel()
  });
  assert.equal(result.kind, 'view');
  assert.equal(result.ephemeral, true);
  assert.equal(result.staleCheckRequired, true);
  assert.equal(result.accountId, 'acct1');
  assert.equal(result.payload.kind, 'protocol-participant-progress-view');
  assert.equal(result.authorizesMutation, false);
});

test('/protocol progress rejects cross-account or mutation-capable models', () => {
  assert.throws(() => routeProtocolCommand({ command: 'protocol', subcommand: 'progress', accountId: 'acct1' }, {
    snapshot: snapshot(), participantProgressModel: progressModel({ viewerAccountId: 'acct2' })
  }), /not bound/);
  assert.throws(() => routeProtocolCommand({ command: 'protocol', subcommand: 'progress', accountId: 'acct1' }, {
    snapshot: snapshot(), participantProgressModel: progressModel({ authorizesMutation: true })
  }), /Invalid Protocol participant progress read model/);
});

test('Dark Zone enlist command produces a revision-bound confirmation plan only', () => {
  const result = routeProtocolCommand({ command: 'darkzone', subcommand: 'enlist', accountId: 'acct1', mode: 'solo' }, {
    snapshot: snapshot(), now: 1000, enlistDelayMs: 5000
  });
  assert.equal(result.kind, 'mutation-plan');
  assert.equal(result.expectedRevision, 7);
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.current.state, DARK_ZONE_STATES.SAFE);
  assert.equal(result.next.state, DARK_ZONE_STATES.ENLISTING);
});

test('Dark Zone status and Protocol Score remain read-only views', () => {
  const dz = routeProtocolCommand({ command: 'darkzone', subcommand: 'status', accountId: 'acct1' }, {
    snapshot: snapshot(), now: 1000
  });
  assert.equal(dz.kind, 'view');
  assert.equal(dz.ephemeral, true);

  const leaderboard = routeProtocolCommand({ command: 'protocolscore', subcommand: 'leaderboard', accountId: 'acct1' }, {
    snapshot: snapshot(), now: 1000,
    leaderboardRows: [{ rank: 1, accountId: 'acct1', score: 50, runs: 1 }]
  });
  assert.equal(leaderboard.kind, 'view');
  assert.equal(leaderboard.ephemeral, true);
});

test('unlinked progress and malformed commands fail closed before routing', () => {
  assert.throws(() => routeProtocolCommand({ command: 'protocol', subcommand: 'progress' }, { snapshot: snapshot() }), /linked account/);
  assert.throws(() => routeProtocolCommand({ command: 'protocol', subcommand: 'bogus', accountId: 'acct1' }, { snapshot: snapshot() }), /Invalid protocol subcommand/);
});
