'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const empty = () => ({ version: 1, revision: 0, seasons: [], runs: [], receipts: [], awards: [], darkzone: [], audit: [] });
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Single atomic snapshot: progress, deduplication receipts, score and audit commit together.
// A lock prevents concurrent processes from overwriting each other's committed changes.
class ProtocolStore {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../../../data')) {
    this.file = path.join(root, 'nexus-protocol-v1.json');
  }
  read() {
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return empty(); throw e; }
    const envelope = JSON.parse(raw);
    const state = envelope.state;
    if (!state || state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      ['seasons', 'runs', 'receipts', 'awards', 'darkzone', 'audit'].some((key) => !Array.isArray(state[key])) ||
      envelope.checksum !== digest(state)) throw new Error('Protocol storage integrity check failed; no changes applied');
    return state;
  }
  transact(actor, action, fn) {
    if (!actor || !action) throw new Error('Protocol audit actor and action required');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    let fd;
    try { fd = fs.openSync(lock, 'wx', 0o600); } catch (e) {
      if (e.code === 'EEXIST') throw new Error('Protocol storage busy; retry or inspect stale lock after a crash');
      throw e;
    }
    const tmp = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      const state = this.read();
      const result = fn(state);
      if (result?.then) throw new Error('Protocol transactions must be synchronous');
      state.revision += 1;
      state.audit.push({ id: crypto.randomUUID(), revision: state.revision, actor, action, at: new Date().toISOString() });
      const encoded = JSON.stringify({ checksum: digest(state), state });
      if (Buffer.byteLength(encoded) > 64 * 1024 * 1024) throw new Error('Protocol store capacity reached; archive/migrate before accepting more data');
      const out = fs.openSync(tmp, 'wx', 0o600);
      try { fs.writeFileSync(out, encoded); fs.fsyncSync(out); } finally { fs.closeSync(out); }
      fs.renameSync(tmp, this.file);
      if (process.platform !== 'win32') {
        const dir = fs.openSync(path.dirname(this.file), 'r');
        try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      }
      return result;
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      fs.closeSync(fd);
      fs.unlinkSync(lock);
    }
  }
}
module.exports = { ProtocolStore };
