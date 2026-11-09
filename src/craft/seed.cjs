'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SEED_FILES = Object.freeze([
  Object.freeze({ envName: 'SENTINAL_CRAFT_SEED_JSON', file: 'nexus-craft.json', kind: 'json' }),
  Object.freeze({ envName: 'SENTINAL_CRAFT_SEED_RCON_JSON', file: 'nexus-craft-rcon.json', kind: 'json' }),
  Object.freeze({ envName: 'SENTINAL_CRAFT_SEED_RCON_SECRET', file: 'nexus-craft-rcon-secret', kind: 'secret' })
]);

const MAX_JSON_CHARS = 2_000_000;
const MAX_SECRET_CHARS = 4096;

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

function logLine(log, line) {
  if (typeof log === 'function') log(line);
  else if (log && typeof log.log === 'function') log.log(line);
  else console.log(line);
}

// One-time copy from env into the data directory. Existing files stay as they
// are. Logs name the file and never the JSON or the vault secret.
function seedCraftFiles({ dir = '', env = process.env, log = console } = {}) {
  const requested = SEED_FILES.filter((job) => String(env?.[job.envName] || '').trim());
  const result = { seeded: [], skipped: [], failed: [] };
  if (!requested.length) return result;
  const root = String(dir || '').trim();
  if (!root) {
    logLine(log, '[Nexus Sentinal] craft seed skipped: data directory is missing');
    result.failed.push(...requested.map((job) => job.file));
    return result;
  }
  for (const job of requested) {
    const file = path.join(path.resolve(root), job.file);
    if (fs.existsSync(file)) {
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
    try {
      writeNewFile(file, payload.text);
      result.seeded.push(job.file);
      logLine(log, `[Nexus Sentinal] craft seed wrote ${job.file}`);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        result.skipped.push(job.file);
        logLine(log, `[Nexus Sentinal] craft seed left existing ${job.file} in place`);
        continue;
      }
      result.failed.push(job.file);
      logLine(log, `[Nexus Sentinal] craft seed failed for ${job.file}`);
    }
  }
  if (result.seeded.length || result.skipped.length) {
    logLine(log, '[Nexus Sentinal] craft seed finished; remove SENTINAL_CRAFT_SEED_JSON, SENTINAL_CRAFT_SEED_RCON_JSON, and SENTINAL_CRAFT_SEED_RCON_SECRET');
  }
  return result;
}

module.exports = { SEED_FILES, seedCraftFiles };
