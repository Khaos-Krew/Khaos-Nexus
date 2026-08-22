'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { envSecret } = require('../shared/config.cjs');

function thoraStatus(config) {
  const enabled = config.thora?.enabled === true;
  const executable = envSecret(config.thora?.executableEnv);
  return { enabled, configured: Boolean(executable), executableExists: Boolean(executable && fs.existsSync(executable)) };
}

function launchThora(config) {
  const status = thoraStatus(config);
  if (!status.enabled) throw new Error('Thora integration is disabled.');
  if (!status.configured || !status.executableExists) throw new Error(`Set ${config.thora?.executableEnv || 'NEXUS_THORA_PATH'} to the approved Thora executable.`);
  const child = spawn(envSecret(config.thora.executableEnv), [], { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
  child.unref();
  return { launched: true };
}

module.exports = { thoraStatus, launchThora };
