'use strict';

const { app } = require('electron');
const { appendLog, writeDiagnostic, writeReadme, runtimePaths } = require('./portable-runtime.cjs');

let installed = false;

function errorPayload(source, errorLike, extra = {}) {
  const error = errorLike instanceof Error ? errorLike : new Error(String(errorLike || 'Unknown error'));
  return {
    time: new Date().toISOString(),
    source,
    message: String(error.message || error).slice(0, 2000),
    stack: String(error.stack || '').slice(0, 16000),
    ...extra
  };
}

function retain(source, errorLike, extra = {}) {
  const payload = errorPayload(source, errorLike, extra);
  try {
    appendLog('bootstrap.log', payload);
    writeDiagnostic('latest-bootstrap-error.json', payload);
  } catch {}
  return payload;
}

function install() {
  if (installed) return;
  installed = true;

  const paths = runtimePaths();
  if (!paths) return;

  appendLog('bootstrap.log', {
    time: new Date().toISOString(),
    source: 'portable-bootstrap',
    event: 'process-started',
    pid: process.pid,
    execPath: process.execPath,
    portableDirectory: paths.root
  });
  writeReadme({ appVersion: app.getVersion?.() || 'unknown' });

  process.on('uncaughtExceptionMonitor', (error, origin) => retain('uncaught-exception-monitor', error, { origin }));
  process.on('unhandledRejection', (reason) => retain('unhandled-rejection', reason));
  process.on('warning', (warning) => retain('process-warning', warning));

  app.on('web-contents-created', (_event, contents) => {
    contents.on('preload-error', (_preloadEvent, preloadPath, error) => {
      retain('preload-error', error, { preloadPath: String(preloadPath || '') });
    });
    contents.on('render-process-gone', (_goneEvent, details) => {
      retain('render-process-gone', details?.reason || 'Renderer process exited', { details });
    });
  });

  app.on('child-process-gone', (_event, details) => {
    retain('child-process-gone', details?.reason || 'Child process exited', { details });
  });

  app.whenReady().then(() => {
    appendLog('bootstrap.log', {
      time: new Date().toISOString(),
      source: 'portable-bootstrap',
      event: 'electron-ready',
      version: app.getVersion(),
      userDataPath: app.getPath('userData')
    });
    writeReadme({ appVersion: app.getVersion(), canonicalUserData: app.getPath('userData') });
  }).catch((error) => retain('electron-ready-failed', error));

  app.on('before-quit', () => {
    appendLog('bootstrap.log', {
      time: new Date().toISOString(),
      source: 'portable-bootstrap',
      event: 'before-quit'
    });
  });
}

module.exports = { errorPayload, retain, install };
