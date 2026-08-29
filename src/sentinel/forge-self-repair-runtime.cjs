'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeSelfRepairPolicy } = require('./forge-self-repair-policy.cjs');

function roundMb(bytes) {
  return Math.round((Number(bytes || 0) / 1024 / 1024) * 10) / 10;
}

function safePathParent(filePath) {
  try {
    return path.dirname(path.resolve(String(filePath || '.')));
  } catch {
    return '.';
  }
}

function collectStateStoreDiagnostics(stateFile) {
  const directory = safePathParent(stateFile);
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    return {
      ok: true,
      state: 'writable',
      directory
    };
  } catch (error) {
    return {
      ok: false,
      state: 'unwritable',
      directory,
      error: String(error?.message || error).replace(/[\r\n\t]+/g, ' ').slice(0, 240)
    };
  }
}

function collectProcessDiagnostics(options = {}) {
  const memory = process.memoryUsage();
  const policy = options.policy || normalizeSelfRepairPolicy(options.env || process.env);
  const rssMb = roundMb(memory.rss);
  const heapUsedMb = roundMb(memory.heapUsed);
  const heapTotalMb = roundMb(memory.heapTotal);
  const externalMb = roundMb(memory.external);
  const heapUtilization = heapTotalMb > 0 ? Math.round((heapUsedMb / heapTotalMb) * 1000) / 10 : 0;
  const threshold = Number(policy.rssWarnMb || 0);
  const memoryPressure = threshold > 0 && rssMb >= threshold;

  return {
    ok: !memoryPressure,
    state: memoryPressure ? 'rss-threshold-exceeded' : 'healthy',
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    memory: {
      rssMb,
      heapUsedMb,
      heapTotalMb,
      heapUtilizationPercent: heapUtilization,
      externalMb,
      rssWarnMb: threshold
    }
  };
}

function collectLocalRuntimeDiagnostics(options = {}) {
  const policy = options.policy || normalizeSelfRepairPolicy(options.env || process.env);
  const processState = collectProcessDiagnostics({ policy });
  const persistence = collectStateStoreDiagnostics(options.stateFile);
  return {
    ok: Boolean(processState.ok && persistence.ok),
    state: processState.ok && persistence.ok ? 'healthy' : 'degraded',
    process: processState,
    persistence
  };
}

module.exports = {
  roundMb,
  safePathParent,
  collectStateStoreDiagnostics,
  collectProcessDiagnostics,
  collectLocalRuntimeDiagnostics
};
