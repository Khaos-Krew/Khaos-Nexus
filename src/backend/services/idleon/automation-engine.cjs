'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ALLOWED_STEPS = new Set(['focus-window', 'click', 'double-click', 'key', 'text', 'wait', 'repeat']);
const SAFE_KEYS = /^[A-Za-z0-9+%^~(){}\[\]_. -]{1,64}$/;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function validatePoint(point, calibration) {
  if (typeof point === 'string') {
    const found = calibration?.[point];
    if (!found) throw new Error(`Calibration point not found: ${point}`);
    return { x: Number(found.x), y: Number(found.y) };
  }
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) throw new Error('Click steps require point or numeric x/y.');
  return { x: Number(point.x), y: Number(point.y) };
}

function expandSteps(steps, calibration, depth = 0) {
  if (!Array.isArray(steps)) throw new Error('Routine steps must be an array.');
  if (depth > 4) throw new Error('Routine nesting is too deep.');
  const out = [];
  for (const raw of steps) {
    const step = raw && typeof raw === 'object' ? raw : {};
    if (!ALLOWED_STEPS.has(step.type)) throw new Error(`Unsupported automation step: ${step.type || 'unknown'}`);
    if (step.type === 'repeat') {
      const count = Math.max(1, Math.min(25, Number(step.count) || 1));
      const nested = expandSteps(step.steps, calibration, depth + 1);
      for (let i = 0; i < count; i += 1) out.push(...clone(nested));
      continue;
    }
    if (step.type === 'click' || step.type === 'double-click') {
      const point = step.point ? validatePoint(step.point, calibration) : validatePoint(step, calibration);
      out.push({ type: step.type, ...point, delayAfterMs: Math.max(0, Math.min(10000, Number(step.delayAfterMs) || 0)) });
      continue;
    }
    if (step.type === 'focus-window') {
      const title = String(step.title || '').trim();
      if (!title || title.length > 160) throw new Error('focus-window requires a short title.');
      out.push({ type: step.type, title });
      continue;
    }
    if (step.type === 'wait') {
      out.push({ type: step.type, ms: Math.max(0, Math.min(600000, Number(step.ms) || 0)) });
      continue;
    }
    if (step.type === 'key') {
      const keys = String(step.keys || '').trim();
      if (!SAFE_KEYS.test(keys)) throw new Error('key step contains unsupported key syntax.');
      out.push({ type: step.type, keys });
      continue;
    }
    if (step.type === 'text') {
      const text = String(step.text ?? '');
      if (text.length > 500) throw new Error('text step is limited to 500 characters.');
      out.push({ type: step.type, text });
    }
  }
  if (out.length > 500) throw new Error('Routine expands beyond the 500-step safety limit.');
  return out;
}

class IdleonAutomationEngine {
  constructor(options = {}) {
    this.enabled = options.enabled === true;
    this.platform = options.platform || process.platform;
    this.scriptPath = options.scriptPath || path.join(__dirname, 'automation-windows.ps1');
    this.windowTitle = options.windowTitle || 'Legends Of IdleOn';
    this.logger = options.logger || console;
    this.child = null;
    this.lastRun = null;
  }

  status() {
    return {
      enabled: this.enabled,
      platform: this.platform,
      supported: this.platform === 'win32',
      running: Boolean(this.child),
      emergencyStopKey: 'F12',
      lastRun: this.lastRun
    };
  }

  compile(routine, calibration = {}) {
    if (!routine || typeof routine !== 'object') throw new Error('Routine is required.');
    return {
      id: String(routine.id || 'inline-routine'),
      name: String(routine.name || routine.id || 'Inline routine'),
      steps: expandSteps(routine.steps || [], calibration),
      emergencyStopKey: 'F12'
    };
  }

  async run(routine, options = {}) {
    const compiled = this.compile(routine, options.calibration || {});
    const dryRun = options.execute !== true;
    if (dryRun) {
      this.lastRun = { id: compiled.id, dryRun: true, ok: true, startedAt: new Date().toISOString(), stepCount: compiled.steps.length };
      return { dryRun: true, compiled, status: this.status() };
    }
    if (!this.enabled) throw new Error('IdleOn gameplay automation is disabled. Set idleon.automation.enabled=true or NEXUS_IDLEON_AUTOMATION=1 on the local Windows agent.');
    if (this.platform !== 'win32') throw new Error('Live gameplay automation is only supported by the local Windows agent.');
    if (this.child) throw new Error('An IdleOn automation routine is already running.');
    if (!fs.existsSync(this.scriptPath)) throw new Error(`Windows automation runner is missing: ${this.scriptPath}`);

    const payload = { ...compiled, defaultWindowTitle: options.windowTitle || this.windowTitle };
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    const startedAt = new Date().toISOString();
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdin.end(JSON.stringify(payload));

    const result = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
    }).finally(() => { this.child = null; });

    this.lastRun = { id: compiled.id, dryRun: false, ok: result.code === 0, startedAt, finishedAt: new Date().toISOString(), stepCount: compiled.steps.length, exitCode: result.code };
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || `Automation runner exited with code ${result.code}.`);
    return { dryRun: false, compiled: { ...compiled, steps: undefined, stepCount: compiled.steps.length }, runner: result.stdout, status: this.status() };
  }

  stop() {
    if (!this.child) return { stopped: false, reason: 'not-running' };
    const pid = this.child.pid;
    this.child.kill();
    this.child = null;
    return { stopped: true, pid };
  }
}

module.exports = { ALLOWED_STEPS, expandSteps, IdleonAutomationEngine };
