'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CraftStore } = require('./store.cjs');

const SEED_FILES = Object.freeze([
  Object.freeze({ envName: 'SENTINAL_CRAFT_SEED_JSON', file: 'nexus-craft.json', kind: 'json' }),
  Object.freeze({ envName: 'SENTINAL_CRAFT_SEED_RCON_JSON', file: 'nexus-craft-rcon.json', kind: 'json' }),
  Object.freeze({ envName: 'SENTINAL_CRAFT_SEED_RCON_SECRET', file: 'nexus-craft-rcon-secret', kind: 'secret' })
]);

const MAX_JSON_CHARS = 2_000_000;
const MAX_SECRET_CHARS = 4096;

function overwriteEnabled(env = {}) {
  const value = String(env.SENTINAL_CRAFT_SEED_OVERWRITE || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}

function backupFolderName(now = new Date()) {
  return `craft-seed-backup-${now.toISOString().replace(/[:.]/g, '-')}`;
}

function decodeBase64(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  if (!compact || compact.length > MAX_JSON_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return { ok: false };
  }
  const padded = compact.length % 4 === 0 ? compact : `${compact}${'='.repeat(4 - (compact.length % 4))}`;
  const decoded = Buffer.from(padded, 'base64');
  if (!decoded.length) return { ok: false };
  const round = decoded.toString('base64').replace(/=+$/, '');
  if (round !== compact.replace(/=+$/, '')) return { ok: false };
  return { ok: true, text: decoded.toString('utf8') };
}

function payloadFor(job, raw) {
  if (job.kind === 'secret') {
    const secret = String(raw || '').trim();
    if (!secret || secret.length > MAX_SECRET_CHARS || /[\u0000]/.test(secret)) return { ok: false };
    return { ok: true, text: secret.endsWith('\n') ? secret : `${secret}\n` };
  }
  const decoded = decodeBase64(raw);
  if (!decoded.ok) return { ok: false };
  try {
    const parsed = JSON.parse(decoded.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
  } catch {
    return { ok: false };
  }
  return { ok: true, text: decoded.text.endsWith('\n') ? decoded.text : `${decoded.text}\n` };
}

function writeNewFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeOverwrittenFile(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function logLine(log, line) {
  if (typeof log === 'function') log(line);
  else if (log && typeof log.log === 'function') log.log(line);
  else console.log(line);
}

function backupExisting(root, files, log, now) {
  const existing = files.filter((name) => fs.existsSync(path.join(root, name)));
  if (!existing.length) return { folder: '', files: [] };
  const folder = backupFolderName(now);
  const dest = path.join(root, folder);
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const name of existing) {
    const target = path.join(dest, name);
    fs.copyFileSync(path.join(root, name), target);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Best-effort mode on filesystems that ignore chmod.
    }
  }
  logLine(log, `[Nexus Sentinal] craft seed backed up ${existing.join(', ')} to ${folder}`);
  return { folder, files: existing };
}

// One-time copy from env into the data directory. Existing files stay as they
// are unless SENTINAL_CRAFT_SEED_OVERWRITE is true (or 1/yes/on). In that
// case existing files are copied into a timestamped backup folder on the same
// volume before the seed is written. Logs name the file and never the JSON or
// the vault secret.
function seedCraftFiles({ dir = '', env = process.env, log = console, now = new Date() } = {}) {
  const requested = SEED_FILES.filter((job) => String(env?.[job.envName] || '').trim());
  const result = { seeded: [], skipped: [], failed: [], backedUp: [], backupFolder: '' };
  if (!requested.length) return result;
  const root = String(dir || '').trim();
  if (!root) {
    logLine(log, '[Nexus Sentinal] craft seed skipped: data directory is missing');
    result.failed.push(...requested.map((job) => job.file));
    return result;
  }
  const overwrite = overwriteEnabled(env);
  if (overwrite) {
    logLine(log, '[Nexus Sentinal] craft seed overwrite enabled');
  }
  const resolved = path.resolve(root);
  const prepared = [];
  for (const job of requested) {
    const file = path.join(resolved, job.file);
    const exists = fs.existsSync(file);
    if (exists && !overwrite) {
      result.skipped.push(job.file);
      logLine(log, `[Nexus Sentinal] craft seed left existing ${job.file} in place`);
      continue;
    }
    const payload = payloadFor(job, env[job.envName]);
    if (!payload.ok) {
      result.failed.push(job.file);
      logLine(log, `[Nexus Sentinal] craft seed failed for ${job.file}`);
      continue;
    }
    prepared.push({ job, file, payload, exists });
  }
  if (overwrite) {
    const backup = backupExisting(
      resolved,
      prepared.filter((item) => item.exists).map((item) => item.job.file),
      log,
      now
    );
    result.backedUp = backup.files;
    result.backupFolder = backup.folder;
  }
  for (const item of prepared) {
    try {
      if (item.exists && overwrite) {
        writeOverwrittenFile(item.file, item.payload.text);
        result.seeded.push(item.job.file);
        logLine(log, `[Nexus Sentinal] craft seed replaced ${item.job.file}`);
      } else {
        writeNewFile(item.file, item.payload.text);
        result.seeded.push(item.job.file);
        logLine(log, `[Nexus Sentinal] craft seed wrote ${item.job.file}`);
      }
    } catch (error) {
      if (error?.code === 'EEXIST' && !overwrite) {
        result.skipped.push(item.job.file);
        logLine(log, `[Nexus Sentinal] craft seed left existing ${item.job.file} in place`);
        continue;
      }
      result.failed.push(item.job.file);
      logLine(log, `[Nexus Sentinal] craft seed failed for ${item.job.file}`);
    }
  }
  if (result.seeded.length || result.skipped.length) {
    logLine(log, '[Nexus Sentinal] craft seed finished; remove SENTINAL_CRAFT_SEED_JSON, SENTINAL_CRAFT_SEED_RCON_JSON, SENTINAL_CRAFT_SEED_RCON_SECRET, and SENTINAL_CRAFT_SEED_OVERWRITE');
  }
  return result;
}


// Merge-only: add status-only servers to nexus-craft.json. Never writes the
// RCON files, never replaces statusPanel or an existing server id, and never
// logs payload values.
function parseStatusServerSeed(raw) {
  const decoded = decodeBase64(raw);
  if (!decoded.ok) return { ok: false };
  try {
    const parsed = JSON.parse(decoded.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false };
    return { ok: true, servers: parsed };
  } catch {
    return { ok: false };
  }
}

function seedStatusServers({ dir = '', env = process.env, log = console, store = null } = {}) {
  const raw = String(env?.SENTINAL_CRAFT_STATUS_SERVERS_JSON || '').trim();
  const result = { added: [], skipped: [], failed: [] };
  if (!raw) return result;
  const payload = parseStatusServerSeed(raw);
  if (!payload.ok) {
    logLine(log, '[Nexus Sentinal] craft status server seed failed: payload is invalid');
    result.failed.push('payload');
    return result;
  }
  const root = String(dir || store?.dir || '').trim();
  if (!root && !store) {
    logLine(log, '[Nexus Sentinal] craft status server seed skipped: data directory is missing');
    result.failed.push('payload');
    return result;
  }
  let craft = store;
  if (!craft) {
    try {
      craft = new CraftStore(root, env);
    } catch {
      logLine(log, '[Nexus Sentinal] craft status server seed skipped: data directory is missing');
      result.failed.push('payload');
      return result;
    }
  }
  for (const [id, record] of Object.entries(payload.servers)) {
    try {
      const outcome = craft.addStatusServer({ ...(record && typeof record === 'object' ? record : {}), id });
      if (outcome.added) {
        result.added.push(outcome.server.id);
        logLine(log, `[Nexus Sentinal] craft status server added ${outcome.server.id}`);
      } else {
        result.skipped.push(outcome.server.id);
        logLine(log, `[Nexus Sentinal] craft status server left existing ${outcome.server.id} in place`);
      }
    } catch {
      result.failed.push(String(id || '').trim() || 'entry');
      logLine(log, `[Nexus Sentinal] craft status server failed for ${String(id || 'entry')}`);
    }
  }
  if (result.added.length || result.skipped.length) {
    logLine(log, '[Nexus Sentinal] craft status server seed finished; remove SENTINAL_CRAFT_STATUS_SERVERS_JSON');
  }
  return result;
}

module.exports = { SEED_FILES, seedCraftFiles, seedStatusServers, overwriteEnabled, backupFolderName };
