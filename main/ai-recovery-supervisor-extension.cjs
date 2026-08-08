'use strict';

const os = require('node:os');
const path = require('node:path');
const electron = require('electron');
const runtime = require('./bundled-ai-runtimes-extension.cjs');
const {
  RecoveryStore,
  executeRepair,
  selectRuntimeBudget,
  selectModel,
  selectProvider
} = require('../shared/ai-recovery-governor.cjs');

const SAMPLE_INTERVAL_MS = 5000;
const VERIFY_TIMEOUT_MS = 20000;
const VERIFY_INTERVAL_MS = 500;
const refs = { logger: null };
let installed = false;
let store = null;
let timer = null;
let repairInFlight = null;
let lastCpuSample = null;
let lastStatus = null;
let currentSnapshot = null;
let currentBudget = null;
let currentProvider = null;
let currentModel = null;
let gpuIdentity = { available: false, name: '', vendorId: null, deviceId: null };
const authorizedAgents = new Set();
const providers = new Map();
const models = new Map();

function nowIso() { return new Date().toISOString(); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function log(level, message, metadata = {}) {
  try { refs.logger?.write?.(level, message, metadata, 'ai-recovery'); }
  catch {}
}
function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosRecoveryCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
    }
  }
  Object.defineProperty(Captured, '__khaosRecoveryCapture', { value: true });
  target[exportName] = Captured;
}

function cpuTimes() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += Number(cpu.times?.idle || 0);
    total += Object.values(cpu.times || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  }
  return { idle, total };
}
function cpuLoad() {
  const next = cpuTimes();
  if (!lastCpuSample) {
    lastCpuSample = next;
    return 0;
  }
  const idleDelta = next.idle - lastCpuSample.idle;
  const totalDelta = next.total - lastCpuSample.total;
  lastCpuSample = next;
  if (totalDelta <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - (idleDelta / totalDelta)));
}
async function refreshGpuIdentity() {
  try {
    const info = await electron.app.getGPUInfo('basic');
    const device = Array.isArray(info?.gpuDevice)
      ? info.gpuDevice.find((item) => item?.active) || info.gpuDevice[0]
      : null;
    gpuIdentity = {
      available: Boolean(device),
      name: '',
      vendorId: Number.isFinite(Number(device?.vendorId)) ? Number(device.vendorId) : null,
      deviceId: Number.isFinite(Number(device?.deviceId)) ? Number(device.deviceId) : null
    };
  } catch {
    gpuIdentity = { available: false, name: '', vendorId: null, deviceId: null };
  }
}
function systemSnapshot() {
  return {
    capturedAt: nowIso(),
    platform: process.platform,
    arch: process.arch,
    cpuThreads: Math.max(1, os.cpus().length),
    cpuLoad: cpuLoad(),
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    gpuAvailable: gpuIdentity.available,
    gpuName: gpuIdentity.name,
    gpuVendorId: gpuIdentity.vendorId,
    gpuDeviceId: gpuIdentity.deviceId,
    // VRAM/load telemetry is intentionally provider-supplied when available.
    // Unknown VRAM keeps the governor conservative instead of guessing capacity.
    gpuTotalVramBytes: 0,
    gpuFreeVramBytes: 0,
    gpuLoad: 0,
    gameActive: false,
    providerPressure: Number(currentProvider?.pressure || 0)
  };
}

function registerProvider(provider) {
  if (!provider?.id) throw new Error('AI provider id is required.');
  providers.set(String(provider.id), { ...provider });
  return () => providers.delete(String(provider.id));
}
function registerModel(model) {
  if (!model?.id) throw new Error('AI model id is required.');
  models.set(String(model.id), { ...model });
  return () => models.delete(String(model.id));
}
function refreshResourcePlan() {
  currentSnapshot = systemSnapshot();
  currentBudget = selectRuntimeBudget(currentSnapshot, { profile: 'auto' });
  currentProvider = selectProvider([...providers.values()], { allowApiFallback: false });
  currentModel = currentProvider?.kind === 'local'
    ? selectModel([...models.values()], currentBudget.snapshot, currentBudget.budget)
    : null;
  return resourceStatus();
}
function resourceStatus() {
  return {
    snapshot: currentBudget?.snapshot || currentSnapshot,
    budget: currentBudget?.budget || null,
    provider: currentProvider ? { ...currentProvider, credentials: undefined } : null,
    model: currentModel ? { ...currentModel } : null
  };
}

function agentMap(status) {
  return new Map((status?.agents || status?.services || []).map((agent) => [agent.key, agent]));
}
function updateAuthorization(previous, next) {
  const previousHost = previous?.host || {};
  const nextHost = next?.host || {};
  const previousAgents = agentMap(previous);
  const nextAgents = agentMap(next);

  if (nextHost.status === 'stopping') authorizedAgents.clear();
  for (const [key, agent] of nextAgents) {
    if (agent.status === 'stopping') authorizedAgents.delete(key);
    if (['starting', 'running', 'ready'].includes(agent.status)) {
      const prior = previousAgents.get(key);
      const cameFromInactive = !prior || ['stopped', 'failed'].includes(prior.status);
      const hostWasInactive = !previous || ['stopped', 'failed'].includes(previousHost.status);
      if (cameFromInactive || hostWasInactive || authorizedAgents.has(key)) authorizedAgents.add(key);
    }
    if (agent.status === 'stopped' && previousAgents.get(key)?.status === 'stopping') authorizedAgents.delete(key);
  }
}
function recoveryCandidates(previous, next) {
  if (!previous) return [];
  const previousAgents = agentMap(previous);
  const nextAgents = agentMap(next);
  const candidates = [];
  for (const key of authorizedAgents) {
    const before = previousAgents.get(key);
    const after = nextAgents.get(key);
    const wasHealthy = before && ['starting', 'running', 'ready'].includes(before.status);
    const failedNow = after?.status === 'failed' || next?.host?.status === 'failed';
    if (wasHealthy && failedNow) candidates.push(key);
  }
  return candidates;
}

async function waitForAgents(keys) {
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = runtime.status();
    const states = agentMap(status);
    if (keys.every((key) => ['running', 'ready'].includes(states.get(key)?.status))) return true;
    if (keys.some((key) => states.get(key)?.status === 'failed')) return false;
    await delay(VERIFY_INTERVAL_MS);
  }
  return false;
}

async function recoverRuntime(keys, reason) {
  if (!keys.length || repairInFlight || store.safeMode().active) return null;
  const stillAuthorized = keys.filter((key) => authorizedAgents.has(key));
  if (!stillAuthorized.length) return null;
  const crash = store.recordCrash('ai-runtime');
  if (crash.safeModeRequired) {
    store.appendJournal({
      action: 'runtime.restart-authorized',
      level: 'L0',
      actor: 'recovery-supervisor',
      outcome: 'safe-mode',
      detail: crash.safeMode.reason,
      verified: false
    });
    log('warn', 'Khaos Nexus Recovery Supervisor entered AI safe mode after repeated runtime failures.', crash);
    return { safeMode: crash.safeMode };
  }

  const plan = {
    action: 'runtime.restart-authorized',
    actor: 'recovery-supervisor',
    reason: String(reason || 'AI runtime became unhealthy.'),
    agents: stillAuthorized
  };
  const handlers = {
    'runtime.restart-authorized': {
      snapshot: () => ({ runtime: runtime.status(), authorizedAgents: [...authorizedAgents], resources: resourceStatus() }),
      apply: async () => {
        await runtime.stopHost({ timeoutMs: 2500 });
        if (store.safeMode().active) throw new Error('Recovery Safe Mode became active before restart.');
        const approved = stillAuthorized.filter((key) => authorizedAgents.has(key));
        if (!approved.length) throw new Error('Owner-authorized AI agents were stopped before recovery could restart them.');
        runtime.startHost(approved);
        return { agents: approved };
      },
      verify: async (_repairPlan, result) => waitForAgents(result.agents),
      rollback: async () => { await runtime.stopHost({ timeoutMs: 1500 }); }
    }
  };

  repairInFlight = executeRepair(plan, handlers, { store })
    .then((result) => {
      log('info', 'Khaos Nexus Recovery Supervisor restored the manually authorized AI runtime.', { agents: stillAuthorized, checkpointId: result.checkpoint?.id });
      return result;
    })
    .catch((error) => {
      log('warn', 'Khaos Nexus Recovery Supervisor could not restore the AI runtime.', { error: error?.message || String(error), agents: stillAuthorized });
      return { ok: false, error: error?.message || String(error), recovery: error?.recovery || null };
    })
    .finally(() => { repairInFlight = null; });
  return repairInFlight;
}

async function sample() {
  try {
    refreshResourcePlan();
    const next = runtime.status();
    updateAuthorization(lastStatus, next);
    const candidates = recoveryCandidates(lastStatus, next);
    const previous = lastStatus;
    lastStatus = next;
    if (candidates.length) {
      const detail = `${next.host?.status || 'unknown'}: ${next.host?.error || candidates.map((key) => agentMap(next).get(key)?.error).filter(Boolean).join('; ')}`;
      void recoverRuntime(candidates, detail);
    }
    if (previous?.host?.status === 'stopping' && next.host?.status === 'stopped') authorizedAgents.clear();
  } catch (error) {
    log('warn', 'Recovery Supervisor sampling failed.', { error: error?.message || String(error) });
  }
}

function status() {
  return {
    format: 'khaos-nexus-ai-recovery-status',
    formatVersion: 1,
    capturedAt: nowIso(),
    safeMode: store?.safeMode?.() || { active: false, reason: '', enteredAt: null },
    repairInFlight: Boolean(repairInFlight),
    authorizedAgents: [...authorizedAgents],
    runtime: runtime.status(),
    resources: resourceStatus(),
    journal: store?.journal?.(25) || []
  };
}
function clearSafeMode() {
  if (!store) return { active: false, reason: '', enteredAt: null };
  const value = store.clearSafeMode();
  store.appendJournal({ action: 'recovery.safe-mode.clear', level: 'L2', actor: 'owner', outcome: 'success', detail: 'Recovery Safe Mode cleared through an explicit trusted call.', verified: true });
  return value;
}

function install() {
  if (installed) return;
  installed = true;
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  electron.app.whenReady().then(async () => {
    store = new RecoveryStore(path.join(electron.app.getPath('userData'), 'ai-recovery'));
    await refreshGpuIdentity();
    refreshResourcePlan();
    lastStatus = runtime.status();
    // A cold desktop starts with an empty authorization set. Merely installing or
    // sampling this supervisor can never authorize AI startup.
    timer = setInterval(() => { void sample(); }, SAMPLE_INTERVAL_MS);
    timer.unref?.();
    log('info', 'Khaos Nexus Recovery Supervisor is ready.', { resources: resourceStatus() });
  }).catch((error) => {
    log('warn', 'Khaos Nexus Recovery Supervisor initialization failed.', { error: error?.message || String(error) });
  });
  electron.app.on('before-quit', () => {
    if (timer) clearInterval(timer);
    timer = null;
    authorizedAgents.clear();
  });
}

module.exports = {
  install,
  status,
  clearSafeMode,
  registerProvider,
  registerModel,
  refreshResourcePlan,
  recoverRuntime,
  systemSnapshot,
  SAMPLE_INTERVAL_MS,
  VERIFY_TIMEOUT_MS
};
