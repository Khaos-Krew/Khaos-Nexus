'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { redactObject, redactText } = require('../../shared/redaction.cjs');

class AppLogger extends EventEmitter {
  constructor(logDirectory, explicitSecretsProvider = () => []) {
    super();
    this.logDirectory = logDirectory;
    this.logFile = path.join(logDirectory, 'manager.log');
    this.explicitSecretsProvider = explicitSecretsProvider;
    this.entries = [];
    fs.mkdirSync(logDirectory, { recursive: true });
  }

  rotateIfNeeded() {
    try {
      const stat = fs.statSync(this.logFile);
      if (stat.size < 2 * 1024 * 1024) return;
      const oldest = `${this.logFile}.5`;
      if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
      for (let index = 4; index >= 1; index -= 1) {
        const current = `${this.logFile}.${index}`;
        const next = `${this.logFile}.${index + 1}`;
        if (fs.existsSync(current)) fs.renameSync(current, next);
      }
      fs.renameSync(this.logFile, `${this.logFile}.1`);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error(error);
    }
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
    fs.appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8');
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
    this.emit('cleared');
  }
}

module.exports = { AppLogger };
