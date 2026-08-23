'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { envSecret } = require('../shared/config.cjs');

function executablePath(config) {
  return String(config.thora?.executablePath || envSecret(config.thora?.executableEnv) || '').trim();
}

function thoraStatus(config) {
  const enabled = config.thora?.enabled === true;
  const executable = executablePath(config);
  return {
    enabled,
    configured: Boolean(executable),
    executableExists: Boolean(executable && fs.existsSync(executable)),
    source: config.thora?.executablePath ? 'desktop-config' : executable ? 'environment' : 'missing'
  };
}

function launchThora(config) {
  const status = thoraStatus(config);
  if (!status.enabled) throw new Error('Thora integration is disabled.');
  if (!status.configured || !status.executableExists) throw new Error('Choose the approved Thora executable in Nexus Settings before launching Thora.');
  const child = spawn(executablePath(config), [], { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
  child.unref();
  return { launched: true };
}

module.exports = { executablePath, thoraStatus, launchThora };
