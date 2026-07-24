'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const electron = require('electron');
const { errorFingerprint, redactText } = require('../shared/redaction.cjs');

let installed = false;
let lastCrashPath = null;
let lastCrash = null;
let recentFingerprint = null;
let recentFingerprintAt = 0;

function safeUserDataPath() {
  try { return electron.app.getPath('userData'); }
  catch { return path.join(os.tmpdir(), 'Khaos-Nexus'); }
}

function crashDirectory() {
  return path.join(safeUserDataPath(), 'crash-reports');
}

function recentManagerLog(limit = 120) {
  try {
    const logPath = path.join(safeUserDataPath(), 'logs', 'manager.log');
    if (!fs.existsSync(logPath)) return [];
    return fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => redactText(line));
  } catch {
    return [];
  }
}

function safeError(errorLike) {
  const error = errorLike instanceof Error ? errorLike : new Error(String(errorLike || 'Unknown desktop error'));
  return {
    name: String(error.name || 'Error').slice(0, 120),
    message: redactText(error.message || 'Unknown desktop error').slice(0, 2000),
    stack: redactText(error.stack || '').slice(0, 16000),
    code: error.code ? String(error.code).slice(0, 120) : null
  };
}

function writeCrashReport(errorLike, origin = 'desktop-main') {
  try {
    const safe = safeError(errorLike);
    const id = errorFingerprint(errorLike);
    const now = Date.now();
    if (id === recentFingerprint && now - recentFingerprintAt < 5000) return lastCrash;
    recentFingerprint = id;
    recentFingerprintAt = now;

    const createdAt = new Date(now).toISOString();
    const report = {
      format: 'khaos-nexus-crash-report',
      formatVersion: 1,
      id,
      createdAt,
      origin: String(origin || 'desktop-main'),
      appVersion: (() => { try { return electron.app.getVersion(); } catch { return 'unknown'; } })(),
      packaged: Boolean(electron.app?.isPackaged),
      platform: process.platform,
      architecture: process.arch,
      operatingSystem: `${os.type()} ${os.release()}`,
      processUptimeSeconds: Math.round(process.uptime()),
      error: safe,
      recentLogs: recentManagerLog(),
      note: 'Protected credentials are not intentionally included. Review before sharing.'
    };
    const directory = crashDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const safeTime = createdAt.replace(/[:.]/g, '-');
    lastCrashPath = path.join(directory, `crash-${safeTime}-${id}.json`);
    fs.writeFileSync(lastCrashPath, JSON.stringify(report, null, 2), 'utf8');
    lastCrash = { ...report, filePath: lastCrashPath };
    return lastCrash;
  } catch (reportError) {
    console.error('[Khaos Nexus] Could not write the crash report.', reportError);
    return null;
  }
}

function loadNewestCrash() {
  if (lastCrash) return lastCrash;
  try {
    const directory = crashDirectory();
    if (!fs.existsSync(directory)) return null;
    const file = fs.readdirSync(directory)
      .filter((name) => /^crash-.*\.json$/i.test(name))
      .map((name) => ({ name, path: path.join(directory, name), stat: fs.statSync(path.join(directory, name)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
    if (!file) return null;
    const report = JSON.parse(fs.readFileSync(file.path, 'utf8'));
    lastCrashPath = file.path;
    lastCrash = { ...report, filePath: file.path };
    return lastCrash;
  } catch {
    return null;
  }
}

function publicCrash(report) {
  if (!report) return null;
  return {
    id: report.id,
    createdAt: report.createdAt,
    origin: report.origin,
    appVersion: report.appVersion,
    error: report.error,
    filePath: report.filePath
  };
}

function registerIpc() {
  if (registerIpc.done) return;
  registerIpc.done = true;
  electron.ipcMain.handle('crash-diagnostics:get-last', () => publicCrash(loadNewestCrash()));
  electron.ipcMain.handle('crash-diagnostics:open-folder', async () => {
    fs.mkdirSync(crashDirectory(), { recursive: true });
    const result = await electron.shell.openPath(crashDirectory());
    if (result) throw new Error(result);
    return { opened: true, path: crashDirectory() };
  });
  electron.ipcMain.handle('crash-diagnostics:copy-last', () => {
    const report = loadNewestCrash();
    if (!report) throw new Error('No Khaos Nexus crash report is available.');
    const text = [
      `Khaos Nexus crash ${report.id}`,
      `Version: ${report.appVersion}`,
      `Time: ${report.createdAt}`,
      `Origin: ${report.origin}`,
      `Error: ${report.error?.message || 'Unknown'}`,
      '',
      report.error?.stack || ''
    ].join('\n').slice(0, 30000);
    electron.clipboard.writeText(text);
    return { copied: true, id: report.id };
  });
}

function install() {
  if (installed) return;
  installed = true;
  process.on('uncaughtExceptionMonitor', (error, origin) => writeCrashReport(error, origin || 'uncaughtException'));
  process.on('unhandledRejection', (reason) => writeCrashReport(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection'));
  electron.app.whenReady().then(registerIpc).catch((error) => writeCrashReport(error, 'crash-diagnostics-initialization'));
}

module.exports = { install, writeCrashReport, loadNewestCrash, publicCrash, crashDirectory };
