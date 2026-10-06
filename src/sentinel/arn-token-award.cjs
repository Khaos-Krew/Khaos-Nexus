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
const FEED_DEDUPE_MS = 10 * 60 * 1000;
const JOURNAL_DIR = '/app/data/nexus-economy';
const DEFAULT_JOURNAL = path.join(JOURNAL_DIR, 'arn-dry-run.json');
const JOURNAL_MAX_BYTES = 10 * 1024 * 1024;
const JOURNAL_KEEP = 4;
const JOURNAL_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
const REPORT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// ARN_DRY_RUN_FILE, then NEXUS_DATA_DIR, then RAILWAY_VOLUME_MOUNT_PATH,
// then /app/data/nexus-economy. The file is arn-dry-run.json in that directory.
function journalPath(env = process.env) {
  const explicit = String(env.ARN_DRY_RUN_FILE || '').trim();
  if (explicit) return path.resolve(explicit);
  const data = String(env.NEXUS_DATA_DIR || '').trim();
  if (data) return path.join(path.resolve(data), 'arn-dry-run.json');
  const volume = String(env.RAILWAY_VOLUME_MOUNT_PATH || '').trim();
  if (volume) return path.join(path.resolve(volume), 'arn-dry-run.json');
  return path.join(path.resolve(JOURNAL_DIR), 'arn-dry-run.json');
}

function journalFiles(file) {
  const target = path.resolve(file);
  return [target, `${target}.1`, `${target}.2`, `${target}.3`];
}

function parseJournalFile(target) {
  if (!fs.existsSync(target)) return { missing: true, observations: [], ledger: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.observations) || !Array.isArray(parsed.ledger)) {
      throw new Error('shape');
    }
    return { missing: false, observations: parsed.observations, ledger: parsed.ledger };
  } catch (error) {
    console.warn(`[ARN] dry-run journal unreadable; leaving ${target} unchanged`);
    return { missing: false, bad: true, observations: [], ledger: [] };
  }
}

function readJournal(file) {
  if (!file) return { observations: [], ledger: [], ok: true };
  const parts = journalFiles(file).map(parseJournalFile);
  if (parts.some((part) => part.bad)) return { observations: [], ledger: [], ok: false };
  const observations = [];
  const ledger = [];
  const seenObservations = new Set();
  const seenLedger = new Set();
  for (const part of parts.slice().reverse()) {
    for (const row of part.observations) {
      const key = String(row?.messageId || '');
      if (key && seenObservations.has(key)) continue;
      if (key) seenObservations.add(key);
      observations.push(row);
    }
    for (const row of part.ledger) {
      const key = String(row?.messageId || '');
      if (key && seenLedger.has(key)) continue;
      if (key) seenLedger.add(key);
      ledger.push(row);
    }
  }
  observations.sort((left, right) => Number(left.at) - Number(right.at));
  ledger.sort((left, right) => Number(left.at) - Number(right.at));
  return { observations, ledger, ok: true };
}

function freshEnough(row, cutoff) {
  const at = Number(row?.at);
  if (!Number.isFinite(at)) return true;
  return at >= cutoff;
}

function encodeJournal(observations, ledger) {
  return JSON.stringify({ observations, ledger });
}

function splitJournal(observations, ledger, maxBytes) {
  const body = encodeJournal(observations, ledger);
  if (Buffer.byteLength(body) <= maxBytes || observations.length + ledger.length <= 1) {
    return [{ observations, ledger }];
  }
  const times = [...observations, ...ledger].map((row) => Number(row.at)).filter(Number.isFinite).sort((left, right) => left - right);
  let olderObs = [];
  let newerObs = [];
  let olderLed = [];
  let newerLed = [];
  if (times.length) {
    const mid = times[Math.floor((times.length - 1) / 2)];
    olderObs = observations.filter((row) => Number(row.at) <= mid);
    newerObs = observations.filter((row) => Number(row.at) > mid);
    olderLed = ledger.filter((row) => Number(row.at) <= mid);
    newerLed = ledger.filter((row) => Number(row.at) > mid);
    if (!newerObs.length && !newerLed.length) {
      const latest = times[times.length - 1];
      olderObs = observations.filter((row) => Number(row.at) < latest);
      newerObs = observations.filter((row) => Number(row.at) >= latest);
      olderLed = ledger.filter((row) => Number(row.at) < latest);
      newerLed = ledger.filter((row) => Number(row.at) >= latest);
    }
  }
  if ((!olderObs.length && !olderLed.length) || (!newerObs.length && !newerLed.length)) {
    const half = Math.max(1, Math.ceil(observations.length / 2));
    const ledgerHalf = Math.ceil(ledger.length / 2);
    return [
      ...splitJournal(observations.slice(0, half), ledger.slice(0, ledgerHalf), maxBytes),
      ...splitJournal(observations.slice(half), ledger.slice(ledgerHalf), maxBytes)
    ];
  }
  return [
    ...splitJournal(olderObs, olderLed, maxBytes),
    ...splitJournal(newerObs, newerLed, maxBytes)
  ];
}

function writeJournal(file, state, { maxBytes = JOURNAL_MAX_BYTES, now = Date.now() } = {}) {
  const cutoff = Number(now) - JOURNAL_RETAIN_MS;
  state.observations = state.observations.filter((row) => freshEnough(row, cutoff));
  state.ledger = state.ledger.filter((row) => freshEnough(row, cutoff));
  const chunks = splitJournal(state.observations, state.ledger, maxBytes).slice(-JOURNAL_KEEP);
  const files = journalFiles(file);
  fs.mkdirSync(path.dirname(files[0]), { recursive: true });
  const newestFirst = chunks.slice().reverse();
  for (let index = 0; index < files.length; index += 1) {
    const chunk = newestFirst[index];
    if (!chunk || (!chunk.observations.length && !chunk.ledger.length && index > 0)) {
      if (fs.existsSync(files[index])) fs.unlinkSync(files[index]);
      continue;
    }
    const tmp = `${files[index]}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, encodeJournal(chunk.observations, chunk.ledger), { mode: 0o600 });
    fs.renameSync(tmp, files[index]);
  }
}

function feedKeyOf(parsed) {
  return [
    String(parsed?.kind || ''),
    normalizeExactName(parsed?.playerName),
    normalizeExactName(parsed?.dinoName)
  ].join('|');
}

// Live credits are keyed on the game event, not the Discord post.
// A later repost of the same tribe, dino, kind, and in-game id is the same award.
function gameEventKey(parsed) {
  const kind = String(parsed?.kind || '').trim().toLowerCase();
  const tribe = normalizeExactName(parsed?.tribeName || parsed?.tribe || '');
  const dino = normalizeExactName(parsed?.dinoName || '');
  const eventId = String(parsed?.eventId || '').replace(/[\r\n\t]+/g, ' ').trim();
  if (kind !== 'tame' && kind !== 'kill') return '';
  if (!tribe || !dino || !eventId) return '';
  return `arn-drop:${kind}|${tribe}|${dino}|${eventId}`;
}

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

function oddsThreshold(kind, env = {}) {
  const flags = arnFlags(env || {});
  if (kind === 'kill') return flags.killOddsBp;
  return flags.tameOddsBp;
}

function oddsHit(kind, roll, env = {}) {
  return Number.isInteger(roll) && roll >= 0 && roll < oddsThreshold(kind, env);
}

function balanceOf(state, economicIdentityId) {
  return state.ledger
    .filter((row) => row.economicIdentityId === economicIdentityId && row.currency === CURRENCY)
    .reduce((sum, row) => sum + Number(row.delta || 0), 0);
}

function countCredits(state, economicIdentityId, start, end, which) {
  let total = 0;
  for (const row of state.observations) {
    if (row.economicIdentityId !== economicIdentityId) continue;
    if (row.outcome !== 'would-credit' && row.outcome !== 'credited') continue;
    if (Number(row.at) >= start && Number(row.at) < end) total += Number(row.amount || 1);
  }
  if (state.seededCredits && state.seededCredits.economicIdentityId === economicIdentityId) {
    total += which === 'day' ? Number(state.seededCredits.day || 0) : Number(state.seededCredits.week || 0);
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
    feedKey: extra.feedKey || feedKeyOf(input.parsed),
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

  const feedKey = feedKeyOf(parsed);
  const anchor = state.observations.find((row) => (
    row.feedKey === feedKey
    && row.messageId !== messageId
    && row.outcome !== 'feed-duplicate'
    && Number.isFinite(Number(row.at))
    && input.at >= Number(row.at)
    && input.at - Number(row.at) < FEED_DEDUPE_MS
  ));
  if (anchor) {
    return { outcome: 'feed-duplicate', wroteLedger: false, observation: observation(input, { outcome: 'feed-duplicate', reason: 'feed-window' }) };
  }

  const matches = exactNameMatches(input.accounts, parsed.playerName);
  if (matches.length === 0) {
    return { outcome: 'unlinked', wroteLedger: false, observation: observation(input, { outcome: 'unlinked' }) };
  }
  if (matches.length !== 1) {
    return { outcome: 'ambiguous', wroteLedger: false, observation: observation(input, { outcome: 'ambiguous' }) };
  }

  const account = matches[0];
  const economicIdentityId = String(account.economicIdentityId || '');
  if (!economicIdentityId || economicIdentityId.startsWith('discord:')) {
    return {
      outcome: 'identity-unresolved',
      wroteLedger: false,
      observation: observation(input, { outcome: 'identity-unresolved', discordUserId: account.discordUserId || '' })
    };
  }
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
  if (!oddsHit(parsed.kind, roll, input.env)) {
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

  const flags = arnFlags(input.env || {});
  if (input.creditsEnabled === true && flags.dropsEnabled(parsed.kind) !== true) {
    return {
      outcome: 'drops-disabled',
      wroteLedger: false,
      observation: observation(input, { outcome: 'drops-disabled', roll, ...identity })
    };
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

function inReportWindow(row, cutoff) {
  if (cutoff == null) return true;
  const at = Number(row?.at);
  return Number.isFinite(at) && at >= cutoff;
}

function summarize(state, now = null) {
  const cutoff = Number.isFinite(Number(now)) ? Number(now) - REPORT_WINDOW_MS : null;
  const observations = cutoff == null ? state.observations : state.observations.filter((row) => inReportWindow(row, cutoff));
  const ledger = cutoff == null ? state.ledger : state.ledger.filter((row) => inReportWindow(row, cutoff));
  const outcomes = {};
  let wouldCredit = 0;
  for (const row of observations) {
    outcomes[row.outcome] = (outcomes[row.outcome] || 0) + 1;
    if (row.outcome === 'would-credit') wouldCredit += Number(row.amount || 0);
  }
  return {
    currency: CURRENCY,
    observations: observations.length,
    ledgerRows: ledger.length,
    wouldCredit,
    credited: ledger.filter((row) => row.delta > 0).reduce((sum, row) => sum + row.delta, 0),
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
          economicIdentityId: profile.economicIdentityId || '',
          status: profile.economyStatus || account.status || '',
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
    ARN_ECONOMY_WRITES_ENABLED: '',
    NEXUS_ECONOMY_WRITES_ENABLED: ''
  };
}

function createArnBook({ loadAccounts = async () => [], env = {}, persistPath = '', dryRunOnly = false, journalMaxBytes = JOURNAL_MAX_BYTES } = {}) {
  const loaded = readJournal(persistPath);
  const state = { observations: loaded.observations, ledger: loaded.ledger };
  let canPersist = loaded.ok;
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
    if (!persistPath || !canPersist) return;
    writeJournal(persistPath, state, { maxBytes: journalMaxBytes });
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
        const accounts = Array.isArray(input.accounts) ? input.accounts : await loadAccounts(input);
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
    balanceForDiscord(discordUserId) {
      const ids = [...new Set(state.ledger.filter((row) => row.discordUserId === discordUserId).map((row) => row.economicIdentityId))];
      const fromLedger = ids.reduce((sum, id) => sum + balanceOf(state, id), 0);
      return fromLedger;
    },
    summary(now = null) {
      return summarize(state, now);
    }
  };
}

let sharedBook = null;

function warnIfJournalUnwritable(file) {
  if (!file) return;
  const dir = path.dirname(path.resolve(file));
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (error) {
    console.warn(`[ARN] dry-run journal directory is not writable (${dir}). Dedupe and caps will not survive a restart.`);
  }
}

function sharedArnBook(env = process.env) {
  if (!sharedBook) {
    const persistPath = journalPath(env);
    warnIfJournalUnwritable(persistPath);
    sharedBook = createArnBook({
      env: dryJournalEnv(env),
      dryRunOnly: true,
      persistPath,
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

async function readMainArnBalance(discordUserId) {
  try {
    const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
    const client = new NexusEconomyClient();
    if (!client.configured()) return null;
    const result = await client.arnBalance(discordUserId);
    if (!result || result.ok === false) return null;
    return Number(result.balance || 0);
  } catch (error) {
    console.warn(`[ARN] balance unavailable: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 200)}`);
    return null;
  }
}

async function resolveLinkedIdentity(account) {
  if (!account?.eosId || !account?.discordUserId) return null;
  try {
    const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
    const client = new NexusEconomyClient();
    if (!client.configured()) return null;
    return await client.arnPreview({ eosId: account.eosId, discordUserId: account.discordUserId });
  } catch (error) {
    console.warn(`[ARN] identity preview unavailable: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 200)}`);
    return null;
  }
}

async function observeFromDiscordMessage({
  message,
  payload,
  authoritativeMap = '',
  book,
  env = process.env,
  now = Date.now(),
  roll,
  seed
} = {}) {
  const parsed = parseArnReport(payload, authoritativeMap);
  if (!parsed.ok && parsed.reason === 'not-award') return { ok: true, skipped: 'not-award', wroteLedger: false };
  const at = Number(now);
  const report = {
    messageId: String(message?.id || ''),
    parsed,
    roll,
    seed,
    stale: staleReport(message?.createdTimestamp, at, env),
    now: at,
    env
  };
  if (book) return book.award(report);
  const accounts = await loadLinkedAccounts();
  const matches = exactNameMatches(accounts, parsed.playerName);
  if (matches.length === 1) {
    const resolved = await resolveLinkedIdentity(matches[0]);
    if (resolved?.economicIdentityId) {
      matches[0] = {
        ...matches[0],
        economicIdentityId: resolved.economicIdentityId,
        status: resolved.status || '',
        holdReason: resolved.holdReason || '',
        missingRow: resolved.missingRow === true
      };
    }
  }
  const flags = arnFlags(env);
  if (flags.creditsEnabled && matches.length === 1 && matches[0].eosId) {
    try {
      const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
      const client = new NexusEconomyClient();
      if (client.configured()) {
        const live = await client.arnDrop({
          messageId: report.messageId,
          parsed,
          eosId: matches[0].eosId,
          discordUserId: matches[0].discordUserId,
          createdAt: Number(message?.createdTimestamp)
        });
        return sharedArnBook(env).award({
          ...report,
          accounts: matches,
          env: dryJournalEnv(env),
          blockedOutcome: live?.outcome || 'ledger-unavailable'
        });
      }
    } catch (error) {
      console.warn(`[ARN] token credit unavailable: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 200)}`);
      return sharedArnBook(env).award({ ...report, accounts: matches, env: dryJournalEnv(env), blockedOutcome: 'ledger-unavailable' });
    }
  }
  return sharedArnBook(env).award({ ...report, accounts: matches, env: dryJournalEnv(env) });
}

module.exports = {
  CURRENCY,
  TAME_ODDS_BPS,
  KILL_ODDS_BPS,
  DAY_CAP,
  WEEK_CAP,
  FEED_DEDUPE_MS,
  DEFAULT_JOURNAL,
  JOURNAL_MAX_BYTES,
  JOURNAL_KEEP,
  JOURNAL_RETAIN_MS,
  REPORT_WINDOW_MS,
  journalPath,
  readJournal,
  writeJournal,
  feedKeyOf,
  gameEventKey,
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
  observeFromDiscordMessage,
  warnIfJournalUnwritable,
  readMainArnBalance
};
