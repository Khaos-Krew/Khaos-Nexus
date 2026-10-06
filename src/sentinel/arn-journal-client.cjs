'use strict';

const crypto = require('node:crypto');

const TTL_MS = 15_000;
const READ_TOKEN_MIN = 32;
const caches = new Map();

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

function resetArnJournalClientForTest() {
  caches.clear();
}

async function readArnJournal({ env = process.env, discordUserId = '', now = Date.now(), fetchImpl = globalThis.fetch } = {}) {
  const base = String(env.ARN_JOURNAL_URL || '').trim().replace(/\/$/, '');
  const token = String(env.ARN_JOURNAL_READ_TOKEN || '').trim();
  if (!base || token.length < READ_TOKEN_MIN) return { ok: false, reason: 'journal-not-configured' };
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
      signal: AbortSignal.timeout(5000)
    });
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
    return snapshot;
  } catch {
    return { ok: false, reason: 'journal-unavailable' };
  }
}

module.exports = {
  TTL_MS,
  READ_TOKEN_MIN,
  journalReader,
  bearerMatches,
  readArnJournal,
  resetArnJournalClientForTest
};
