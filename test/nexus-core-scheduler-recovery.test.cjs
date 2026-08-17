'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ServerSchedulerService } = require('../main/services/server-scheduler-service.cjs');
const {
  recoverInterruptedSchedulerState,
  INTERRUPTED_SUMMARY
} = require('../main/nexus-core-scheduler-gateway-extension.cjs');

function createService({ history = [], runtime = { occurrences: {} } } = {}) {
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-nexus-scheduler-recovery-'));
  fs.writeFileSync(path.join(dataDirectory, 'server-scheduler-history.json'), JSON.stringify(history, null, 2), 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'server-scheduler-state.json'), JSON.stringify(runtime, null, 2), 'utf8');
  const warnings = [];
  const configStore = {
    getSchedulerConfig: () => ({ settings: { historyLimit: 150, enabled: true }, schedules: [] })
  };
  const service = new ServerSchedulerService({
    dataDirectory,
    configStore,
    logger: { warn: (message, meta) => warnings.push({ message, meta }) },
    autonomy: null,
    now: () => Date.parse('2026-08-11T07:00:00Z'),
    intervalFactory: () => ({ unref() {} }),
    clearIntervalFactory: () => {},
    sleep: async () => {}
  });
  return { dataDirectory, service, warnings };
}

test('scheduled occurrence interrupted after final start is failed closed instead of replayed', () => {
  const { service, dataDirectory, warnings } = createService({
    history: [{
      id: 'scheduler-run-1',
      scheduleId: 'daily-restart',
      scheduleName: 'Daily Restart',
      occurrenceKey: 'daily-restart:2026-08-11:0600',
      source: 'scheduled',
      action: 'restart',
      serverIds: ['rag-01'],
      startedAt: '2026-08-11T06:00:00Z',
      completedAt: null,
      outcome: 'running',
      stage: 'shutdown',
      summary: 'Sending shutdown.',
      details: []
    }],
    runtime: {
      occurrences: {
        'daily-restart:2026-08-11:0600': {
          warningsSent: [30, 15, 5, 1],
          finalStarted: true,
          completed: false,
          outcome: null,
          historyId: 'scheduler-run-1',
          updatedAt: '2026-08-11T06:00:00Z'
        }
      }
    }
  });

  const result = recoverInterruptedSchedulerState(service);
  assert.deepEqual(result, { recoveredOccurrences: 1, recoveredHistory: 1 });

  const occurrence = service.runtime.occurrences['daily-restart:2026-08-11:0600'];
  assert.equal(occurrence.completed, true);
  assert.equal(occurrence.outcome, 'failed');
  assert.equal(occurrence.recoveryReason, 'interrupted-runtime');

  const history = service.history[0];
  assert.equal(history.outcome, 'failed');
  assert.equal(history.stage, 'completed');
  assert.equal(history.summary, INTERRUPTED_SUMMARY);
  assert.match(history.details.at(-1).message, /will not be replayed automatically/i);
  assert.equal(warnings.length, 1);

  const savedRuntime = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'server-scheduler-state.json'), 'utf8'));
  const savedHistory = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'server-scheduler-history.json'), 'utf8'));
  assert.equal(savedRuntime.occurrences['daily-restart:2026-08-11:0600'].completed, true);
  assert.equal(savedHistory[0].outcome, 'failed');
});

test('manual running history is also reconciled without inventing a replay occurrence', () => {
  const { service } = createService({
    history: [{
      id: 'scheduler-run-manual',
      scheduleId: 'manual-maintenance',
      scheduleName: 'Manual Maintenance',
      occurrenceKey: 'manual-maintenance:manual:123',
      source: 'manual',
      action: 'save',
      serverIds: ['rag-01'],
      startedAt: '2026-08-11T06:30:00Z',
      completedAt: null,
      outcome: 'running',
      stage: 'saving',
      summary: 'Saving.',
      details: []
    }]
  });

  const result = recoverInterruptedSchedulerState(service);
  assert.deepEqual(result, { recoveredOccurrences: 0, recoveredHistory: 1 });
  assert.equal(service.history[0].outcome, 'failed');
  assert.equal(Object.keys(service.runtime.occurrences).length, 0);
});

test('completed and never-started occurrences are left untouched', () => {
  const { service, warnings } = createService({
    history: [{
      id: 'scheduler-run-complete',
      scheduleId: 'save',
      scheduleName: 'Save',
      occurrenceKey: 'save:2026-08-11:0600',
      source: 'scheduled',
      action: 'save',
      serverIds: ['rag-01'],
      startedAt: '2026-08-11T06:00:00Z',
      completedAt: '2026-08-11T06:01:00Z',
      outcome: 'success',
      stage: 'completed',
      summary: 'Done.',
      details: []
    }],
    runtime: {
      occurrences: {
        'save:2026-08-11:0600': {
          finalStarted: true,
          completed: true,
          outcome: 'success',
          historyId: 'scheduler-run-complete',
          updatedAt: '2026-08-11T06:01:00Z'
        },
        'restart:2026-08-11:0700': {
          finalStarted: false,
          completed: false,
          outcome: null,
          historyId: null,
          updatedAt: '2026-08-11T06:50:00Z'
        }
      }
    }
  });

  const before = JSON.stringify({ history: service.history, runtime: service.runtime });
  const result = recoverInterruptedSchedulerState(service);
  assert.deepEqual(result, { recoveredOccurrences: 0, recoveredHistory: 0 });
  assert.equal(JSON.stringify({ history: service.history, runtime: service.runtime }), before);
  assert.equal(warnings.length, 0);
});
