'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ChannelType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const {
  MANAGED_PERMISSION_NAMES,
  ShieldIsolationStore,
  captureManagedBaseline,
  isolationDenyPatch,
  restorePatch
} = require('../src/sentinel/shield-isolation.cjs');
const {
  informationCategory,
  shieldTargetChannels
} = require('../src/sentinel/shield-isolation-extension.cjs');

function overwrite({ allow = [], deny = [] } = {}) {
  return {
    allow: new PermissionsBitField(allow),
    deny: new PermissionsBitField(deny)
  };
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-shield-isolation-'));
}

test('Shield isolation captures and restores only its managed permission bits', () => {
  const baseline = captureManagedBaseline(overwrite({
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.AttachFiles],
    deny: [PermissionFlagsBits.SendMessages]
  }));
  assert.equal(baseline.existed, true);
  assert.equal(baseline.permissions.ViewChannel, 'allow');
  assert.equal(baseline.permissions.SendMessages, 'deny');
  assert.equal(baseline.permissions.Speak, 'unset');

  const patch = restorePatch(baseline);
  assert.equal(patch.ViewChannel, true);
  assert.equal(patch.SendMessages, false);
  assert.equal(patch.Speak, null);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'AttachFiles'), false);
});

test('Shield isolation deny patch blocks every managed community interaction capability', () => {
  const patch = isolationDenyPatch();
  assert.deepEqual(Object.keys(patch).sort(), [...MANAGED_PERMISSION_NAMES].sort());
  for (const value of Object.values(patch)) assert.equal(value, false);
});

test('Shield isolation store preserves the original baseline across repeated reconciliation and restarts', () => {
  const root = tempRoot();
  try {
    const store = new ShieldIsolationStore(root);
    store.setBaselineIfAbsent('guild-1', 'user-1', 'channel-1', {
      existed: true,
      permissions: { ViewChannel: 'allow', SendMessages: 'unset' }
    });
    store.setBaselineIfAbsent('guild-1', 'user-1', 'channel-1', {
      existed: true,
      permissions: { ViewChannel: 'deny', SendMessages: 'deny' }
    });

    const reloaded = new ShieldIsolationStore(root);
    const saved = reloaded.getUser('guild-1', 'user-1');
    assert.equal(saved.channels['channel-1'].permissions.ViewChannel, 'allow');
    assert.equal(saved.channels['channel-1'].permissions.SendMessages, 'unset');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Shield isolation store clears restored channels and removes empty user state', () => {
  const root = tempRoot();
  try {
    const store = new ShieldIsolationStore(root);
    store.setBaselineIfAbsent('guild-1', 'user-1', 'channel-1', { existed: false, permissions: {} });
    store.setBaselineIfAbsent('guild-1', 'user-1', 'channel-2', { existed: false, permissions: {} });
    assert.equal(store.clearChannel('guild-1', 'user-1', 'channel-1'), true);
    assert.deepEqual(Object.keys(store.getUser('guild-1', 'user-1').channels), ['channel-2']);
    assert.equal(store.clearChannel('guild-1', 'user-1', 'channel-2'), true);
    assert.equal(store.getUser('guild-1', 'user-1'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Shield isolation targets Nexus HQ, Supporter Hub, game categories, and their children only', () => {
  const channels = new Map([
    ['info', { id: 'info', name: 'INFORMATION', type: ChannelType.GuildCategory }],
    ['welcome', { id: 'welcome', name: 'welcome', type: ChannelType.GuildText, parentId: 'info' }],
    ['hq', { id: 'hq', name: '🌐 NEXUS HQ', type: ChannelType.GuildCategory }],
    ['general', { id: 'general', name: 'general', type: ChannelType.GuildText, parentId: 'hq' }],
    ['support', { id: 'support', name: 'SUPPORTER HUB', type: ChannelType.GuildCategory }],
    ['support-chat', { id: 'support-chat', name: 'supporter-chat', type: ChannelType.GuildText, parentId: 'support' }],
    ['osrs', { id: 'osrs', name: 'OSRS ⚔️', type: ChannelType.GuildCategory }],
    ['osrs-chat', { id: 'osrs-chat', name: 'osrs-chat', type: ChannelType.GuildText, parentId: 'osrs' }],
    ['staff', { id: 'staff', name: 'STAFF', type: ChannelType.GuildCategory }],
    ['staff-chat', { id: 'staff-chat', name: 'staff-chat', type: ChannelType.GuildText, parentId: 'staff' }]
  ]);

  const ids = new Set(shieldTargetChannels(channels).map((channel) => channel.id));
  for (const id of ['hq', 'general', 'support', 'support-chat', 'osrs', 'osrs-chat']) assert.equal(ids.has(id), true, id);
  for (const id of ['info', 'welcome', 'staff', 'staff-chat']) assert.equal(ids.has(id), false, id);
});

test('Shield verification help can recover INFORMATION through known child channels', () => {
  const channels = new Map([
    ['custom-info', { id: 'custom-info', name: '📚 START HERE', type: ChannelType.GuildCategory }],
    ['rules', { id: 'rules', name: 'rules', type: ChannelType.GuildText, parentId: 'custom-info' }]
  ]);
  assert.equal(informationCategory(channels)?.id, 'custom-info');
});
