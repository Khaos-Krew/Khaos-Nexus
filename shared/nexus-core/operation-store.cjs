'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const STORE_VERSION = 1;

function storeError(message, code = 'NEXUS_OPERATION_STORE_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fileNameFor(idempotencyKey) {
  return `${crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex')}.json`;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class FileOperationStore {
  constructor(options = {}) {
    if (!options.directory) throw storeError('directory is required.');
    this.directory = path.resolve(String(options.directory));
    this.now = options.now || (() => new Date().toISOString());
  }

  filePath(idempotencyKey) {
    return path.join(this.directory, fileNameFor(idempotencyKey));
  }

  writeAtomic(filePath, record) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2), 'utf8');
    const fd = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, filePath);
  }

  read(idempotencyKey) {
    const filePath = this.filePath(idempotencyKey);
    try {
      const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (record?.storeVersion !== STORE_VERSION || record.idempotencyKey !== idempotencyKey) {
        throw storeError('Operation store record failed validation.', 'NEXUS_OPERATION_STORE_CORRUPT');
      }
      return Object.freeze(clone(record));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      if (error.code?.startsWith?.('NEXUS_')) throw error;
      throw storeError(`Operation store read failed: ${error.message}`, 'NEXUS_OPERATION_STORE_CORRUPT');
    }
  }

  begin(action) {
    const idempotencyKey = String(action?.idempotencyKey || '');
    if (!idempotencyKey) throw storeError('action.idempotencyKey is required.');
    fs.mkdirSync(this.directory, { recursive: true });
    const filePath = this.filePath(idempotencyKey);
    const record = {
      storeVersion: STORE_VERSION,
      idempotencyKey,
      operationId: String(action.operationId || ''),
      action: String(action.action || ''),
      correlationId: String(action.correlationId || ''),
      state: 'running',
      startedAt: this.now(),
      completedAt: null,
      reconciledAt: null,
      resultStatus: null,
      errorCode: null
    };

    let fd;
    try {
      fd = fs.openSync(filePath, 'wx');
      fs.writeFileSync(fd, JSON.stringify(record, null, 2), 'utf8');
      fs.fsyncSync(fd);
    } catch (error) {
      if (error.code === 'EEXIST') {
        return Object.freeze({ acquired: false, record: this.read(idempotencyKey) });
      }
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    return Object.freeze({ acquired: true, record: Object.freeze(clone(record)) });
  }

  complete(action, result) {
    const idempotencyKey = String(action?.idempotencyKey || '');
    const current = this.read(idempotencyKey);
    if (!current) throw storeError('Operation has not been started.', 'NEXUS_OPERATION_NOT_STARTED');
    if (current.operationId !== action.operationId || current.action !== action.action) {
      throw storeError('Operation completion does not match the acquired operation.', 'NEXUS_OPERATION_CONFLICT');
    }
    if (current.state !== 'running') {
      throw storeError(`Operation cannot complete from ${current.state} state.`, 'NEXUS_OPERATION_NOT_RUNNING');
    }

    const next = {
      ...current,
      state: 'completed',
      completedAt: this.now(),
      resultStatus: String(result?.status || 'failed'),
      errorCode: result?.error?.code ? String(result.error.code) : null
    };
    this.writeAtomic(this.filePath(idempotencyKey), next);
    return Object.freeze(clone(next));
  }

  reconcileInterrupted() {
    if (!fs.existsSync(this.directory)) {
      return Object.freeze({ scanned: 0, interrupted: 0, completed: 0, uncertainKeys: Object.freeze([]) });
    }

    let scanned = 0;
    let interrupted = 0;
    let completed = 0;
    const uncertainKeys = [];
    for (const name of fs.readdirSync(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/i.test(name)) continue;
      scanned += 1;
      const filePath = path.join(this.directory, name);
      let record;
      try { record = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
      catch (error) { throw storeError(`Operation store contains unreadable record ${name}: ${error.message}`, 'NEXUS_OPERATION_STORE_CORRUPT'); }
      if (record?.storeVersion !== STORE_VERSION || !record.idempotencyKey || fileNameFor(record.idempotencyKey) !== name) {
        throw storeError(`Operation store record ${name} failed validation.`, 'NEXUS_OPERATION_STORE_CORRUPT');
      }
      if (record.state === 'completed') {
        completed += 1;
        continue;
      }
      if (record.state === 'uncertain') {
        interrupted += 1;
        uncertainKeys.push(record.idempotencyKey);
        continue;
      }
      if (record.state !== 'running') {
        throw storeError(`Operation store record ${name} has unsupported state ${record.state}.`, 'NEXUS_OPERATION_STORE_CORRUPT');
      }

      const next = {
        ...record,
        state: 'uncertain',
        reconciledAt: this.now(),
        resultStatus: null,
        errorCode: 'NEXUS_OPERATION_INTERRUPTED'
      };
      this.writeAtomic(filePath, next);
      interrupted += 1;
      uncertainKeys.push(record.idempotencyKey);
    }

    return Object.freeze({
      scanned,
      interrupted,
      completed,
      uncertainKeys: Object.freeze(uncertainKeys.slice().sort())
    });
  }
}

module.exports = {
  STORE_VERSION,
  FileOperationStore
};
