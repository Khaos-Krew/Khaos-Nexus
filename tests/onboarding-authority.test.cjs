'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectionSize,
  sentinalOwnsOnboarding,
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

test('disabled native onboarding is preserved without an edit', async () => {
  let edits = 0;
  const guild = {
    fetchOnboarding: async () => ({
      enabled: false,
      defaultChannels: new Map([['1', {}], ['2', {}]]),
      prompts: new Map([['3', {}]])
    }),
    editOnboarding: async () => { edits += 1; }
  };
  const result = await reconcileOnboardingAuthority(guild, { discord: { sentinalOwnsOnboarding: true } }, { warn() {} });
  assert.equal(result.ok, true);
  assert.equal(result.authority, 'sentinal');
  assert.equal(result.nativeEnabled, false);
  assert.equal(result.changed, false);
  assert.equal(result.defaultChannels, 2);
  assert.equal(result.prompts, 1);
  assert.equal(edits, 0);
});

test('enabled native onboarding is disabled without rewriting its saved prompts or default channels', async () => {
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
  const result = await reconcileOnboardingAuthority(guild, {}, { warn() {} });
  assert.equal(result.ok, true);
  assert.equal(result.authority, 'sentinal');
  assert.equal(result.nativeEnabled, false);
  assert.equal(result.changed, true);
  assert.equal(result.defaultChannels, 3);
  assert.equal(result.prompts, 2);
  assert.deepEqual(edits, [{
    enabled: false,
    reason: 'Nexus Sentinal: preserve Shadow Recruit+ gated community access'
  }]);
  assert.equal(onboarding.defaultChannels.size, 3);
  assert.equal(onboarding.prompts.size, 2);
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
  assert.equal(fetched, false);
  assert.equal(edited, false);
});
