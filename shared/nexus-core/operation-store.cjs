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

    const next = {
      ...current,
      state: 'completed',
      completedAt: this.now(),
      resultStatus: String(result?.status || 'failed'),
      errorCode: result?.error?.code ? String(result.error.code) : null
    };
    const filePath = this.filePath(idempotencyKey);
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8');
    // Windows rejects fsync on a read-only descriptor. Open the completed
    // record read/write so durability semantics remain enabled cross-platform.
    const fd = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, filePath);
    return Object.freeze(clone(next));
  }
}

module.exports = {
  STORE_VERSION,
  FileOperationStore
};
