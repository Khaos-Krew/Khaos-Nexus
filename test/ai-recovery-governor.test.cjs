'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  GIB,
  RecoveryStore,
  authorizeRepair,
  assertWithinRoot,
  executeRepair,
  selectRuntimeBudget,
  selectModel,
  selectProvider
} = require('../shared/ai-recovery-governor.cjs');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

function snapshot(overrides = {}) {
  return {
    cpuThreads: 8,
    cpuLoad: 0.1,
    totalRamBytes: 32 * GIB,
    freeRamBytes: 16 * GIB,
    gpuAvailable: false,
    gpuTotalVramBytes: 0,
    gpuFreeVramBytes: 0,
    gpuLoad: 0,
    gameActive: false,
    ...overrides
  };
}

test('resource governor starts from a genuinely low-end CPU-only budget', () => {
  const result = selectRuntimeBudget(snapshot({
    cpuThreads: 2,
    totalRamBytes: 8 * GIB,
    freeRamBytes: 2.5 * GIB
  }));
  assert.equal(result.budget.profile, 'eco');
  assert.equal(result.budget.modelTier, 'tiny');
  assert.equal(result.budget.maxConcurrency, 1);
  assert.ok(result.budget.contextTokens <= 2048);
  assert.equal(result.budget.gpuOffload, 'cpu-only');
});

test('resource governor raises model capacity as verified resources become available', () => {
  const low = selectRuntimeBudget(snapshot({ cpuThreads: 2, totalRamBytes: 8 * GIB, freeRamBytes: 3 * GIB }));
  const medium = selectRuntimeBudget(snapshot({ cpuThreads: 8, totalRamBytes: 32 * GIB, freeRamBytes: 16 * GIB }));
  const strong = selectRuntimeBudget(snapshot({
    cpuThreads: 12,
    totalRamBytes: 64 * GIB,
    freeRamBytes: 32 * GIB,
    gpuAvailable: true,
    gpuTotalVramBytes: 24 * GIB,
    gpuFreeVramBytes: 18 * GIB
  }));
  assert.equal(low.budget.modelTier, 'tiny');
  assert.equal(medium.budget.modelTier, 'small');
  assert.equal(strong.budget.modelTier, 'strong');
  assert.ok(strong.budget.contextTokens > medium.budget.contextTokens);
});

test('gaming pressure automatically caps resource usage instead of competing with the game', () => {
  const result = selectRuntimeBudget(snapshot({
    cpuThreads: 16,
    totalRamBytes: 64 * GIB,
    freeRamBytes: 40 * GIB,
    gpuAvailable: true,
    gpuTotalVramBytes: 24 * GIB,
    gpuFreeVramBytes: 18 * GIB,
    gpuLoad: 0.85,
    gameActive: true
  }));
  assert.equal(result.budget.profile, 'gaming');
  assert.ok(['tiny', 'small'].includes(result.budget.modelTier));
  assert.equal(result.budget.maxConcurrency, 1);
  assert.ok(result.budget.cpuThreads <= 2);
});

test('critical pressure forces a tiny single-request emergency budget', () => {
  const result = selectRuntimeBudget(snapshot({ cpuLoad: 0.95, providerPressure: 0.95 }));
  assert.equal(result.budget.modelTier, 'tiny');
  assert.equal(result.budget.contextTokens, 2048);
  assert.equal(result.budget.maxConcurrency, 1);
  assert.equal(result.budget.pressureOverride, true);
});

test('provider routing is local-first and API fallback is opt-in', () => {
  const providers = [
    { id: 'desktop', kind: 'local', available: false },
    { id: 'rack', kind: 'lan', available: true },
    { id: 'cloud-gpu', kind: 'hosted', available: true },
    { id: 'openai', kind: 'api', available: true }
  ];
  assert.equal(selectProvider(providers)?.id, 'rack');
  assert.equal(selectProvider([{ id: 'openai', kind: 'api', available: true }]), null);
  assert.equal(selectProvider([{ id: 'openai', kind: 'api', available: true }], { allowApiFallback: true })?.id, 'openai');
});

test('model registry chooses the strongest model that fits the current budget', () => {
  const state = snapshot({
    gpuAvailable: true,
    gpuTotalVramBytes: 16 * GIB,
    gpuFreeVramBytes: 12 * GIB,
    freeRamBytes: 20 * GIB
  });
  const budget = selectRuntimeBudget(state, { profile: 'ai-priority' }).budget;
  const model = selectModel([
    { id: 'tiny-q4', tier: 'tiny', minRamBytes: 2 * GIB },
    { id: 'standard-q4', tier: 'standard', minRamBytes: 8 * GIB, minVramBytes: 7 * GIB },
    { id: 'strong-too-large', tier: 'strong', minRamBytes: 16 * GIB, minVramBytes: 14 * GIB }
  ], state, budget);
  assert.equal(model.id, 'standard-q4');
});

test('Veyra can never execute system repairs and Sentinel remains proposal-only', () => {
  const veyra = authorizeRepair({ action: 'runtime.restart-authorized', actor: 'veyra' });
  const sentinel = authorizeRepair({ action: 'config.restore-known-good', actor: 'sentinel' });
  assert.equal(veyra.canExecute, false);
  assert.match(veyra.reason, /no system maintenance authority/i);
  assert.equal(sentinel.canExecute, false);
  assert.equal(sentinel.proposalOnly, true);
});

test('only deterministic L0/L1 repairs are automatic; L2/L3 require Owner approval', () => {
  assert.equal(authorizeRepair({ action: 'runtime.restart-authorized', actor: 'recovery-supervisor' }).canExecute, true);
  assert.equal(authorizeRepair({ action: 'config.restore-known-good', actor: 'recovery-supervisor' }).canExecute, true);
  const controlled = authorizeRepair({ action: 'component.reinstall', actor: 'recovery-supervisor' });
  const sourcePatch = authorizeRepair({ action: 'source.patch', actor: 'recovery-supervisor' });
  assert.equal(controlled.canExecute, false);
  assert.equal(controlled.requiresOwnerApproval, true);
  assert.equal(sourcePatch.canExecute, false);
  assert.equal(sourcePatch.requiresOwnerApproval, true);
  assert.equal(authorizeRepair({ action: 'source.patch', actor: 'recovery-supervisor', ownerApproved: true }).canExecute, true);
});

test('unregistered and arbitrary repair actions are rejected', () => {
  assert.throws(
    () => authorizeRepair({ action: 'shell.exec', actor: 'recovery-supervisor', ownerApproved: true }),
    (error) => error?.code === 'RECOVERY_ACTION_NOT_ALLOWED'
  );
});

test('recovery file operations cannot escape their approved root', () => {
  const base = path.join(os.tmpdir(), `khaos-recovery-root-${process.pid}`);
  assert.equal(assertWithinRoot(base, path.join(base, 'checkpoints', 'one.json')).startsWith(path.resolve(base)), true);
  assert.throws(
    () => assertWithinRoot(base, path.join(base, '..', 'outside.json')),
    (error) => error?.code === 'RECOVERY_PATH_OUTSIDE_ROOT'
  );
});

test('repair execution checkpoints, verifies, journals, and rolls back a failed repair', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-recovery-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new RecoveryStore(directory, { maxJournalEntries: 25 });
  let applied = false;
  let rolledBack = false;

  await assert.rejects(
    executeRepair(
      { action: 'config.restore-known-good', actor: 'recovery-supervisor', reason: 'test verification failure' },
      {
        'config.restore-known-good': {
          snapshot: () => ({ before: 'known-good' }),
          apply: async () => { applied = true; return { changed: true }; },
          verify: async () => false,
          rollback: async () => { rolledBack = true; }
        }
      },
      { store }
    ),
    (error) => error?.code === 'RECOVERY_VERIFY_FAILED' && error?.recovery?.rolledBack === true
  );
  assert.equal(applied, true);
  assert.equal(rolledBack, true);
  const journal = store.journal();
  assert.equal(journal[0].outcome, 'failed');
  assert.equal(journal[0].rolledBack, true);
  assert.ok(journal[0].checkpointId);
  assert.ok(store.readCheckpoint(journal[0].checkpointId));
});

test('repeated crashes enter deterministic Recovery Safe Mode', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-recovery-crash-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new RecoveryStore(directory);
  const now = Date.now();
  assert.equal(store.recordCrash('ai-runtime', { now, limit: 3 }).safeModeRequired, false);
  assert.equal(store.recordCrash('ai-runtime', { now: now + 1000, limit: 3 }).safeModeRequired, false);
  const third = store.recordCrash('ai-runtime', { now: now + 2000, limit: 3 });
  assert.equal(third.safeModeRequired, true);
  assert.equal(store.safeMode().active, true);
  assert.match(store.safeMode().reason, /crash threshold/i);
});

test('Recovery Supervisor is installed after the manual runtime and does not auto-start AI during desktop boot', () => {
  const entry = read('main/entry.cjs');
  const recovery = read('main/ai-recovery-supervisor-extension.cjs');
  const runtimeInstallIndex = entry.indexOf("require('./bundled-ai-runtimes-extension.cjs').install();");
  const recoveryInstallIndex = entry.indexOf("require('./ai-recovery-supervisor-extension.cjs').install();");
  assert.ok(runtimeInstallIndex >= 0 && recoveryInstallIndex > runtimeInstallIndex);

  const install = recovery.match(/function install\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(install, /runtime\.startHost\(/);
  assert.doesNotMatch(install, /runtime\.startAll\(/);
  assert.match(recovery, /A cold desktop starts with an empty authorization set/);
  assert.match(recovery, /approved\.length/);
  assert.match(recovery, /authorizedAgents\.has\(key\)/);
});

test('Recovery Supervisor only retries agents that were active before a failure', () => {
  const recovery = read('main/ai-recovery-supervisor-extension.cjs');
  assert.match(recovery, /const wasHealthy = before && \['starting', 'running', 'ready'\]\.includes\(before\.status\);/);
  assert.match(recovery, /const failedNow = after\?\.status === 'failed' \|\| next\?\.host\?\.status === 'failed';/);
  assert.match(recovery, /if \(wasHealthy && failedNow\) candidates\.push\(key\);/);
  assert.match(recovery, /if \(nextHost\.status === 'stopping'\) authorizedAgents\.clear\(\);/);
});
