'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { arnFlags } = require('../shared/arn-flags.cjs');
const { memberIdentityHold } = require('./nexus-economy-identity-hold.cjs');
const { parseArnReport } = require('./arn-report-parser.cjs');
const { resolveLifecyclePolicy } = require('./arn-lifecycle-policy.cjs');
const { ctDayStart, ctWeekStart, nextCtWeekStart } = require('./arn-cache-rotation.cjs');

const CURRENCY = 'ARN_TOKENS';
const TAME_ODDS_BPS = 2500;
const KILL_ODDS_BPS = 1000;
const DAY_CAP = 3;
const WEEK_CAP = 10;
const DEFAULT_JOURNAL = path.join(process.cwd(), 'data', 'arn-dry-run.json');

function normalizeExactName(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function exactNameMatches(accounts, playerName) {
  const wanted = normalizeExactName(playerName);
  if (!wanted) return [];
  return (accounts || []).filter((account) => normalizeExactName(account?.playerName) === wanted);
}

function oddsRoll(seed, messageId) {
  const digest = crypto.createHash('sha256').update(String(seed)).update('\0').update(String(messageId)).digest();
  return digest.readUInt32BE(0) % 10000;
}

function oddsThreshold(kind) {
  return kind === 'tame' ? TAME_ODDS_BPS : KILL_ODDS_BPS;
}

function oddsHit(kind, roll) {
  return Number.isInteger(roll) && roll >= 0 && roll < oddsThreshold(kind);
}

function balanceOf(state, economicIdentityId) {
  return state.ledger
    .filter((row) => row.economicIdentityId === economicIdentityId && row.currency === CURRENCY)
    .reduce((sum, row) => sum + Number(row.delta || 0), 0);
}

function countCredits(state, economicIdentityId, start, end, which) {
  if (state.seededCredits && state.seededCredits.economicIdentityId === economicIdentityId) {
    return which === 'day' ? Number(state.seededCredits.day || 0) : Number(state.seededCredits.week || 0);
  }
  let total = 0;
  for (const row of state.observations) {
    if (row.economicIdentityId !== economicIdentityId) continue;
    if (row.outcome !== 'would-credit' && row.outcome !== 'credited') continue;
    if (Number(row.at) >= start && Number(row.at) < end) total += Number(row.amount || 1);
  }
  return total;
}

function levelUpStyleSkip(account, env) {
  if (!account?.economicIdentityId || account.missingRow === true) return { outcome: 'held', reason: 'account-hold' };
  const status = String(account.status || '').trim().toLowerCase();
  if (status !== 'verified' && status !== 'restricted') return { outcome: 'held', reason: 'account-hold' };
  const hold = memberIdentityHold({
    status,
    holdReason: account.holdReason || account.hold_reason || '',
    economicIdentityId: account.economicIdentityId,
    missingRow: false,
    env
  });
  if (hold) return { outcome: 'held', reason: hold.reason || 'account-hold' };
  return null;
}

function observation(input, extra) {
  return {
    messageId: input.messageId,
    outcome: extra.outcome,
    kind: input.parsed?.kind || '',
    playerName: input.parsed?.playerName || '',
    dinoName: input.parsed?.dinoName || '',
    mapName: input.parsed?.mapName || '',
    economicIdentityId: extra.economicIdentityId || '',
    discordUserId: extra.discordUserId || '',
    roll: extra.roll == null ? null : extra.roll,
    amount: Number(extra.amount || 0),
    at: input.at,
    reason: extra.reason || ''
  };
}

function decideAward(state, input) {
  const messageId = String(input.messageId || '').trim();
  if (!messageId) return { outcome: 'malformed', wroteLedger: false };
  if (input.blockedOutcome) {
    return {
      outcome: input.blockedOutcome,
      wroteLedger: false,
      observation: observation(input, { outcome: input.blockedOutcome })
    };
  }
  const prior = state.observations.find((row) => row.messageId === messageId);
  if (prior) return { outcome: 'duplicate', wroteLedger: false, duplicate: true, observation: prior };

  const parsed = input.parsed;
  if (!parsed?.ok) {
    return { outcome: 'malformed', wroteLedger: false, observation: observation(input, { outcome: 'malformed', reason: parsed?.reason || 'malformed' }) };
  }
  if (input.stale === true) {
    return { outcome: 'stale', wroteLedger: false, observation: observation(input, { outcome: 'stale' }) };
  }

  const matches = exactNameMatches(input.accounts, parsed.playerName);
  if (matches.length === 0) {
    return { outcome: 'unlinked', wroteLedger: false, observation: observation(input, { outcome: 'unlinked' }) };
  }
  if (matches.length !== 1) {
    return { outcome: 'ambiguous', wroteLedger: false, observation: observation(input, { outcome: 'ambiguous' }) };
  }

  const account = matches[0];
  const skip = levelUpStyleSkip(account, input.env);
  if (skip) {
    return {
      outcome: 'held',
      wroteLedger: false,
      observation: observation(input, {
        outcome: 'held',
        reason: skip.reason,
        economicIdentityId: account.economicIdentityId,
        discordUserId: account.discordUserId
      })
    };
  }

  const roll = Number.isInteger(input.roll) ? input.roll : oddsRoll(input.seed || 'arn-tokens-v1', messageId);
  if (!Number.isInteger(roll) || roll < 0 || roll > 9999) throw new Error('ARN odds roll is invalid.');
  const identity = {
    economicIdentityId: account.economicIdentityId,
    discordUserId: account.discordUserId
  };
  if (!oddsHit(parsed.kind, roll)) {
    return { outcome: 'miss', wroteLedger: false, observation: observation(input, { outcome: 'miss', roll, ...identity }) };
  }

  const dayStart = Number.isFinite(input.dayStart) ? input.dayStart : ctDayStart(input.at);
  const weekStart = Number.isFinite(input.weekStart) ? input.weekStart : ctWeekStart(input.at);
  const dayEnd = Number.isFinite(input.dayEnd) ? input.dayEnd : ctDayStart(dayStart + (26 * 60 * 60 * 1000));
  const weekEnd = Number.isFinite(input.weekEnd) ? input.weekEnd : nextCtWeekStart(weekStart);
  const dayCredits = countCredits(state, account.economicIdentityId, dayStart, dayEnd, 'day');
  const weekCredits = countCredits(state, account.economicIdentityId, weekStart, weekEnd, 'week');
  if (dayCredits >= DAY_CAP) {
    return { outcome: 'cap-day', wroteLedger: false, observation: observation(input, { outcome: 'cap-day', roll, ...identity }) };
  }
  if (weekCredits >= WEEK_CAP) {
    return { outcome: 'cap-week', wroteLedger: false, observation: observation(input, { outcome: 'cap-week', roll, ...identity }) };
  }

  if (input.creditsEnabled !== true) {
    return {
      outcome: 'would-credit',
      wroteLedger: false,
      observation: observation(input, { outcome: 'would-credit', roll, amount: 1, ...identity })
    };
  }

  const row = observation(input, { outcome: 'credited', roll, amount: 1, ...identity });
  const balanceAfter = balanceOf(state, account.economicIdentityId) + 1;
  return {
    outcome: 'credited',
    wroteLedger: true,
    observation: row,
    ledgerRow: {
      messageId,
      economicIdentityId: account.economicIdentityId,
      discordUserId: account.discordUserId,
      delta: 1,
      balanceAfter,
      at: input.at,
      currency: CURRENCY
    }
  };
}

function applyDecision(state, decision) {
  if (decision?.duplicate || !decision?.observation) return decision;
  state.observations.push(decision.observation);
  if (decision.wroteLedger && decision.ledgerRow) state.ledger.push(decision.ledgerRow);
  return decision;
}

function summarize(state) {
  const outcomes = {};
  let wouldCredit = 0;
  for (const row of state.observations) {
    outcomes[row.outcome] = (outcomes[row.outcome] || 0) + 1;
    if (row.outcome === 'would-credit') wouldCredit += Number(row.amount || 0);
  }
  return {
    currency: CURRENCY,
    observations: state.observations.length,
    ledgerRows: state.ledger.length,
    wouldCredit,
    credited: state.ledger.filter((row) => row.delta > 0).reduce((sum, row) => sum + row.delta, 0),
    outcomes
  };
}

function staffSummaryText(summary) {
  const parts = Object.entries(summary.outcomes || {}).map(([name, count]) => `${name} ${count}`);
  return [
    'ARN trial summary',
    `Ledger rows: ${summary.ledgerRows}.`,
    `Would-credit tokens: ${summary.wouldCredit}.`,
    parts.join(', ') || 'No reports yet.'
  ].join('\n');
}

function writeSummaryFile(summary, filePath) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  return target;
}

function loadLinkedAccounts() {
  try {
    const { ArkIdentityStore } = require('./ark-identity-store.cjs');
    const stored = new ArkIdentityStore().read();
    const accounts = [];
    for (const [discordUserId, profile] of Object.entries(stored.profiles || {})) {
      for (const account of profile?.arkAccounts || []) {
        accounts.push({
          playerName: account.playerName || '',
          eosId: account.eosId,
          discordUserId: profile.discordUserId || discordUserId,
          economicIdentityId: profile.economicIdentityId || `discord:${profile.discordUserId || discordUserId}`,
          status: profile.economyStatus || account.status || 'verified',
          holdReason: profile.holdReason || account.holdReason || ''
        });
      }
    }
    return accounts;
  } catch {
    return [];
  }
}

function dryJournalEnv(env = process.env) {
  return {
    ...env,
    ARN_DRY_RUN: 'true',
    ARN_TOKENS_ENABLED: '',
    NEXUS_ECONOMY_WRITES_ENABLED: ''
  };
}

function createArnBook({ loadAccounts = async () => [], env = {}, persistPath = '', dryRunOnly = false } = {}) {
  const state = { observations: [], ledger: [] };
  let tail = Promise.resolve();
  let inLock = 0;
  let maxInLock = 0;

  function exclusive(fn) {
    const run = tail.then(async () => {
      inLock += 1;
      maxInLock = Math.max(maxInLock, inLock);
      try {
        return await fn();
      } finally {
        inLock -= 1;
      }
    }, async () => {
      inLock += 1;
      maxInLock = Math.max(maxInLock, inLock);
      try {
        return await fn();
      } finally {
        inLock -= 1;
      }
    });
    tail = run.then(() => {}, () => {});
    return run;
  }

  function persist() {
    if (!persistPath) return;
    const target = path.resolve(persistPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ observations: state.observations, ledger: state.ledger }), { mode: 0o600 });
  }

  return {
    state,
    stats() {
      return { maxInLock };
    },
    award(input = {}) {
      return exclusive(async () => {
        const at = Number(input.now || Date.now());
        const flags = arnFlags(input.env || env);
        const accounts = await loadAccounts(input);
        const decision = decideAward(state, {
          ...input,
          at,
          accounts,
          creditsEnabled: dryRunOnly ? false : flags.creditsEnabled,
          env: input.env || env
        });
        applyDecision(state, decision);
        persist();
        return { ...decision, wroteLedger: decision.wroteLedger === true, ledgerRows: state.ledger.length };
      });
    },
    spend({ discordUserId, key, now = Date.now(), env: spendEnv = env } = {}) {
      return exclusive(async () => {
        const flags = arnFlags(spendEnv);
        if (dryRunOnly || !flags.creditsEnabled) return { ok: false, reason: 'dry-run', debited: false };
        const accounts = await loadAccounts();
        const ids = [...new Set(accounts.filter((account) => account.discordUserId === discordUserId).map((account) => account.economicIdentityId).filter(Boolean))];
        if (ids.length !== 1) return { ok: false, reason: ids.length ? 'ambiguous' : 'unlinked', debited: false };
        const account = accounts.find((item) => item.economicIdentityId === ids[0]);
        if (levelUpStyleSkip(account, spendEnv)) return { ok: false, reason: 'held', debited: false };
        const spendKey = String(key || '').trim();
        if (!spendKey) return { ok: false, reason: 'malformed', debited: false };
        if (state.ledger.some((row) => row.messageId === spendKey)) return { ok: true, duplicate: true, debited: false, economicIdentityId: ids[0] };
        if (balanceOf(state, ids[0]) < 1) return { ok: false, reason: 'insufficient', debited: false };
        const at = Number(now);
        state.ledger.push({
          messageId: spendKey,
          economicIdentityId: ids[0],
          discordUserId,
          delta: -1,
          balanceAfter: balanceOf(state, ids[0]) - 1,
          at,
          currency: CURRENCY
        });
        persist();
        return { ok: true, debited: true, economicIdentityId: ids[0], key: spendKey };
      });
    },
    refund({ economicIdentityId, key, now = Date.now() } = {}) {
      return exclusive(async () => {
        const refundKey = `refund:${key}`;
        if (state.ledger.some((row) => row.messageId === refundKey)) return { ok: true, duplicate: true };
        state.ledger.push({
          messageId: refundKey,
          economicIdentityId,
          delta: 1,
          balanceAfter: balanceOf(state, economicIdentityId) + 1,
          at: Number(now),
          currency: CURRENCY
        });
        persist();
        return { ok: true };
      });
    },
    balanceForDiscord(discordUserId) {
      const ids = [...new Set(state.ledger.filter((row) => row.discordUserId === discordUserId).map((row) => row.economicIdentityId))];
      const fromLedger = ids.reduce((sum, id) => sum + balanceOf(state, id), 0);
      return fromLedger;
    },
    summary() {
      return summarize(state);
    }
  };
}

let sharedBook = null;

function sharedArnBook(env = process.env) {
  if (!sharedBook) {
    sharedBook = createArnBook({
      env: dryJournalEnv(env),
      dryRunOnly: true,
      persistPath: env.ARN_DRY_RUN_FILE || DEFAULT_JOURNAL,
      loadAccounts: async () => loadLinkedAccounts()
    });
  }
  return sharedBook;
}

function resetSharedArnBookForTest() {
  sharedBook = null;
}

function staleReport(createdAt, now, env = process.env) {
  const policy = resolveLifecyclePolicy(env);
  const at = Number(createdAt);
  if (!Number.isFinite(at)) return true;
  if (!policy.hardExpiryMs) return false;
  return now - at >= policy.hardExpiryMs;
}

async function observeFromDiscordMessage({
  message,
  payload,
  authoritativeMap = '',
  book,
  env = process.env,
  now = Date.now()
} = {}) {
  const parsed = parseArnReport(payload, authoritativeMap);
  if (!parsed.ok && parsed.reason === 'not-award') return { ok: true, skipped: 'not-award', wroteLedger: false };
  const at = Number(now);
  const report = {
    messageId: String(message?.id || ''),
    parsed,
    roll: message?.roll,
    seed: message?.seed,
    stale: staleReport(message?.createdTimestamp, at, env),
    now: at,
    env
  };
  if (book) return book.award(report);
  if (arnFlags(env).creditsEnabled) {
    try {
      const { awardLiveReport } = require('../economy-worker/arn-tokens-postgres.cjs');
      const live = await awardLiveReport({ ...report, loadAccounts: loadLinkedAccounts });
      if (live) return live;
    } catch (error) {
      console.warn(`[ARN] token credit unavailable: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 200)}`);
    }
    return sharedArnBook(env).award({ ...report, env: dryJournalEnv(env), blockedOutcome: 'ledger-unavailable' });
  }
  return sharedArnBook(env).award({ ...report, env: dryJournalEnv(env) });
}

module.exports = {
  CURRENCY,
  TAME_ODDS_BPS,
  KILL_ODDS_BPS,
  DAY_CAP,
  WEEK_CAP,
  DEFAULT_JOURNAL,
  normalizeExactName,
  exactNameMatches,
  oddsRoll,
  oddsThreshold,
  oddsHit,
  balanceOf,
  levelUpStyleSkip,
  decideAward,
  applyDecision,
  summarize,
  staffSummaryText,
  writeSummaryFile,
  loadLinkedAccounts,
  dryJournalEnv,
  createArnBook,
  sharedArnBook,
  resetSharedArnBookForTest,
  staleReport,
  observeFromDiscordMessage
};
