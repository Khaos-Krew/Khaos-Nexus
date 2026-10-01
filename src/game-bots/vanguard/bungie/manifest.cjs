'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { DatabaseSync } = require('node:sqlite');
const { readJson, writeJson } = require('../../panel-message.cjs');

const REQUIRED_TABLES = Object.freeze(['DestinyMilestoneDefinition', 'DestinyInventoryItemDefinition']);
const SQLITE_MAGIC = 'SQLite format 3';

function safeVersion(version) {
  const clean = String(version || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
  return clean || 'unknown';
}

function isSqlite(buffer) {
  return buffer.length >= 16 && buffer.subarray(0, 15).toString('utf8') === SQLITE_MAGIC;
}

function unzipSqlite(buffer) {
  if (isSqlite(buffer)) return buffer;
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.subarray(nameStart, nameStart + nameLength).toString('utf8');
    if (!name.endsWith('/')) {
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      let inflated = null;
      if (method === 0) inflated = Buffer.from(data);
      else if (method === 8) inflated = zlib.inflateRawSync(data);
      if (inflated && isSqlite(inflated)) return inflated;
    }
    offset = dataStart + compressedSize;
    if (!compressedSize) break;
  }
  const error = new Error('manifest-zip');
  error.code = 'manifest-zip';
  throw error;
}

function validateSqlite(file) {
  const db = new DatabaseSync(file, { readOnly: true, allowExtension: false });
  try {
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    const names = new Set(rows.map((row) => String(row.name)));
    const missing = REQUIRED_TABLES.filter((table) => !names.has(table));
    return { ok: missing.length === 0, missing, tables: [...names] };
  } finally {
    db.close();
  }
}

async function saveResponse(response, file) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  if (response?.body && typeof response.body.getReader === 'function') {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
    return;
  }
  if (response?.body && typeof response.body.pipe === 'function') {
    await pipeline(response.body, fs.createWriteStream(file));
    return;
  }
  const bytes = typeof response?.arrayBuffer === 'function'
    ? Buffer.from(await response.arrayBuffer())
    : Buffer.from(response?.buffer || []);
  await fs.promises.writeFile(file, bytes);
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function createManifest({ dir, now = () => new Date() } = {}) {
  const root = dir;
  const currentFile = path.join(root, 'current.json');
  const tmpDir = path.join(root, 'tmp');
  let swapping = null;

  function cleanTmp() {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  function current() {
    const stored = readJson(currentFile, null);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
    if (!stored.path || !stored.version) return null;
    if (!fs.existsSync(stored.path)) return null;
    return stored;
  }

  function remember(next, previousPath) {
    writeJson(currentFile, next);
    const keep = new Set([path.resolve(next.path)]);
    if (previousPath && previousPath !== next.path && fs.existsSync(previousPath)) keep.add(path.resolve(previousPath));
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith('.sqlite3')) continue;
      const full = path.resolve(root, name);
      if (!keep.has(full)) fs.rmSync(full, { force: true });
    }
  }

  async function ensure(client) {
    if (swapping) return swapping;
    swapping = ensureOnce(client).finally(() => {
      swapping = null;
    });
    return swapping;
  }

  async function ensureOnce(client) {
    fs.mkdirSync(root, { recursive: true });
    cleanTmp();
    const remote = await client.get('/Destiny2/Manifest/');
    if (!remote.ok) return { ok: false, reason: remote.reason || remote.kind || 'unavailable', downloaded: false };
    const version = String(remote.json?.Response?.version || '').trim();
    const paths = remote.json?.Response?.mobileWorldContentPaths || {};
    const relative = paths.en || paths['en-us'] || '';
    if (!version || !relative) return { ok: false, reason: 'manifest-shape', downloaded: false };
    const existing = current();
    if (existing && existing.version === version) {
      const valid = validateSqlite(existing.path);
      if (valid.ok) return { ok: true, downloaded: false, version, path: existing.path, sha256: existing.sha256 || '' };
    }
    const download = await client.download(relative);
    if (!download.ok) return { ok: false, reason: download.reason || 'unavailable', downloaded: false, version };
    const rawFile = path.join(tmpDir, `${safeVersion(version)}.download`);
    await saveResponse(download.response, rawFile);
    const sqliteFile = path.join(tmpDir, `${safeVersion(version)}.sqlite3`);
    const extracted = unzipSqlite(fs.readFileSync(rawFile));
    await fs.promises.writeFile(sqliteFile, extracted);
    const valid = validateSqlite(sqliteFile);
    if (!valid.ok) {
      fs.rmSync(sqliteFile, { force: true });
      return { ok: false, reason: 'invalid', missing: valid.missing, downloaded: false, version };
    }
    const dest = path.join(root, `${safeVersion(version)}.sqlite3`);
    fs.renameSync(sqliteFile, dest);
    const previousPath = existing?.path && existing.path !== dest ? existing.path : '';
    const saved = {
      version,
      path: dest,
      downloadedAt: now().toISOString(),
      sha256: sha256File(dest)
    };
    remember(saved, previousPath);
    cleanTmp();
    return { ok: true, downloaded: true, version, path: dest, sha256: saved.sha256, kept: previousPath };
  }

  return { ensure, current, cleanTmp, validateSqlite };
}

module.exports = {
  REQUIRED_TABLES,
  safeVersion,
  isSqlite,
  unzipSqlite,
  validateSqlite,
  createManifest
};
