'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GatewayIntentBits } = require('discord.js');
const {
  SECURITY_MODES,
  RISK_STATES,
  assessRisk,
  domainMatchesBlocklist,
  messageSignals,
  recentJoinCounts,
  securityModeForJoinCounts
} = require('../src/sentinel/shield-policy.cjs');
const { ShieldStore } = require('../src/sentinel/shield-store.cjs');
const { messageFingerprint, clampContainmentMs } = require('../src/sentinel/shield-extension.cjs');
const { withCommunityIntents } = require('../src/sentinel/community-intents-extension.cjs');

test('a brand-new account is never punished for age or join timing alone', () => {
  const risk = assessRisk({
    accountAgeMs: 30 * 60_000,
    membershipAgeMs: 2 * 60_000,
    securityMode: SECURITY_MODES.NORMAL
  });
  assert.equal(risk.state, RISK_STATES.NORMAL);
  assert.equal(risk.action, 'observe');
  assert.equal(risk.containmentRecommended, false);
});

test('join bursts raise server security mode without declaring individual accounts malicious', () => {
  const now = 2_000_000;
  const elevatedTimes = Array.from({ length: 8 }, (_, index) => now - index * 1000);
  const lockdownTimes = Array.from({ length: 20 }, (_, index) => now - index * 1000);
  const elevated = recentJoinCounts(elevatedTimes, now);
  const lockdown = recentJoinCounts(lockdownTimes, now);
  assert.equal(securityModeForJoinCounts(elevated), SECURITY_MODES.ELEVATED);
  assert.equal(securityModeForJoinCounts(lockdown), SECURITY_MODES.LOCKDOWN);
});

test('blocked-domain matching covers exact hosts and subdomains but not lookalikes', () => {
  const blocked = ['evil.example'];
  assert.equal(domainMatchesBlocklist('visit https://evil.example/login', blocked), true);
  assert.equal(domainMatchesBlocklist('visit https://sub.evil.example/login', blocked), true);
  assert.equal(domainMatchesBlocklist('visit https://evil.example.safe.test/login', blocked), false);
});

test('scam-looking text alone requests review rather than automatic punishment', () => {
  const signals = messageSignals({
    content: 'Claim your free Discord Nitro at https://gift.example now',
    mentionCount: 0,
    blockedDomains: []
  });
  const risk = assessRisk({
    ...signals,
    accountAgeMs: 100 * 24 * 60 * 60_000,
    membershipAgeMs: 30 * 24 * 60 * 60_000
  });
  assert.equal(signals.scamPattern, true);
  assert.notEqual(risk.action, 'contain');
});

test('explicitly blocked malicious domains qualify for containment', () => {
  const signals = messageSignals({
    content: 'https://malware.example/claim',
    blockedDomains: ['malware.example']
  });
  const risk = assessRisk({
    ...signals,
    accountAgeMs: 500 * 24 * 60 * 60_000,
    membershipAgeMs: 90 * 24 * 60 * 60_000
  });
  assert.equal(risk.action, 'contain');
  assert.equal(risk.state, RISK_STATES.QUARANTINED);
});

test('coordinated mass-mention and repeated-message spam qualifies for containment', () => {
  const risk = assessRisk({
    accountAgeMs: 365 * 24 * 60 * 60_000,
    membershipAgeMs: 180 * 24 * 60 * 60_000,
    mentionCount: 10,
    repeatedMessageCount: 4
  });
  assert.equal(risk.action, 'contain');
  assert.equal(risk.containmentRecommended, true);
});

test('repeated AutoMod hits on an established account require review, not automatic containment', () => {
  const risk = assessRisk({
    accountAgeMs: 365 * 24 * 60 * 60_000,
    membershipAgeMs: 180 * 24 * 60 * 60_000,
    automodActions: 5
  });
  assert.equal(risk.action, 'review');
  assert.equal(risk.state, RISK_STATES.SUSPICIOUS);
});

test('very rapid repeated AutoMod abuse by a just-joined fresh account can be contained', () => {
  const risk = assessRisk({
    accountAgeMs: 2 * 60 * 60_000,
    membershipAgeMs: 5 * 60_000,
    automodActions: 5
  });
  assert.equal(risk.action, 'contain');
});

test('Shield store allocates stable SEC case ids and escalates the existing open case', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-shield-'));
  try {
    const store = new ShieldStore(root);
    const first = store.upsertCase('900000000000000001', { state: 'watch', score: 30, reasons: ['test-watch'] }, { source: 'test' }, 1000);
    assert.equal(first.created, true);
    assert.equal(first.record.caseId, 'SEC-0001');
    const second = store.upsertCase('900000000000000001', { state: 'suspicious', score: 60, reasons: ['test-review'] }, { source: 'test-2' }, 2000);
    assert.equal(second.created, false);
    assert.equal(second.escalated, true);
    assert.equal(second.record.caseId, 'SEC-0001');
    assert.equal(second.record.riskState, 'suspicious');
    assert.equal(second.record.evidence.length, 2);
    const third = store.upsertCase('900000000000000002', { state: 'watch', score: 25 }, { source: 'test' }, 3000);
    assert.equal(third.record.caseId, 'SEC-0002');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('message fingerprints normalize URLs so repeated scam templates correlate without storing content', () => {
  const first = messageFingerprint('FREE prize https://one.example/abc now');
  const second = messageFingerprint('free   prize https://two.example/xyz now');
  assert.ok(first);
  assert.equal(first, second);
});

test('containment timeout is bounded between ten minutes and one day', () => {
  assert.equal(clampContainmentMs(1), 10 * 60_000);
  assert.equal(clampContainmentMs(60), 60 * 60_000);
  assert.equal(clampContainmentMs(5000), 24 * 60 * 60_000);
});

test('community client requests native AutoMod execution telemetry without forcing Message Content', () => {
  const options = withCommunityIntents({ intents: [GatewayIntentBits.Guilds] }, {});
  assert.equal(options.intents.has(GatewayIntentBits.GuildMessages), true);
  if (GatewayIntentBits.AutoModerationExecution !== undefined) {
    assert.equal(options.intents.has(GatewayIntentBits.AutoModerationExecution), true);
  }
  assert.equal(options.intents.has(GatewayIntentBits.MessageContent), false);
});
