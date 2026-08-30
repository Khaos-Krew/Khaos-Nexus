'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SPECIES_POLICIES = Object.freeze({
  megalodon: Object.freeze({
    id: 'megalodon', label: 'Megalodon', className: 'Megalodon_Character_BP_C', dinoNameTag: 'Megalodon',
    baselineTarget: 45, alertCount: 80, criticalCount: 120, spawnWeightMultiplier: 0.65, spawnLimitPercentage: 0.05
  })
});

function parseSpeciesCount(response, policy = {}) {
  const text = String(response || '').trim();
  if (/^\d+$/.test(text)) return Number(text);
  const escaped = String(policy.label || policy.id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labeled = text.match(new RegExp(`${escaped}[^0-9]{0,30}(\\d+)`, 'i'));
  if (labeled) return Number(labeled[1]);
  const actorLines = text.split(/\r?\n/).filter((line) => line.includes(policy.className));
  return actorLines.length || null;
}

function evaluateSpeciesCount({ mapId, policy, count, baseline = null } = {}) {
  const observed = Math.max(0, Number(count) || 0);
  const reference = Math.max(1, Number(baseline) || Number(policy.baselineTarget) || 1);
  let state = 'normal';
  if (observed >= Number(policy.criticalCount)) state = 'critical';
  else if (observed >= Number(policy.alertCount)) state = 'alert';
  return {
    mapId: String(mapId || 'unknown'), speciesId: policy.id, count: observed, baseline: reference,
    ratio: Number((observed / reference).toFixed(2)), state, checkedAt: new Date().toISOString()
  };
}

function gameIniRecommendation(policy = DEFAULT_SPECIES_POLICIES.megalodon) {
  return `DinoSpawnWeightMultipliers=(DinoNameTag="${policy.dinoNameTag}",SpawnWeightMultiplier=${policy.spawnWeightMultiplier},OverrideSpawnLimitPercentage=True,SpawnLimitPercentage=${policy.spawnLimitPercentage})`;
}

function correctionPlan(result, policy = DEFAULT_SPECIES_POLICIES[result?.speciesId] || DEFAULT_SPECIES_POLICIES.megalodon) {
  return Object.freeze({
    safeByDefault: true,
    autoExecute: false,
    globalWildDinoWipe: false,
    requiresExplicitApproval: true,
    mapId: result.mapId,
    state: result.state,
    recommendation: gameIniRecommendation(policy),
    proposedTargetedCommand: `DestroyAll ${policy.className}`,
    warning: 'Targeted correction removes this wild species only; Sentinel must never issue DestroyWildDinos automatically.'
  });
}

class SpawnMonitorJournal {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-spawn-monitor.json');
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { version: 1, samples: Array.isArray(parsed?.samples) ? parsed.samples.slice(-20_000) : [], actions: Array.isArray(parsed?.actions) ? parsed.actions.slice(-5000) : [] };
    } catch { return { version: 1, samples: [], actions: [] }; }
  }

  recordSample(result) {
    const state = this.read();
    const item = { id: crypto.randomUUID(), ...result };
    state.samples.push(item);
    this.write(state);
    return item;
  }

  baseline(mapId, speciesId, sampleSize = 24) {
    const counts = this.read().samples.filter((item) => item.mapId === mapId && item.speciesId === speciesId && item.state === 'normal').slice(-sampleSize).map((item) => Number(item.count)).filter(Number.isFinite);
    if (!counts.length) return null;
    counts.sort((a, b) => a - b);
    return counts[Math.floor(counts.length / 2)];
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), samples: state.samples.slice(-20_000), actions: state.actions.slice(-5000) }, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { DEFAULT_SPECIES_POLICIES, parseSpeciesCount, evaluateSpeciesCount, gameIniRecommendation, correctionPlan, SpawnMonitorJournal };
