'use strict';

const { mkdir, rm } = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { evaluateSentinalRelease } = require('./release-gate.cjs');

const ALLOWED_COMMANDS = new Set(['npm', 'node', 'npx', 'python', 'python3', 'pytest', 'dotnet', 'cmake', 'ctest', 'pwsh', 'powershell']);

function safeSegment(value) { return String(value || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120); }

function normalizeCommands(payload) {
  if (!Array.isArray(payload?.commands) || !payload.commands.length) throw new Error('Job payload.commands must be a non-empty array');
  return payload.commands.map((entry) => {
    if (!entry || typeof entry !== 'object' || !ALLOWED_COMMANDS.has(String(entry.command || '').toLowerCase())) {
      throw new Error('Job contains a command that is not permitted');
    }
    return { command: String(entry.command), args: Array.isArray(entry.args) ? entry.args.map(String) : [] };
  });
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, shell: false, windowsHide: true });
    let output = '';
    const collect = (chunk) => { output = `${output}${chunk}`.slice(-40_000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Command timed out: ${command}`)); }, options.timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(Object.assign(new Error(`Command failed (${code}): ${command}`), { output }));
    });
  });
}

class JobExecutor {
  constructor(config, store, options = {}) {
    this.config = config; this.store = store; this.fetchImpl = options.fetchImpl || global.fetch;
  }

  async execute(job) {
    if (job.stage === 'deploy') return this.deploySentinal(job);
    if (!this.config.allowedRepos.has(job.repository)) throw new Error(`Repository is not allowed: ${job.repository}`);
    const commands = normalizeCommands(job.payload);
    const workdir = path.join(this.config.workspaceRoot, safeSegment(job.job_id));
    await rm(workdir, { recursive: true, force: true }); await mkdir(workdir, { recursive: true });
    const cloneUrl = this.config.githubToken
      ? `https://x-access-token:${encodeURIComponent(this.config.githubToken)}@github.com/${job.repository}.git`
      : `https://github.com/${job.repository}.git`;
    const outputs = [];
    try {
      outputs.push(await runCommand('git', ['clone', '--filter=blob:none', '--no-checkout', cloneUrl, '.'], { cwd: workdir, env: process.env, timeoutMs: this.config.commandTimeoutMs }));
      outputs.push(await runCommand('git', ['checkout', '--detach', job.commit_sha || job.git_ref], { cwd: workdir, env: process.env, timeoutMs: this.config.commandTimeoutMs }));
      for (const item of commands) outputs.push(await runCommand(item.command, item.args, { cwd: workdir, env: { ...process.env, CI: 'true' }, timeoutMs: this.config.commandTimeoutMs }));
      return { status: 'passed', result: { completedAt: new Date().toISOString(), output: outputs.join('\n').slice(-40_000) } };
    } finally { await rm(workdir, { recursive: true, force: true }).catch(() => {}); }
  }

  async deploySentinal(job) {
    const release = await this.store.releaseForDeployment(job.release_id);
    const gate = evaluateSentinalRelease(release);
    if (!gate.allowed) return { status: 'blocked', result: { gate } };
    if (!this.config.deployWebhookUrl || !this.config.sentinalHealthUrl) {
      return { status: 'blocked', result: { gate, reason: 'deployment_adapter_not_configured' } };
    }
    const unlock = await this.store.acquireProductionLock(job.release_id);
    if (!unlock) return { status: 'blocked', result: { gate, reason: 'production_lock_busy' } };
    try {
      await this.store.setDeploymentStatus(job.release_id, 'deploying');
      const response = await this.fetchImpl(this.config.deployWebhookUrl, { method: 'POST' });
      if (!response.ok) throw new Error(`Railway deploy hook failed with HTTP ${response.status}`);
      const deadline = Date.now() + this.config.healthTimeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        const health = await this.fetchImpl(this.config.sentinalHealthUrl, { headers: { accept: 'application/json' } }).catch(() => null);
        if (health?.ok) {
          await this.store.setDeploymentStatus(job.release_id, 'healthy', { healthCheckedAt: new Date().toISOString() });
          return { status: 'passed', result: { gate, healthy: true } };
        }
      }
      throw new Error('Replacement Sentinal did not become healthy before the deadline');
    } catch (error) {
      await this.store.setDeploymentStatus(job.release_id, 'failed', { error: error.message });
      throw error;
    } finally { await unlock(); }
  }
}

module.exports = { JobExecutor, normalizeCommands, ALLOWED_COMMANDS };
