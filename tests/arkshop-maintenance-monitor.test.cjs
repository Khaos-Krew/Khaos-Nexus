'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STARTUP_TASK_ID,
  INITIAL_DELAY_MS,
  REFRESH_MS,
  inspectArkShopMaintenance,
  startArkShopMaintenanceMonitor,
  installArkShopMaintenanceMonitor
} = require('../src/sentinel/arkshop-maintenance-monitor.cjs');
const {
  runStartupTasks,
  startupDiagnostics,
  resetStartupCoordinatorForTests
} = require('../src/sentinel/startup-coordinator.cjs');

test.beforeEach(() => resetStartupCoordinatorForTests());

test('ArkShop maintenance monitor detects drift and never mutates live state', async () => {
  const servers = [
    { id: 'gen1', name: 'MAP1', envPrefix: 'ARK_GEN1', enabled: true },
    { id: 'map2', name: 'MAP2', envPrefix: 'ARK_MAP2', enabled: false }
  ];
  const result = await inspectArkShopMaintenance({
    registry: { list: ({ includeDisabled }) => includeDisabled ? servers : servers.filter((server) => server.enabled) },
    control: {
      env: {},
      async shopStatus(server) {
        assert.equal(server.id, 'gen1');
        return {
          state: 'drift-detected', drift: true,
          profile: { id: 'arkshop-live', revision: 8 },
          liveCounts: { kits: 5, shopItems: 40, sellItems: 20 },
          database: { ready: true }
        };
      }
    }
  });
  assert.equal(result.maps, 1);
  assert.equal(result.ready, 0);
  assert.equal(result.drift, 1);
  assert.equal(result.attention, 1);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.llmCalls, 0);
});

test('ArkShop maintenance monitor reports incompatible providers without calling ArkShop controls', async () => {
  let calls = 0;
  const result = await inspectArkShopMaintenance({
    registry: { list: () => [{ id: 'map2', envPrefix: 'ARK_MAP2', enabled: true }] },
    control: {
      env: { ARK_MAP2_ARKSHOP_CONFIG_PATH: 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ark_web_shopV2.1.1/ArkWebShopAsa/config.json' },
      async shopStatus() { calls += 1; }
    }
  });
  assert.equal(calls, 0);
  assert.equal(result.results[0].state, 'provider-incompatible');
  assert.equal(result.mutationPerformed, false);
});

test('ArkShop maintenance monitor preserves startup and periodic scheduling without a direct Discord ready listener', () => {
  const scheduled = [];
  const handle = () => ({ unref() {} });
  startArkShopMaintenanceMonitor({
    registry: { list: () => [] },
    control: { env: {} },
    setTimeoutFn(fn, delay) {
      scheduled.push({ type: 'timeout', fn, delay });
      return handle();
    },
    setIntervalFn(fn, delay) {
      scheduled.push({ type: 'interval', fn, delay });
      return handle();
    }
  });

  assert.deepEqual(scheduled.map(({ type, delay }) => ({ type, delay })), [
    { type: 'timeout', delay: INITIAL_DELAY_MS },
    { type: 'interval', delay: REFRESH_MS }
  ]);
});

test('ArkShop maintenance monitor registers one idempotent startup coordinator task', async () => {
  const first = installArkShopMaintenanceMonitor();
  const second = installArkShopMaintenanceMonitor();
  const before = startupDiagnostics();

  assert.deepEqual(first, { installed: true, coordinated: true });
  assert.deepEqual(second, { installed: false, coordinated: true });
  assert.equal(before.taskCount, 1);
  assert.equal(before.tasks[0].id, STARTUP_TASK_ID);
  assert.equal(before.tasks[0].owner, 'arkshop');
  assert.equal(before.tasks[0].status, 'registered');

  const originalTimeout = global.setTimeout;
  const originalInterval = global.setInterval;
  global.setTimeout = () => ({ unref() {} });
  global.setInterval = () => ({ unref() {} });
  try {
    await runStartupTasks(null);
  } finally {
    global.setTimeout = originalTimeout;
    global.setInterval = originalInterval;
  }

  const after = startupDiagnostics();
  assert.equal(after.tasks[0].status, 'complete');
  assert.equal(after.tasks[0].executionCount, 1);
});
