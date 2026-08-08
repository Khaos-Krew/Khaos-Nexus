'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const GIB = 1024 ** 3;
const REPAIR_LEVELS = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3 });
const MODEL_TIERS = Object.freeze(['tiny', 'small', 'standard', 'strong', 'extreme']);
const PROFILE_NAMES = Object.freeze(['eco', 'gaming', 'balanced', 'ai-priority']);
const MAX_JOURNAL_ENTRIES = 500;
const DEFAULT_CRASH_LIMIT = 3;
const DEFAULT_CRASH_WINDOW_MS = 5 * 60 * 1000;

const REPAIR_ACTIONS = Object.freeze({
  'runtime.restart-authorized': Object.freeze({ level: 'L0', automatic: true }),
  'runtime.reload-model': Object.freeze({ level: 'L0', automatic: true }),
  'cache.clear-transient': Object.freeze({ level: 'L0', automatic: true }),
  'config.restore-known-good': Object.freeze({ level: 'L1', automatic: true }),
  'index.rebuild-local': Object.freeze({ level: 'L1', automatic: true }),
  'component.reinstall': Object.freeze({ level: 'L2', automatic: false }),
  'service.reconfigure': Object.freeze({ level: 'L2', automatic: false }),
  'source.patch': Object.freeze({ level: 'L3', automatic: false }),
  'database.migrate': Object.freeze({ level: 'L3', automatic: false }),
  'permissions.change': Object.freeze({ level: 'L3', automatic: false }),
  'credentials.change': Object.freeze({ level: 'L3', automatic: false }),
  'updater.change': Object.freeze({ level: 'L3', automatic: false }),
  'security.change': Object.freeze({ level: 'L3', automatic: false })
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function clamp(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}
function bytes(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function gb(value) {
  return Math.round((bytes(value) / GIB) * 10) / 10;
}
function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}
function hashJson(value) {
  const encoded = JSON.stringify(value);
  return crypto.createHash('sha256').update(encoded === undefined ? 'null' : encoded).digest('hex');
}
function tierRank(value) {
  const rank = MODEL_TIERS.indexOf(String(value || '').toLowerCase());
  return rank < 0 ? 0 : rank;
}
function lowerTier(left, right) {
  return MODEL_TIERS[Math.min(tierRank(left), tierRank(right))];
}

function normalizeSystemSnapshot(input = {}) {
  const nestedGpu = input.gpu && typeof input.gpu === 'object' ? input.gpu : {};
  const cpuThreads = Math.max(1, Math.floor(Number(input.cpuThreads || input.logicalCpuCount || 1)));
  const totalRamBytes = bytes(input.totalRamBytes);
  const freeRamBytes = Math.min(totalRamBytes || Infinity, bytes(input.freeRamBytes));
  const gpuTotalVramBytes = bytes(input.gpuTotalVramBytes ?? nestedGpu.totalVramBytes);
  const gpuFreeSource = input.gpuFreeVramBytes ?? nestedGpu.freeVramBytes;
  const gpuFreeVramBytes = gpuTotalVramBytes
    ? Math.min(gpuTotalVramBytes, bytes(gpuFreeSource))
    : bytes(gpuFreeSource);
  const cpuLoad = clamp(input.cpuLoad, 0, 1);
  const gpuLoad = clamp(input.gpuLoad ?? nestedGpu.load, 0, 1);
  const gpuVendorIdSource = input.gpuVendorId ?? nestedGpu.vendorId;
  const gpuDeviceIdSource = input.gpuDeviceId ?? nestedGpu.deviceId;
  const gpuName = input.gpuName ?? nestedGpu.name ?? '';
  return {
    capturedAt: String(input.capturedAt || nowIso()),
    platform: String(input.platform || process.platform),
    arch: String(input.arch || process.arch),
    cpuThreads,
    cpuLoad,
    totalRamBytes,
    freeRamBytes,
    gpu: {
      available: input.gpuAvailable === true || nestedGpu.available === true || gpuTotalVramBytes > 0 || Boolean(gpuName),
      name: String(gpuName).slice(0, 160),
      vendorId: Number.isFinite(Number(gpuVendorIdSource)) ? Number(gpuVendorIdSource) : null,
      deviceId: Number.isFinite(Number(gpuDeviceIdSource)) ? Number(gpuDeviceIdSource) : null,
      totalVramBytes: gpuTotalVramBytes,
      freeVramBytes: gpuFreeVramBytes,
      load: gpuLoad,
      vramKnown: nestedGpu.vramKnown === true || gpuTotalVramBytes > 0
    },
    onBattery: input.onBattery === true,
    gameActive: input.gameActive === true,
    providerPressure: clamp(input.providerPressure, 0, 1)
  };
}

function inferAutoProfile(snapshotInput) {
  const snapshot = normalizeSystemSnapshot(snapshotInput);
  const freeRamGb = gb(snapshot.freeRamBytes);
  const totalRamGb = gb(snapshot.totalRamBytes);
  const gpuMemoryPressure = snapshot.gpu.vramKnown && snapshot.gpu.totalVramBytes > 0
    ? 1 - (snapshot.gpu.freeVramBytes / snapshot.gpu.totalVramBytes)
    : 0;
  const highPressure = snapshot.gameActive || snapshot.cpuLoad >= 0.78 || snapshot.gpu.load >= 0.78 || gpuMemoryPressure >= 0.8 || snapshot.providerPressure >= 0.8;
  if (highPressure) return 'gaming';
  if (snapshot.onBattery || totalRamGb <= 8 || freeRamGb < 4 || snapshot.cpuThreads <= 2) return 'eco';
  return 'balanced';
}

function capabilityTier(snapshotInput) {
  const snapshot = normalizeSystemSnapshot(snapshotInput);
  const freeRamGb = gb(snapshot.freeRamBytes);
  const totalRamGb = gb(snapshot.totalRamBytes);
  const freeVramGb = gb(snapshot.gpu.freeVramBytes);

  if (freeRamGb < 3 || totalRamGb <= 8 || snapshot.cpuThreads <= 2) return 'tiny';
  if (snapshot.gpu.vramKnown) {
    if (freeVramGb >= 24 && freeRamGb >= 24 && snapshot.cpuThreads >= 12) return 'extreme';
    if (freeVramGb >= 14 && freeRamGb >= 14 && snapshot.cpuThreads >= 8) return 'strong';
    if (freeVramGb >= 7 && freeRamGb >= 8 && snapshot.cpuThreads >= 6) return 'standard';
    if (freeVramGb >= 3.5 && freeRamGb >= 5) return 'small';
    return freeRamGb >= 6 ? 'small' : 'tiny';
  }

  if (freeRamGb >= 20 && snapshot.cpuThreads >= 12) return 'standard';
  if (freeRamGb >= 8 && snapshot.cpuThreads >= 6) return 'small';
  return 'tiny';
}

function profileCap(profile) {
  switch (profile) {
    case 'eco': return 'tiny';
    case 'gaming': return 'small';
    case 'ai-priority': return 'extreme';
    default: return 'strong';
  }
}

function budgetForTier(tier, snapshotInput, profile) {
  const snapshot = normalizeSystemSnapshot(snapshotInput);
  const rank = tierRank(tier);
  const contexts = [2048, 4096, 8192, 16384, 32768];
  const cpuThreadCaps = [2, 4, 6, 10, 16];
  const concurrency = rank >= 4 ? 3 : rank >= 3 ? 2 : 1;
  const cpuThreads = Math.max(1, Math.min(snapshot.cpuThreads, cpuThreadCaps[rank]));
  const gpuOffload = snapshot.gpu.available
    ? snapshot.gpu.vramKnown
      ? rank <= 1 ? 'partial' : 'prefer-gpu'
      : 'auto'
    : 'cpu-only';
  return {
    profile,
    modelTier: MODEL_TIERS[rank],
    contextTokens: contexts[rank],
    maxConcurrency: profile === 'gaming' || profile === 'eco' ? 1 : concurrency,
    cpuThreads: profile === 'gaming' ? Math.min(2, cpuThreads) : cpuThreads,
    gpuOffload,
    unloadIdleSeconds: profile === 'gaming' ? 30 : profile === 'eco' ? 60 : 300,
    allowBackgroundWarmup: profile === 'ai-priority',
    preferLowPower: profile === 'eco' || snapshot.onBattery
  };
}

function selectRuntimeBudget(snapshotInput, policy = {}) {
  const snapshot = normalizeSystemSnapshot(snapshotInput);
  const requestedProfile = String(policy.profile || 'auto').toLowerCase();
  const profile = PROFILE_NAMES.includes(requestedProfile) ? requestedProfile : inferAutoProfile(snapshot);
  let tier = lowerTier(capabilityTier(snapshot), profileCap(profile));
  if (Number.isFinite(Number(policy.maxTierRank))) {
    const requestedMaxTierRank = Math.floor(clamp(policy.maxTierRank, 0, MODEL_TIERS.length - 1));
    tier = MODEL_TIERS[Math.min(tierRank(tier), requestedMaxTierRank)];
  }
  const budget = budgetForTier(tier, snapshot, profile);
  if (snapshot.cpuLoad >= 0.9 || snapshot.gpu.load >= 0.9 || snapshot.providerPressure >= 0.9) {
    budget.modelTier = lowerTier(budget.modelTier, 'tiny');
    budget.contextTokens = Math.min(budget.contextTokens, 2048);
    budget.maxConcurrency = 1;
    budget.cpuThreads = Math.min(budget.cpuThreads, 2);
    budget.gpuOffload = snapshot.gpu.available ? 'minimal' : 'cpu-only';
    budget.pressureOverride = true;
  } else {
    budget.pressureOverride = false;
  }
  return { snapshot, budget };
}

function modelFits(model, snapshotInput, budget) {
  const snapshot = normalizeSystemSnapshot(snapshotInput);
  if (!model || model.enabled === false) return false;
  if (tierRank(model.tier) > tierRank(budget.modelTier)) return false;
  if (bytes(model.minRamBytes) > snapshot.freeRamBytes) return false;
  if (bytes(model.minVramBytes) > 0) {
    if (!snapshot.gpu.vramKnown || bytes(model.minVramBytes) > snapshot.gpu.freeVramBytes) return false;
  }
  return true;
}

function selectModel(models = [], snapshotInput, budget) {
  const fitting = models.filter((model) => modelFits(model, snapshotInput, budget));
  fitting.sort((left, right) => {
    const tierDifference = tierRank(right.tier) - tierRank(left.tier);
    if (tierDifference) return tierDifference;
    return Number(right.priority || 0) - Number(left.priority || 0);
  });
  return fitting[0] ? clone(fitting[0]) : null;
}

function selectProvider(providers = [], policy = {}) {
  const order = Array.isArray(policy.order) && policy.order.length
    ? policy.order.map((value) => String(value).toLowerCase())
    : ['local', 'lan', 'hosted', 'api'];
  const apiAllowed = policy.allowApiFallback === true;
  const eligible = providers.filter((provider) => provider && provider.available !== false && (provider.kind !== 'api' || apiAllowed));
  eligible.sort((left, right) => {
    const leftOrder = order.indexOf(String(left.kind || '').toLowerCase());
    const rightOrder = order.indexOf(String(right.kind || '').toLowerCase());
    const leftRank = leftOrder < 0 ? order.length : leftOrder;
    const rightRank = rightOrder < 0 ? order.length : rightOrder;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return Number(right.priority || 0) - Number(left.priority || 0);
  });
  return eligible[0] ? clone(eligible[0]) : null;
}

function getRepairDefinition(action) {
  const key = String(action || '').trim();
  const definition = REPAIR_ACTIONS[key];
  if (!definition) {
    const error = new Error('Unknown or unapproved Khaos Nexus recovery action.');
    error.code = 'RECOVERY_ACTION_NOT_ALLOWED';
    throw error;
  }
  return { action: key, ...definition };
}

function authorizeRepair(input = {}) {
  const definition = getRepairDefinition(input.action);
  const actor = String(input.actor || '').trim().toLowerCase();
  if (actor === 'veyra' || actor === 'dnd' || actor === 'dnd-ai') {
    return { ...definition, actor, canExecute: false, proposalOnly: false, reason: 'Veyra has no system maintenance authority.' };
  }
  if (actor === 'sentinel' || actor === 'nexus-sentinel' || actor === 'core' || actor === 'ai-core') {
    return { ...definition, actor, canExecute: false, proposalOnly: true, reason: 'Nexus Sentinel may diagnose and propose repairs but does not execute them directly.' };
  }
  if (actor !== 'recovery-supervisor') {
    return { ...definition, actor, canExecute: false, proposalOnly: false, reason: 'Only the deterministic Recovery Supervisor may execute repair handlers.' };
  }
  const requiresOwnerApproval = REPAIR_LEVELS[definition.level] >= REPAIR_LEVELS.L2;
  const canExecute = !requiresOwnerApproval || input.ownerApproved === true;
  return {
    ...definition,
    actor,
    canExecute,
    proposalOnly: !canExecute,
    requiresOwnerApproval,
    reason: canExecute ? 'Repair authority satisfied.' : 'Owner approval is required for this repair level.'
  };
}

function assertWithinRoot(root, target, options = {}) {
  const resolvedRoot = path.resolve(String(root || ''));
  const resolvedTarget = path.resolve(String(target || ''));
  if (!resolvedRoot || resolvedRoot === path.parse(resolvedRoot).root) throw new Error('Recovery root must be a specific application directory.');
  const contained = resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`) || (options.allowRoot === true && resolvedTarget === resolvedRoot);
  if (!contained) {
    const error = new Error('Recovery operation attempted to leave its approved root.');
    error.code = 'RECOVERY_PATH_OUTSIDE_ROOT';
    throw error;
  }
  return resolvedTarget;
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
}
function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return clone(fallback); }
}

class RecoveryStore {
  constructor(root, options = {}) {
    this.root = path.resolve(root);
    this.registryPath = assertWithinRoot(this.root, path.join(this.root, 'known-good.json'));
    this.journalPath = assertWithinRoot(this.root, path.join(this.root, 'repair-journal.json'));
    this.checkpointRoot = assertWithinRoot(this.root, path.join(this.root, 'checkpoints'));
    this.maxJournalEntries = Math.max(25, Math.min(2000, Number(options.maxJournalEntries || MAX_JOURNAL_ENTRIES)));
    fs.mkdirSync(this.checkpointRoot, { recursive: true });
  }

  loadRegistry() {
    return readJson(this.registryPath, {
      format: 'khaos-nexus-recovery-registry',
      formatVersion: 1,
      updatedAt: null,
      safeMode: { active: false, reason: '', enteredAt: null },
      knownGood: {},
      crashes: {}
    });
  }

  saveRegistry(registry) {
    const next = {
      ...registry,
      format: 'khaos-nexus-recovery-registry',
      formatVersion: 1,
      updatedAt: nowIso()
    };
    atomicWriteJson(this.registryPath, next);
    return clone(next);
  }

  rememberKnownGood(key, value) {
    const registry = this.loadRegistry();
    registry.knownGood ||= {};
    registry.knownGood[String(key)] = { capturedAt: nowIso(), sha256: hashJson(value), value: clone(value) };
    this.saveRegistry(registry);
    return clone(registry.knownGood[String(key)]);
  }

  getKnownGood(key) {
    const record = this.loadRegistry().knownGood?.[String(key)] || null;
    if (!record) return null;
    if (record.sha256 !== hashJson(record.value)) return null;
    return clone(record);
  }

  createCheckpoint(label, snapshot = {}) {
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const checkpoint = {
      format: 'khaos-nexus-recovery-checkpoint',
      formatVersion: 1,
      id,
      label: String(label || 'repair').slice(0, 120),
      createdAt: nowIso(),
      sha256: hashJson(snapshot),
      snapshot: clone(snapshot)
    };
    const file = assertWithinRoot(this.checkpointRoot, path.join(this.checkpointRoot, `${id}.json`));
    atomicWriteJson(file, checkpoint);
    return clone(checkpoint);
  }

  readCheckpoint(id) {
    const safeId = String(id || '');
    if (!/^\d+-[0-9a-f-]{36}$/i.test(safeId)) return null;
    const file = assertWithinRoot(this.checkpointRoot, path.join(this.checkpointRoot, `${safeId}.json`));
    const checkpoint = readJson(file, null);
    if (!checkpoint || checkpoint.sha256 !== hashJson(checkpoint.snapshot)) return null;
    return checkpoint;
  }

  appendJournal(entry = {}) {
    const current = readJson(this.journalPath, []);
    const journal = Array.isArray(current) ? current : [];
    journal.push({
      id: String(entry.id || crypto.randomUUID()),
      at: String(entry.at || nowIso()),
      action: String(entry.action || '').slice(0, 120),
      level: String(entry.level || '').slice(0, 8),
      actor: String(entry.actor || '').slice(0, 80),
      outcome: String(entry.outcome || '').slice(0, 40),
      detail: String(entry.detail || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
      checkpointId: entry.checkpointId || null,
      verified: entry.verified === true,
      rolledBack: entry.rolledBack === true
    });
    const bounded = journal.slice(-this.maxJournalEntries);
    atomicWriteJson(this.journalPath, bounded);
    return clone(bounded[bounded.length - 1]);
  }

  journal(limit = 100) {
    const journal = readJson(this.journalPath, []);
    return (Array.isArray(journal) ? journal : []).slice(-Math.max(1, Math.min(this.maxJournalEntries, Number(limit || 100)))).reverse();
  }

  recordCrash(scope, options = {}) {
    const registry = this.loadRegistry();
    const key = String(scope || 'unknown').slice(0, 120);
    const now = Number(options.now || Date.now());
    const windowMs = Math.max(1000, Number(options.windowMs || DEFAULT_CRASH_WINDOW_MS));
    const limit = Math.max(2, Number(options.limit || DEFAULT_CRASH_LIMIT));
    registry.crashes ||= {};
    const history = (Array.isArray(registry.crashes[key]) ? registry.crashes[key] : [])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= now - windowMs);
    history.push(now);
    registry.crashes[key] = history.slice(-20);
    const safeModeRequired = history.length >= limit;
    if (safeModeRequired) {
      registry.safeMode = {
        active: true,
        reason: `${key} crossed the crash threshold (${history.length}/${limit}).`,
        enteredAt: nowIso(now)
      };
    }
    this.saveRegistry(registry);
    return { scope: key, crashCount: history.length, safeModeRequired, safeMode: clone(registry.safeMode) };
  }

  safeMode() {
    return clone(this.loadRegistry().safeMode || { active: false, reason: '', enteredAt: null });
  }

  clearSafeMode() {
    const registry = this.loadRegistry();
    registry.safeMode = { active: false, reason: '', enteredAt: null };
    registry.crashes = {};
    this.saveRegistry(registry);
    return clone(registry.safeMode);
  }
}

async function executeRepair(plan = {}, handlers = {}, options = {}) {
  const authority = authorizeRepair(plan);
  if (!authority.canExecute) {
    const error = new Error(authority.reason);
    error.code = authority.requiresOwnerApproval ? 'RECOVERY_OWNER_APPROVAL_REQUIRED' : 'RECOVERY_EXECUTION_DENIED';
    error.authority = authority;
    throw error;
  }
  const handler = handlers[authority.action];
  if (!handler || typeof handler.apply !== 'function' || typeof handler.verify !== 'function') {
    const error = new Error('No deterministic handler is registered for this recovery action.');
    error.code = 'RECOVERY_HANDLER_MISSING';
    throw error;
  }
  const checkpoint = options.store?.createCheckpoint?.(authority.action, await Promise.resolve(handler.snapshot?.(plan))) || null;
  let applied = false;
  try {
    const result = await handler.apply(plan, checkpoint);
    applied = true;
    const verified = await handler.verify(plan, result, checkpoint);
    if (verified !== true) throw Object.assign(new Error('Recovery verification did not pass.'), { code: 'RECOVERY_VERIFY_FAILED' });
    options.store?.appendJournal?.({
      action: authority.action,
      level: authority.level,
      actor: authority.actor,
      outcome: 'success',
      detail: plan.reason || '',
      checkpointId: checkpoint?.id,
      verified: true,
      rolledBack: false
    });
    return { ok: true, authority, checkpoint, result, verified: true, rolledBack: false };
  } catch (error) {
    let rolledBack = false;
    if (applied && typeof handler.rollback === 'function') {
      try {
        await handler.rollback(plan, checkpoint);
        rolledBack = true;
      } catch {}
    }
    options.store?.appendJournal?.({
      action: authority.action,
      level: authority.level,
      actor: authority.actor,
      outcome: 'failed',
      detail: error?.message || error,
      checkpointId: checkpoint?.id,
      verified: false,
      rolledBack
    });
    error.recovery = { authority, checkpointId: checkpoint?.id || null, rolledBack };
    throw error;
  }
}

module.exports = {
  GIB,
  REPAIR_LEVELS,
  MODEL_TIERS,
  PROFILE_NAMES,
  REPAIR_ACTIONS,
  MAX_JOURNAL_ENTRIES,
  DEFAULT_CRASH_LIMIT,
  DEFAULT_CRASH_WINDOW_MS,
  normalizeSystemSnapshot,
  inferAutoProfile,
  capabilityTier,
  selectRuntimeBudget,
  selectModel,
  selectProvider,
  getRepairDefinition,
  authorizeRepair,
  assertWithinRoot,
  RecoveryStore,
  executeRepair,
  hashJson,
  gb
};
