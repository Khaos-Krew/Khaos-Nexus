'use strict';

const fs = require('node:fs');
const path = require('node:path');

function absolutePath(value, label) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} is required when NEXUS_CI_SMOKE=1.`);
  if (!path.isAbsolute(raw)) throw new Error(`${label} must be an absolute path.`);
  return path.resolve(raw);
}

function ciSmokeConfig(env = process.env) {
  const enabled = String(env.NEXUS_CI_SMOKE || '').trim() === '1';
  if (!enabled) return { enabled: false, userDataPath: '', resultPath: '' };
  return {
    enabled: true,
    userDataPath: absolutePath(env.NEXUS_CI_USER_DATA, 'NEXUS_CI_USER_DATA'),
    resultPath: absolutePath(env.NEXUS_CI_SMOKE_RESULT, 'NEXUS_CI_SMOKE_RESULT')
  };
}

function writeCiSmokeResult(config, payload = {}) {
  if (!config?.enabled || !config.resultPath) return false;
  const target = path.resolve(config.resultPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify({
    ...payload,
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, 'utf8');
  return true;
}

module.exports = { absolutePath, ciSmokeConfig, writeCiSmokeResult };
