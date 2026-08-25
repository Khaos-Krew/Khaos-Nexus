'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectionSize,
  sentinalOwnsOnboarding,
  onboardingNeedsDetachment,
  reconcileOnboardingAuthority
} = require('../src/sentinel/onboarding-authority-extension.cjs');

test('Sentinal owns onboarding by default and can be explicitly opted out', () => {
  assert.equal(sentinalOwnsOnboarding({}), true);
  assert.equal(sentinalOwnsOnboarding({ discord: {} }), true);
  assert.equal(sentinalOwnsOnboarding({ discord: { sentinalOwnsOnboarding: true } }), true);
  assert.equal(sentinalOwnsOnboarding({ discord: { sentinalOwnsOnboarding: false } }), false);
});

test('collectionSize handles collections and arrays without mutating them', () => {
  assert.equal(collectionSize(new Map([['1', {}], ['2', {}]])), 2);
  assert.equal(collectionSize([{}, {}, {}]), 3);
  assert.equal(collectionSize(null), 0);
});

test('saved native onboarding references require detachment even when onboarding is disabled', () => {
  assert.equal(onboardingNeedsDetachment({ enabled: false, defaultChannels: new Map(), prompts: new Map() }), false);
  assert.equal(onboardingNeedsDetachment({ enabled: true, defaultChannels: new Map(), prompts: new Map() }), true);
  assert.equal(onboardingNeedsDetachment({ enabled: false, defaultChannels: new Map([['1', {}]]), prompts: new Map() }), true);
  assert.equal(onboardingNeedsDetachment({ enabled: false, defaultChannels: new Map(), prompts: new Map([['2', {}]]) }), true);
});

test('fully detached disabled native onboarding is preserved without an edit', async () => {
  let edits = 0;
  const guild = {
    fetchOnboarding: async () => ({
      enabled: false,
      defaultChannels: new Map(),
      prompts: new Map()
    }),
    editOnboarding: async () => { edits += 1; }
  };
  const result = await reconcileOnboardingAuthority(guild, { discord: { sentinalOwnsOnboarding: true } }, { warn() {} });
  assert.equal(result.ok, true);
  assert.equal(result.authority, 'sentinal');
  assert.equal(result.nativeEnabled, false);
  assert.equal(result.changed, false);
  assert.equal(result.defaultChannels, 0);
  assert.equal(result.prompts, 0);
  assert.equal(result.clearedDefaultChannels, 0);
  assert.equal(result.clearedPrompts, 0);
  assert.equal(edits, 0);
});

test('disabled native onboarding with stale channel references is detached so gated HQ permissions can apply', async () => {
  const edits = [];
  const guild = {
    fetchOnboarding: async () => ({
      enabled: false,
      defaultChannels: new Map([['1', {}], ['2', {}]]),
      prompts: new Map([['3', {}]])
    }),
    editOnboarding: async (options) => { edits.push(options); }
  };
  const result = await reconcileOnboardingAuthority(guild, {}, { log() {} });
  assert.equal(result.ok, true);
  assert.equal(result.nativeEnabled, false);
  assert.equal(result.changed, true);
  assert.equal(result.defaultChannels, 0);
  assert.equal(result.prompts, 0);
  assert.equal(result.clearedDefaultChannels, 2);
  assert.equal(result.clearedPrompts, 1);
  assert.deepEqual(edits, [{
    enabled: false,
    defaultChannels: [],
    prompts: [],
    reason: 'Nexus Sentinal: detach native onboarding from Shadow Recruit+ gated community channels'
  }]);
});

test('enabled native onboarding is disabled and detached from its saved prompts/default channels', async () => {
  const edits = [];
  const onboarding = {
    enabled: true,
    defaultChannels: new Map([['1', {}], ['2', {}], ['3', {}]]),
    prompts: new Map([['4', {}], ['5', {}]])
  };
  const guild = {
    fetchOnboarding: async () => onboarding,
    editOnboarding: async (options) => { edits.push(options); }
  };
  const result = await reconcileOnboardingAuthority(guild, {}, { log() {} });
  assert.equal(result.ok, true);
  assert.equal(result.authority, 'sentinal');
  assert.equal(result.nativeEnabled, false);
  assert.equal(result.changed, true);
  assert.equal(result.defaultChannels, 0);
  assert.equal(result.prompts, 0);
  assert.equal(result.clearedDefaultChannels, 3);
  assert.equal(result.clearedPrompts, 2);
  assert.deepEqual(edits, [{
    enabled: false,
    defaultChannels: [],
    prompts: [],
    reason: 'Nexus Sentinal: detach native onboarding from Shadow Recruit+ gated community channels'
  }]);
});

test('Discord onboarding remains untouched when authority is explicitly delegated to Discord', async () => {
  let fetched = false;
  let edited = false;
  const guild = {
    fetchOnboarding: async () => { fetched = true; return { enabled: true }; },
    editOnboarding: async () => { edited = true; }
  };
  const result = await reconcileOnboardingAuthority(guild, { discord: { sentinalOwnsOnboarding: false } }, { warn() {} });
  assert.equal(result.ok, true);
  assert.equal(result.authority, 'discord');
  assert.equal(result.changed, false);
  assert.equal(result.clearedDefaultChannels, 0);
  assert.equal(result.clearedPrompts, 0);
  assert.equal(fetched, false);
  assert.equal(edited, false);
});
