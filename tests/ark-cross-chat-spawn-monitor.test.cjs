'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LOOP_MARKER, parseArkChat, SlidingWindowLimiter, ArkCrossChatRouter } = require('../src/sentinel/ark-cross-chat.cjs');
const { DEFAULT_SPECIES_POLICIES, parseSpeciesCount, evaluateSpeciesCount, gameIniRecommendation, correctionPlan, SpawnMonitorJournal } = require('../src/sentinel/ark-spawn-monitor.cjs');

test('cross-chat adds Nexus map branding and rejects its own relay marker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-xchat-'));
  const router = new ArkCrossChatRouter({ root });
  const parsed = parseArkChat(`Survivor: hello cluster\nBot: ${LOOP_MARKER} [Discord] User: loop`);
  assert.equal(parsed.length, 1);
  const relay = router.acceptArk(parsed[0], { mapId: 'Genesis 1', identity: { discordDisplayName: 'Verified User' } });
  assert.match(relay.content, /NEXUS • Genesis 1/);
  assert.match(relay.content, /Verified User/);
  assert.equal(router.acceptArk(parsed[0], { mapId: 'Genesis 1' }).reason, 'loop-or-replay');
  const restarted = new ArkCrossChatRouter({ root });
  assert.equal(restarted.acceptArk(parsed[0], { mapId: 'Genesis 1' }).reason, 'loop-or-replay');
});

test('cross-chat rate limiting and moderation hooks fail closed and are audited without message content', () => {
  let now = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-xchat-'));
  const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 10_000, now: () => now });
  const router = new ArkCrossChatRouter({ root, limiter, moderate: ({ message }) => ({ allowed: !message.includes('blocked'), reason: 'policy' }) });
  assert.equal(router.acceptDiscord({ authorId: '1', displayName: 'User', message: 'blocked text' }).reason, 'policy');
  assert.equal(router.acceptDiscord({ authorId: '2', displayName: 'User', message: 'hello' }).ok, true);
  assert.equal(router.acceptDiscord({ authorId: '2', displayName: 'User', message: 'again' }).reason, 'rate-limited');
  const journal = JSON.parse(fs.readFileSync(path.join(root, 'ark-cross-chat-audit.json'), 'utf8'));
  assert.equal(journal.entries.length, 3);
  assert.equal(JSON.stringify(journal).includes('blocked text'), false);
  now += 10_001;
  assert.equal(router.acceptDiscord({ authorId: '2', displayName: 'User', message: 'after window' }).ok, true);
});

test('Megalodon counts produce thresholds and recommendation but never an automatic global wipe', () => {
  const policy = DEFAULT_SPECIES_POLICIES.megalodon;
  assert.equal(parseSpeciesCount('Megalodon count: 125', policy), 125);
  const result = evaluateSpeciesCount({ mapId: 'gen1', policy, count: 125, baseline: 50 });
  assert.equal(result.state, 'critical');
  const plan = correctionPlan(result, policy);
  assert.equal(plan.autoExecute, false);
  assert.equal(plan.globalWildDinoWipe, false);
  assert.match(plan.proposedTargetedCommand, /Megalodon_Character_BP_C/);
  assert.doesNotMatch(plan.proposedTargetedCommand, /DestroyWildDinos/);
  assert.match(gameIniRecommendation(policy), /SpawnLimitPercentage=0.05/);
});

test('spawn journal learns a per-map median baseline from normal samples', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-spawns-'));
  const journal = new SpawnMonitorJournal(root);
  for (const count of [40, 44, 45, 48, 120]) journal.recordSample({ mapId: 'gen1', speciesId: 'megalodon', count, state: count < 80 ? 'normal' : 'critical' });
  assert.equal(journal.baseline('gen1', 'megalodon'), 45);
});
