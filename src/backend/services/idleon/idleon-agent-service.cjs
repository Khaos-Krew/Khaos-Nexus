'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildReview } = require('./progression-engine.cjs');
const { IdleonAutomationEngine } = require('./automation-engine.cjs');

function ensureParent(filePath) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); }
function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}
function writeJson(filePath, value) {
  ensureParent(filePath);
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, filePath);
}

const DEFAULT_ROUTINES = {
  'focus-idleon': {
    id: 'focus-idleon',
    name: 'Focus IdleOn',
    description: 'Verifies the local agent can focus the IdleOn window. No clicks are performed.',
    steps: [{ type: 'focus-window', title: 'Legends Of IdleOn' }, { type: 'wait', ms: 500 }]
  },
  'calibration-smoke-test': {
    id: 'calibration-smoke-test',
    name: 'Calibration Smoke Test',
    description: 'Focuses IdleOn and clicks the saved calibration point named smoke_test_target.',
    steps: [{ type: 'focus-window', title: 'Legends Of IdleOn' }, { type: 'click', point: 'smoke_test_target' }, { type: 'wait', ms: 500 }]
  }
};

class IdleonAgentService {
  constructor(options = {}) {
    this.stateFile = options.stateFile || path.join(process.env.NEXUS_DATA_DIR || 'data', 'idleon-agent.json');
    const configuredAutomation = options.automation?.enabled === true || process.env.NEXUS_IDLEON_AUTOMATION === '1';
    this.automation = options.automationEngine || new IdleonAutomationEngine({
      enabled: configuredAutomation,
      windowTitle: options.automation?.windowTitle || 'Legends Of IdleOn',
      scriptPath: options.automation?.scriptPath || path.join(__dirname, 'automation-windows.ps1'),
      logger: options.logger || console
    });
    this.state = readJson(this.stateFile, { snapshot: null, calibration: {}, routines: {} });
    this.state.calibration ||= {};
    this.state.routines ||= {};
  }

  save() { writeJson(this.stateFile, this.state); }
  routines() { return { ...DEFAULT_ROUTINES, ...this.state.routines }; }

  importSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('snapshot must be a JSON object.');
    this.state.snapshot = { ...snapshot, importedAt: new Date().toISOString() };
    this.save();
    return { importedAt: this.state.snapshot.importedAt, review: buildReview(this.state.snapshot) };
  }

  review(payload = {}) {
    const snapshot = payload.snapshot || this.state.snapshot;
    if (!snapshot) throw new Error('No IdleOn account snapshot is available. Import one first.');
    return buildReview(snapshot, { limit: payload.limit });
  }

  setCalibration(payload = {}) {
    const name = String(payload.name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const x = Number(payload.x); const y = Number(payload.y);
    if (!name) throw new Error('Calibration point name is required.');
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error('Calibration coordinates must be non-negative numbers.');
    this.state.calibration[name] = { x: Math.round(x), y: Math.round(y), updatedAt: new Date().toISOString() };
    this.save();
    return { name, ...this.state.calibration[name] };
  }

  saveRoutine(payload = {}) {
    const routine = payload.routine;
    if (!routine || typeof routine !== 'object') throw new Error('routine object is required.');
    const id = String(routine.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    if (!id || DEFAULT_ROUTINES[id]) throw new Error('A non-reserved routine id is required.');
    this.automation.compile({ ...routine, id }, this.state.calibration);
    this.state.routines[id] = { ...routine, id, updatedAt: new Date().toISOString() };
    this.save();
    return this.state.routines[id];
  }

  async invoke(moduleId, actionId, payload = {}) {
    if (moduleId !== 'idleon') throw new Error('IdleonAgentService only accepts the idleon module.');
    switch (actionId) {
      case 'progression':
      case 'review': return this.review(payload);
      case 'quick-wins': {
        const review = this.review(payload);
        return { generatedAt: review.generatedAt, account: review.account, quickWins: review.quickWins };
      }
      case 'snapshot-import': return this.importSnapshot(payload.snapshot || payload);
      case 'automation-status': return { ...this.automation.status(), calibrationPoints: Object.keys(this.state.calibration).sort(), routines: Object.keys(this.routines()).sort() };
      case 'calibration-list': return { points: { ...this.state.calibration } };
      case 'calibration-set': return this.setCalibration(payload);
      case 'routine-list': return { routines: Object.values(this.routines()).map(({ steps, ...routine }) => ({ ...routine, stepCount: Array.isArray(steps) ? steps.length : 0 })) };
      case 'routine-save': return this.saveRoutine(payload);
      case 'automation-run': {
        const routine = payload.routine || this.routines()[String(payload.routineId || '')];
        if (!routine) throw new Error('Unknown routine. Supply routineId or an inline routine object.');
        return this.automation.run(routine, { execute: payload.execute === true, calibration: this.state.calibration, windowTitle: payload.windowTitle });
      }
      case 'automation-stop': return this.automation.stop();
      default: throw new Error(`Unsupported IdleOn agent action: ${actionId}`);
    }
  }
}

module.exports = { DEFAULT_ROUTINES, IdleonAgentService };
