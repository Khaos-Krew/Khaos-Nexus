'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SNAPSHOT_VERSION = 1;

function snapshotError(message, code = 'NEXUS_SNAPSHOT_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function jsonClone(value, trail = 'state') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw snapshotError(`${trail} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => jsonClone(entry, `${trail}[${index}]`));
  if (!value || typeof value !== 'object') throw snapshotError(`${trail} must contain only JSON-compatible values.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw snapshotError(`${trail} must contain only plain objects.`);
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) throw snapshotError(`${trail}.${key} cannot be undefined.`);
    output[key] = jsonClone(entry, `${trail}.${key}`);
  }
  return output;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksum(payload) {
  return crypto.createHash('sha256').update(canonical(payload)).digest('hex');
}

class FileSnapshotStore {
  constructor(options = {}) {
    if (!options.directory) throw snapshotError('directory is required.');
    this.directory = path.resolve(String(options.directory));
  }

  filePath(nameInput) {
    const name = String(nameInput || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) throw snapshotError('Snapshot name must be a stable token.');
    return path.join(this.directory, `${name}.json`);
  }

  save(name, input = {}) {
    const sequence = Number(input.sequence || 0);
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw snapshotError('sequence must be a non-negative safe integer.');
    const payload = {
      snapshotVersion: SNAPSHOT_VERSION,
      schemaVersion: Number.isSafeInteger(Number(input.schemaVersion)) ? Number(input.schemaVersion) : 1,
      sequence,
      createdAt: input.createdAt ? new Date(input.createdAt).toISOString() : new Date().toISOString(),
      state: jsonClone(input.state ?? {})
    };
    const record = { ...payload, checksum: checksum(payload) };
    fs.mkdirSync(this.directory, { recursive: true });
    const filePath = this.filePath(name);
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    const fd = fs.openSync(temporary, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, filePath);
    return Object.freeze(jsonClone(record));
  }

  load(name) {
    const filePath = this.filePath(name);
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw snapshotError(`Snapshot could not be read: ${error.message}`, 'NEXUS_SNAPSHOT_CORRUPT');
    }
    if (parsed?.snapshotVersion !== SNAPSHOT_VERSION) throw snapshotError('Unsupported snapshot version.', 'NEXUS_SNAPSHOT_VERSION');
    const payload = {
      snapshotVersion: parsed.snapshotVersion,
      schemaVersion: parsed.schemaVersion,
      sequence: parsed.sequence,
      createdAt: parsed.createdAt,
      state: parsed.state
    };
    if (!/^[a-f0-9]{64}$/.test(String(parsed.checksum || '')) || checksum(payload) !== parsed.checksum) {
      throw snapshotError('Snapshot checksum verification failed.', 'NEXUS_SNAPSHOT_CORRUPT');
    }
    return Object.freeze(jsonClone(parsed));
  }
}

module.exports = {
  SNAPSHOT_VERSION,
  FileSnapshotStore,
  canonical,
  checksum
};
