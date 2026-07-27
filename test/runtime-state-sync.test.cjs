'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('supervisor publishes the utility-process PID after Electron emits spawn', () => {
  const child = new EventEmitter();
  child.pid = undefined;
  child.stdout = null;
  child.stderr = null;
  child.postMessage = () => {};
  child.kill = () => true;

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        utilityProcess: { fork: () => child },
        app: { isPackaged: false }
      };
    }
    if (request.endsWith('/shared/redaction.cjs') || request.endsWith('\\shared\\redaction.cjs')) {
      return { errorFingerprint: () => 'test-error' };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let BotSupervisor;
  try {
    delete require.cache[require.resolve('../main/services/bot-supervisor.cjs')];
    ({ BotSupervisor } = require('../main/services/bot-supervisor.cjs'));
  } finally {
    Module._load = originalLoad;
  }

  const supervisor = new BotSupervisor({
    configStore: {
      getRuntimeBootstrap: () => ({ discordToken: 'protected-test-token' }),
      getConfig: () => ({ general: { autoRestart: false }, monitor: { restartWindowMinutes: 5, maxRestarts: 3 } })
    },
    logger: {
      write: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      ingest: () => {}
    }
  });

  try {
    const starting = supervisor.start();
    assert.equal(starting.pid, null);
    child.pid = 5197;
    child.emit('spawn');
    assert.equal(supervisor.getState().pid, 5197);
  } finally {
    clearInterval(supervisor.watchdogTimer);
  }
});

test('Command Center ignores an older startup snapshot after a live state update', () => {
  const script = read('renderer/nexus-shell-v14.js');
  assert.match(script, /liveStateSeen/);
  assert.match(script, /source === 'snapshot' && state\.liveStateSeen/);
  assert.match(script, /onState\(\(next\) => applyAppState\(next, 'live'\)\)/);
  assert.match(script, /app:get-state'\)\.then\(\(next\) => applyAppState\(next, 'snapshot'\)\)/);
});

test('Command Center presents a connected supervised bot as online and healthy', () => {
  const script = read('renderer/nexus-shell-v14.js');
  assert.match(script, /bot\.ready && \['starting', 'connecting'\]\.includes\(rawBotStatus\) \? 'online'/);
  assert.match(script, /supervised and healthy/);
});
