'use strict';
const crypto = require('node:crypto');
const { ProtocolEngine, id, integer } = require('./engine.cjs');
const { ArkIdentityStore, validEosId } = require('../ark-identity-store.cjs');
const METRICS = Object.freeze(['active-seconds', 'alpha-kill', 'boss-kill', 'anomaly-kill', 'delivery']);
const MAX_BYTES = 16384;
const MAX_AGE_MS = 120000;
function sourcesFromEnv(env = process.env) {
  const sources = JSON.parse(env.NEXUS_PROTOCOL_SOURCES || '[]');
  if (!Array.isArray(sources) || sources.length > 32) throw new Error('Invalid Protocol source configuration');
  const seen = new Set();
  for (const source of sources) {
    if (!source || !/^[a-z][a-z0-9-]{0,31}$/.test(source.id) || seen.has(source.id) ||
      !/^NEXUS_PROTOCOL_SOURCE_[A-Z0-9_]+_TOKEN$/.test(source.tokenEnv || '') ||
      !Array.isArray(source.metrics) || !source.metrics.length || source.metrics.some((m) => !METRICS.includes(m))) throw new Error('Invalid Protocol source configuration');
    id(source.map); seen.add(source.id);
  }
  return sources;
}
function sourceStatus(env = process.env) {
  try {
    const sources = sourcesFromEnv(env);
    return { ok: true, configured: sources.length, ready: sources.filter((s) => validSecret(env[s.tokenEnv])).length };
  } catch { return { ok: false, configured: 0, ready: 0 }; }
}
function validSecret(value) { return typeof value === 'string' && /^[\x21-\x7e]{32,256}$/.test(value); }
function authenticated(header, secret) {
  if (!validSecret(secret) || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const expected = Buffer.from(secret), actual = Buffer.from(header.slice(7));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function response(status, code, extra = {}) { return { status, body: { ok: status < 400, code, ...extra } }; }
async function readPayload(req) {
  const read = async () => {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  let timer;
  try {
    return await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => { reject(new Error('BODY_TIMEOUT')); req.destroy(); }, 5000); timer.unref?.(); })]);
  } finally { clearTimeout(timer); }
}
function normalize(payload, source, identities) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.version !== 1) throw new Error('Invalid evidence schema');
  const allowed = new Set(['version', 'eventId', 'runId', 'eosId', 'map', 'metric', 'amount', 'at', 'intervalStart', 'active', 'alive', 'spectating', 'factId']);
  if (Object.keys(payload).some((k) => !allowed.has(k))) throw new Error('Unexpected evidence field');
  for (const key of ['eventId', 'runId', 'map', 'metric']) id(payload[key]);
  if (!validEosId(payload.eosId) || payload.eosId !== String(payload.eosId).trim()) throw new Error('Stable EOS identity required');
  if (payload.map !== source.map || !source.metrics.includes(payload.metric)) throw new Error('Source scope violation');
  const profile = identities.profileByArk(payload.eosId);
  if (!profile?.discordUserId || !profile.arkAccounts?.some((a) => a.eosId === payload.eosId)) throw new Error('Verified linked identity required');
  id(profile.discordUserId);
  integer(payload.at, 0, Number.MAX_SAFE_INTEGER);
  if (payload.metric === 'active-seconds') {
    integer(payload.amount, 1, 60); integer(payload.intervalStart, 0, payload.at - 1000);
    if (payload.at - payload.intervalStart !== payload.amount * 1000 || payload.active !== true || payload.alive !== true || payload.spectating !== false || payload.factId != null) throw new Error('Invalid active-play interval');
  } else {
    integer(payload.amount, 1, 1); id(payload.factId);
    if (payload.intervalStart != null) throw new Error('Objective evidence cannot contain an activity interval');
  }
  return { runId: payload.runId, playerId: profile.discordUserId, source: `telemetry.${source.id}`, eventId: payload.eventId,
    map: payload.map, metric: payload.metric, amount: payload.amount, at: payload.at, intervalStart: payload.intervalStart,
    evidence: `Authenticated ${source.id}; EOS ${payload.eosId}`, factId: payload.factId };
}
function createEvidenceHandler({ env = process.env, engine = new ProtocolEngine(), identities = new ArkIdentityStore(), now = Date.now } = {}) {
  const windows = new Map();
  return async ({ req, sourceId }) => {
    let sources;
    try { sources = sourcesFromEnv(env); } catch { req.resume?.(); return response(503, 'SOURCE_CONFIG_INVALID'); }
    if (!sources.length) { req.resume?.(); return response(503, 'PROTOCOL_TELEMETRY_DISABLED'); }
    const source = sources.find((s) => s.id === sourceId);
    if (!source || !authenticated(req.headers.authorization, env[source.tokenEnv])) { req.resume?.(); return response(401, 'UNAUTHORIZED_SOURCE'); }
    const window = windows.get(sourceId) || { start: now(), count: 0 };
    if (now() - window.start >= 60000) { window.start = now(); window.count = 0; }
    windows.set(sourceId, window);
    if (++window.count > 120) { req.resume?.(); return response(429, 'SOURCE_RATE_LIMIT'); }
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) { req.resume?.(); return response(415, 'JSON_REQUIRED'); }
    let payload;
    try { payload = await readPayload(req); } catch (error) { return response(error.message === 'PAYLOAD_TOO_LARGE' ? 413 : error.message === 'BODY_TIMEOUT' ? 408 : 400, 'INVALID_BODY'); }
    let event;
    try { event = normalize(payload, source, identities); } catch { return response(422, 'INVALID_EVIDENCE'); }
    try {
      // Exact retries may arrive after the freshness window; the engine still
      // compares their complete fingerprint before acknowledging a duplicate.
      const prior = engine.store.read().receipts.some((r) => r.key === `${event.source}:${event.eventId}`);
      if (event.at > now() || !prior && now() - event.at > MAX_AGE_MS) return response(422, 'STALE_OR_FUTURE_EVIDENCE');
      const result = engine.record(event, `adapter:${source.id}`);
      return response(200, result.duplicate ? 'DUPLICATE' : 'ACCEPTED');
    } catch (error) {
      if (/storage|integrity|JSON|capacity|EACCES|ENOENT/i.test(error.message)) return response(503, 'PROTOCOL_STORAGE_UNAVAILABLE');
      return response(409, 'EVIDENCE_CONFLICT');
    }
  };
}
module.exports = { createEvidenceHandler, normalize, sourcesFromEnv, sourceStatus, METRICS, MAX_BYTES, MAX_AGE_MS };
