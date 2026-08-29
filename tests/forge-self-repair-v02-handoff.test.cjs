'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { queuePreparedHandoff, formatPreparedHandoff } = require('../src/sentinel/forge-self-repair-extension.cjs');

test('Self-Repair prepare queues a durable V0.2 repair candidate without immediate model execution', async () => {
  const calls = [];
  const observer = {
    now: () => new Date('2026-08-29T04:30:00.000Z'),
    forge: {
      defaultRepo: 'Khaos-Krew/Khaos-Nexus',
      defaultBaseRef: 'rebuild/nexus-0.1',
      async queueRepairCandidate(options) {
        calls.push(options);
        return {
          ok: true,
          task: { id: 'task-123', state: 'queued' },
          approvalRequired: true,
          modelTokensConsumed: 0,
          execution: 'not-started'
        };
      }
    },
    audit(event) { calls.push({ audit: event }); }
  };
  const prepared = {
    incident: {
      id: 'SRI-ABC123',
      type: 'ci-failure',
      severity: 'high',
      evidence: {
        ref: 'rebuild/nexus-0.1',
        sha: 'abc123',
        failedChecks: [{ name: 'test', status: 'completed', conclusion: 'failure' }]
      }
    },
    decision: { mayPrepareManualHandoff: true, blockers: [] },
    candidate: { action: 'build', baseRef: 'rebuild/nexus-0.1', goal: 'Diagnose the failed check safely.' },
    handoff: { command: 'forge build', goal: 'Diagnose the failed check safely.' },
    aiInvoked: false
  };

  const result = await queuePreparedHandoff(observer, prepared, '12345');
  assert.equal(result.queued.task.id, 'task-123');
  assert.equal(result.queued.modelTokensConsumed, 0);
  assert.equal(result.queued.approvalRequired, true);
  assert.equal(calls[0].incidentId, 'SRI-ABC123');
  assert.equal(calls[0].actor, 'discord:12345');
  assert.equal(calls[0].baseRef, 'rebuild/nexus-0.1');
  assert.match(calls[0].evidence.join('\n'), /check=test/);
  const text = formatPreparedHandoff(result);
  assert.match(text, /task-123/);
  assert.match(text, /Approval required: \*\*Yes\*\*/);
  assert.match(text, /tokens used by preparation: \*\*0\*\*/i);
});

test('Self-Repair hold incidents do not queue a Forge task', async () => {
  let invoked = false;
  const observer = {
    forge: { async queueRepairCandidate() { invoked = true; } }
  };
  const prepared = {
    incident: { id: 'SRI-HOLD', type: 'ark-rcon-unavailable' },
    decision: { mayPrepareManualHandoff: false, blockers: ['hold-only'] },
    candidate: { action: 'hold', goal: 'Check RCON without restarting ARK.' },
    handoff: null
  };
  const result = await queuePreparedHandoff(observer, prepared, '1');
  assert.equal(invoked, false);
  assert.equal(result.queued, null);
});
