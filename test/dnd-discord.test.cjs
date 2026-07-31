'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultDndState,
  normalizeBinding,
  assertBindingConstraints,
  validateSetupOperation,
  resolveCampaignContext,
  normalizeGrant,
  requireScope,
  stableHash,
  campaignPanelData,
  parseDiceExpression,
  rollDice,
  validateRollPrivacy,
  sortInitiative,
  advanceInitiative,
  startSession,
  endSession
} = require('../shared/dnd-discord.cjs');

const snowflake = (n) => String(100000000000000000n + BigInt(n));

test('default setup mode creates nothing and resource creation is bounded to one', () => {
  assert.deepEqual(validateSetupOperation({ mode: 'none' }), { mode: 'none', creates: 0, resourceType: null });
  assert.equal(validateSetupOperation({ mode: 'create-thread' }).creates, 1);
  assert.equal(validateSetupOperation({ mode: 'create-forum-post' }).creates, 1);
});

test('category creation is not a supported setup mode', () => {
  assert.throws(() => validateSetupOperation({ mode: 'create-category' }), /invalid/i);
});

test('duplicate campaign resource bindings are rejected', () => {
  const first = normalizeBinding({ campaignId: 'c1', appId: 'a1', guildId: snowflake(1), resourceType: 'channel', resourceId: snowflake(2), purpose: 'main' });
  const second = normalizeBinding({ campaignId: 'c1', appId: 'a1', guildId: snowflake(1), resourceType: 'channel', resourceId: snowflake(2), purpose: 'main' });
  assert.throws(() => assertBindingConstraints([first], second), (error) => error.code === 'DUPLICATE_BINDING');
});

test('only one active primary main binding is allowed per campaign bot and guild', () => {
  const first = normalizeBinding({ campaignId: 'c1', appId: 'a1', guildId: snowflake(1), resourceType: 'channel', resourceId: snowflake(2), purpose: 'main', primary: true });
  const second = normalizeBinding({ campaignId: 'c1', appId: 'a1', guildId: snowflake(1), resourceType: 'thread', resourceId: snowflake(3), purpose: 'main', primary: true });
  assert.throws(() => assertBindingConstraints([first], second), (error) => error.code === 'PRIMARY_BINDING_CONFLICT');
});

test('exact binding wins over parent and explicit context', () => {
  const bindings = [
    normalizeBinding({ campaignId: 'parent', appId: 'a1', guildId: snowflake(1), resourceType: 'channel', resourceId: snowflake(2) }),
    normalizeBinding({ campaignId: 'exact', appId: 'a1', guildId: snowflake(1), resourceType: 'thread', resourceId: snowflake(3), parentChannelId: snowflake(2) })
  ];
  const result = resolveCampaignContext({ bindings, contexts: [], appId: 'a1', guildId: snowflake(1), channelId: snowflake(3), parentChannelId: snowflake(2) });
  assert.equal(result.campaignId, 'exact');
  assert.equal(result.source, 'exact');
});

test('shared channel ambiguity is never guessed', () => {
  const bindings = ['c1', 'c2'].map((campaignId, index) => normalizeBinding({ campaignId, appId: 'a1', guildId: snowflake(1), resourceType: 'channel', resourceId: snowflake(2), purpose: index ? 'announcements' : 'main' }));
  assert.throws(() => resolveCampaignContext({ bindings, contexts: [], appId: 'a1', guildId: snowflake(1), channelId: snowflake(2) }), (error) => error.code === 'AMBIGUOUS_CAMPAIGN_CONTEXT');
});

test('explicit shared-channel campaign selection resolves exact-channel ambiguity', () => {
  const bindings = ['c1', 'c2'].map((campaignId) => normalizeBinding({ campaignId, appId: 'a1', guildId: snowflake(1), resourceType: 'channel', resourceId: snowflake(2), purpose: 'main' }));
  const contexts = [{ appId: 'a1', guildId: snowflake(1), channelId: snowflake(2), campaignId: 'c2', active: true }];
  const result = resolveCampaignContext({ bindings, contexts, appId: 'a1', guildId: snowflake(1), channelId: snowflake(2) });
  assert.equal(result.campaignId, 'c2');
  assert.equal(result.source, 'explicit-context');
});

test('explicit parent-channel campaign selection resolves a shared child resource', () => {
  const bindings = ['c1', 'c2'].map((campaignId) => normalizeBinding({ campaignId, appId: 'a1', guildId: snowflake(1), resourceType: 'channel', resourceId: snowflake(2), purpose: 'main' }));
  const contexts = [{ appId: 'a1', guildId: snowflake(1), channelId: snowflake(2), campaignId: 'c2', active: true }];
  const result = resolveCampaignContext({ bindings, contexts, appId: 'a1', guildId: snowflake(1), channelId: snowflake(3), parentChannelId: snowflake(2) });
  assert.equal(result.campaignId, 'c2');
  assert.equal(result.source, 'explicit-parent-context');
});

test('bot grant scopes are enforced', () => {
  const state = defaultDndState();
  state.grants.push(normalizeGrant({ campaignId: 'c1', appId: 'a1', guildId: snowflake(1), scopes: ['campaign:read'] }));
  assert.doesNotThrow(() => requireScope(state, 'c1', 'a1', snowflake(1), 'campaign:read'));
  assert.throws(() => requireScope(state, 'c1', 'a1', snowflake(1), 'rolls:create'), (error) => error.code === 'MISSING_DND_SCOPE');
});

test('campaign panel hash is stable and ignores unrelated timestamps', () => {
  const state = defaultDndState();
  state.campaigns.push({ id: 'c1', name: 'Test', status: 'active', ruleset: '5e_2024', currentLocation: '', activeQuestId: '' });
  const first = stableHash(campaignPanelData(state, 'c1'));
  state.audit.push({ time: new Date().toISOString(), action: 'unrelated' });
  const second = stableHash(campaignPanelData(state, 'c1'));
  assert.equal(first, second);
});

test('dice parser supports bounded common notation', () => {
  assert.deepEqual(parseDiceExpression('2d20kh1+5'), { original: '2d20kh1+5', normalized: '2d20kh1+5', count: 2, sides: 20, keepMode: 'kh', keepCount: 1, modifier: 5 });
  assert.throws(() => parseDiceExpression('101d6'), /between 1 and 100/);
  assert.throws(() => parseDiceExpression('process.exit()'), /dice notation/i);
});

test('roll output preserves individual dice and deterministic kept indexes', () => {
  const values = [4, 19];
  const result = rollDice('2d20kh1+5', () => values.shift());
  assert.deepEqual(result.rolls, [4, 19]);
  assert.deepEqual(result.keptIndexes, [1]);
  assert.equal(result.total, 24);
});

test('blind roll is not executed without a safe DM destination', () => {
  assert.throws(() => validateRollPrivacy({ privacy: 'blind', dmDestinationAvailable: false }), (error) => error.code === 'MISSING_DM_ROLL_DESTINATION');
  assert.equal(validateRollPrivacy({ privacy: 'dm_only', dmDestinationAvailable: false }).deliveryAvailable, false);
});

test('initiative order is deterministic and turn advancement does not rotate it', () => {
  const combatants = [
    { id: 'b', initiative: 14, dexterity: 2, active: true },
    { id: 'a', initiative: 14, dexterity: 3, active: true },
    { id: 'c', initiative: 8, dexterity: 5, active: true }
  ];
  assert.deepEqual(sortInitiative(combatants).map((item) => item.id), ['a', 'b', 'c']);
  const first = advanceInitiative({ currentTurnIndex: 1, round: 2 }, combatants);
  assert.deepEqual(first.order.map((item) => item.id), ['a', 'b', 'c']);
  assert.equal(first.currentTurnIndex, 2);
  assert.equal(first.round, 2);
  const wrap = advanceInitiative({ currentTurnIndex: 2, round: 2 }, combatants);
  assert.equal(wrap.currentTurnIndex, 0);
  assert.equal(wrap.round, 3);
});

test('session lifecycle prevents multiple active sessions and creates an unapproved activity-only recap', () => {
  const state = defaultDndState();
  state.sessions.push({ id: 's1', campaignId: 'c1', title: 'One', status: 'planned', startsAt: '' });
  state.sessions.push({ id: 's2', campaignId: 'c1', title: 'Two', status: 'active', startsAt: new Date().toISOString() });
  assert.throws(() => startSession(state, 's1'), (error) => error.code === 'ACTIVE_SESSION_CONFLICT');
  state.sessions[1].status = 'completed';
  startSession(state, 's1');
  state.rolls.push({ campaignId: 'c1', createdAt: new Date().toISOString() });
  const ended = endSession(state, 's1');
  assert.equal(ended.status, 'completed');
  assert.match(ended.recapDraft, /Khaos Nexus activity only/);
  assert.equal(ended.recapApprovedAt, '');
});
