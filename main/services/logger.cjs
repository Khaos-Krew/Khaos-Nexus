'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { redactObject, redactText } = require('../../shared/redaction.cjs');
const { runtimePaths } = require('../portable-runtime.cjs');

class AppLogger extends EventEmitter {
  constructor(logDirectory, explicitSecretsProvider = () => []) {
    super();
    this.logDirectory = logDirectory;
    this.logFile = path.join(logDirectory, 'manager.log');
    this.explicitSecretsProvider = explicitSecretsProvider;
    this.entries = [];
    fs.mkdirSync(logDirectory, { recursive: true });
    const portable = runtimePaths();
    this.portableLogFile = portable ? path.join(portable.logs, 'manager.log') : null;
  }

  rotateFileIfNeeded(logFile) {
    if (!logFile) return;
    try {
      const stat = fs.statSync(logFile);
      if (stat.size < 2 * 1024 * 1024) return;
      const oldest = `${logFile}.5`;
      if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
      for (let index = 4; index >= 1; index -= 1) {
        const current = `${logFile}.${index}`;
        const next = `${logFile}.${index + 1}`;
        if (fs.existsSync(current)) fs.renameSync(current, next);
      }
      fs.renameSync(logFile, `${logFile}.1`);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(error);
    }
  }

  rotateIfNeeded() {
    this.rotateFileIfNeeded(this.logFile);
    this.rotateFileIfNeeded(this.portableLogFile);
  }

  write(level, message, meta = {}, source = 'manager') {
    const secrets = this.explicitSecretsProvider();
    const entry = {
      time: new Date().toISOString(),
      source,
      level,
      message: redactText(message, secrets),
      meta: redactObject(meta, secrets)
    };
    this.entries.push(entry);
    if (this.entries.length > 1000) this.entries.splice(0, this.entries.length - 1000);
    this.rotateIfNeeded();
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(this.logFile, line, 'utf8');
    if (this.portableLogFile) {
      try { fs.appendFileSync(this.portableLogFile, line, 'utf8'); }
      catch (error) { console.error('[Khaos Nexus] Could not mirror manager log to portable data.', error); }
    }
    this.emit('entry', entry);
    return entry;
  }

  ingest(entry) {
    return this.write(entry.level || 'info', entry.message || '', entry.meta || {}, entry.source || 'bot');
  }

  info(message, meta) { return this.write('info', message, meta); }
  warn(message, meta) { return this.write('warn', message, meta); }
  error(message, meta) { return this.write('error', message, meta); }
  fatal(message, meta) { return this.write('fatal', message, meta); }

  recent(limit = 300) {
    return this.entries.slice(-Math.min(1000, Math.max(1, limit)));
  }

  clear() {
    this.entries = [];
    fs.writeFileSync(this.logFile, '', 'utf8');
    if (this.portableLogFile) {
      try { fs.writeFileSync(this.portableLogFile, '', 'utf8'); } catch {}
    }
    this.emit('cleared');
  }
}

module.exports = { AppLogger };
