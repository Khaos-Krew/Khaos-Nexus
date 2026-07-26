'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');

let installed = false;

function sanitize(payload = {}) {
  return {
    format: 'khaos-nexus-startup-preload-error',
    formatVersion: 1,
    stage: String(payload.stage || 'unknown').slice(0, 100),
    message: String(payload.message || 'Unknown preload failure').slice(0, 1600),
    stack: String(payload.stack || '').slice(0, 12000),
    reportedAt: payload.time && Number.isFinite(new Date(payload.time).getTime())
      ? new Date(payload.time).toISOString()
      : new Date().toISOString(),
    appVersion: electron.app.getVersion?.() || null
  };
}

function retain(payload) {
  const record = sanitize(payload);
  try {
    const userData = electron.app.getPath('userData');
    const filePath = path.join(userData, 'startup-preload-error.json');
    const logPath = path.join(userData, 'logs', 'startup-preload-error.log');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${record.reportedAt}] ${record.stage}: ${record.message}\n${record.stack}\n`, 'utf8');
  } catch (error) {
    console.error('[Khaos Nexus] Could not retain preload failure diagnostics.', error);
  }
  console.error('[Khaos Nexus] Main preload initialization failed.', record);
  return record;
}

function install() {
  if (installed) return;
  installed = true;
  electron.ipcMain.on('startup-health:preload-failed', (_event, payload) => retain(payload));
}

module.exports = { sanitize, retain, install };
