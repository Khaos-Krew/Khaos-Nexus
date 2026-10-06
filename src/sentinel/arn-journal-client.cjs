'use strict';

const crypto = require('node:crypto');

const TTL_MS = 15_000;
const READ_TOKEN_MIN = 32;
const JOURNAL_UNAVAILABLE_TEXT = 'ARN trial records are not available from this bot right now. Try again in a minute.';
const caches = new Map();
let bootLogged = false;

function journalReader(env = process.env) {
  return String(env.NEXUS_GAME_ROLE || '').trim() === 'ark_asa';
}

function bearerMatches(header, expected) {
  const match = String(header || '').match(/^Bearer\s+(\S+)$/);
  const got = Buffer.from(match ? match[1] : '');
  const want = Buffer.from(String(expected || ''));
  if (!got.length || got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

function tokensMatch(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function railwayInternalHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return host.length > '.railway.internal'.length && host.endsWith('.railway.internal');
}

function journalUrlAllowed(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && railwayInternalHost(url.hostname);
}

function journalReaderProblem(env = process.env) {
  if (!journalReader(env)) return '';
  const token = String(env.ARN_JOURNAL_READ_TOKEN || '').trim();
  const admin = String(env.NEXUS_SENTINAL_ADMIN_TOKEN || '').trim();
  const forge = String(env.FORGE_SENTINEL_CONTROL_TOKEN || '').trim();
  if (tokensMatch(token, admin)) return 'journal-token-matches-admin';
  if (tokensMatch(token, forge)) return 'journal-token-matches-forge';
  const base = String(env.ARN_JOURNAL_URL || '').trim().replace(/\/$/, '');
  if (!base || token.length < READ_TOKEN_MIN) return 'journal-not-configured';
  if (!journalUrlAllowed(base)) return 'journal-url-refused';
  return '';
}

function logArnJournalBoot(env = process.env, logger = console) {
  if (bootLogged || !journalReader(env)) return;
  const reason = journalReaderProblem(env);
  if (!reason) return;
  bootLogged = true;
  logger.warn?.(`[Nexus Ascended] ARN journal reader disabled: ${reason}`);
}

function evictStaleJournalCache(now) {
  for (const [key, hit] of caches) {
    if (!hit || now - hit.at >= TTL_MS) caches.delete(key);
  }
}

function resetArnJournalClientForTest() {
  caches.clear();
  bootLogged = false;
}

function journalCacheSize() {
  return caches.size;
}

async function readArnJournal({ env = process.env, discordUserId = '', now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  evictStaleJournalCache(now);
  const problem = journalReaderProblem(env);
  if (problem) return { ok: false, reason: problem };
  const base = String(env.ARN_JOURNAL_URL || '').trim().replace(/\/$/, '');
  const token = String(env.ARN_JOURNAL_READ_TOKEN || '').trim();
  if (!journalReader(env)) {
    if (!base || token.length < READ_TOKEN_MIN) return { ok: false, reason: 'journal-not-configured' };
    if (!journalUrlAllowed(base)) return { ok: false, reason: 'journal-url-refused' };
  }
  const userId = String(discordUserId || '');
  const key = `${base}\n${userId}`;
  const hit = caches.get(key);
  if (hit && now - hit.at < TTL_MS) return { ...hit.body, cached: true };
  let target;
  try {
    target = new URL(`${base}/v1/arn/journal`);
  } catch {
    return { ok: false, reason: 'journal-not-configured' };
  }
  if (userId) target.searchParams.set('discordUserId', userId);
  try {
    const response = await fetchImpl(target, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000)
    });
    if (response.status >= 300 && response.status < 400) return { ok: false, reason: 'journal-unavailable' };
    const body = await response.json();
    if (!response.ok || body?.ok !== true || body?.readOnly !== true) {
      return { ok: false, reason: body?.reason || 'journal-unavailable' };
    }
    const snapshot = {
      ok: true,
      balance: Number(body.balance || 0),
      summary: body.summary || {},
      cached: false
    };
    caches.set(key, { at: now, body: snapshot });
    evictStaleJournalCache(now);
    return snapshot;
  } catch {
    return { ok: false, reason: 'journal-unavailable' };
  }
}

module.exports = {
  TTL_MS,
  READ_TOKEN_MIN,
  JOURNAL_UNAVAILABLE_TEXT,
  journalReader,
  journalReaderProblem,
  journalUrlAllowed,
  logArnJournalBoot,
  bearerMatches,
  readArnJournal,
  journalCacheSize,
  resetArnJournalClientForTest
};
