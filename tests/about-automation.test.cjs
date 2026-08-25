'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const {
  ABOUT_PANEL_MARKER,
  ABOUT_PANEL_TITLE,
  ABOUT_TOPIC,
  findCanonicalInvite,
  inviteUrl,
  renderAboutPanel,
  messageMatchesAboutPanel,
  panelPayloadMatches,
  reconcileAboutPanel,
  permissionMask,
  overwriteSatisfies,
  applyAboutPermissions
} = require('../src/sentinel/about-extension.cjs');

test('about metadata is stable and share-oriented', () => {
  assert.equal(ABOUT_PANEL_TITLE, '🌌 WELCOME TO KHAOS NEXUS');
  assert.match(ABOUT_TOPIC, /invite others to join the Nexus/i);
  assert.match(ABOUT_PANEL_MARKER, /Managed About/);
});

test('canonical invite prefers a permanent Sentinal invite then falls back to any permanent invite', () => {
  const invites = [
    { code: 'temporary', maxAge: 3600, maxUses: 0, temporary: false, inviter: { id: '99999' } },
    { code: 'community', maxAge: 0, maxUses: 0, temporary: false, inviter: { id: '77777' } },
    { code: 'sentinal', maxAge: 0, maxUses: 0, temporary: false, inviter: { id: '99999' } }
  ];
  assert.equal(findCanonicalInvite(invites, '99999').code, 'sentinal');
  assert.equal(findCanonicalInvite(invites.slice(0, 2), '99999').code, 'community');
  assert.equal(inviteUrl({ code: 'sentinal' }), 'https://discord.gg/sentinal');
});

test('About panel contains the permanent share link, link button, safe-space copy, and no mentions', () => {
  const payload = renderAboutPanel('https://discord.gg/khaos');
  const text = JSON.stringify(payload);
  assert.match(text, /Khaos Nexus/);
  assert.match(text, /https:\/\/discord\.gg\/khaos/);
  assert.match(text, /does not expire and has unlimited uses/);
  assert.match(text, /safe-space community/i);
  assert.match(text, /Twitch and YouTube/);
  assert.equal(payload.components[0].components[0].style, 5);
  assert.equal(payload.components[0].components[0].label, 'Share Khaos Nexus');
  assert.equal(payload.embeds[0].footer.text, ABOUT_PANEL_MARKER);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('managed About message matching is limited to Sentinal authored canonical panels', () => {
  const managed = {
    author: { id: '99999' },
    embeds: [{ footer: { text: ABOUT_PANEL_MARKER }, title: ABOUT_PANEL_TITLE }]
  };
  assert.equal(messageMatchesAboutPanel(managed, '99999'), true);
  assert.equal(messageMatchesAboutPanel({ ...managed, author: { id: '11111' } }, '99999'), false);
  assert.equal(messageMatchesAboutPanel({ author: { id: '99999' }, embeds: [{ title: 'Other' }] }, '99999'), false);
});

test('About reconciliation edits newest managed panel, pins it, and removes only managed duplicates', async () => {
  const deleted = [];
  let edited = 0;
  let pinned = 0;
  const newest = {
    id: '3',
    createdTimestamp: 300,
    pinned: false,
    author: { id: '99999' },
    embeds: [{ footer: { text: ABOUT_PANEL_MARKER } }],
    components: [],
    async edit() { edited += 1; return this; },
    async pin() { pinned += 1; this.pinned = true; },
    async delete() { deleted.push(this.id); }
  };
  const older = {
    id: '2',
    createdTimestamp: 200,
    pinned: false,
    author: { id: '99999' },
    embeds: [{ title: ABOUT_PANEL_TITLE }],
    async edit() { throw new Error('older panel should not be edited'); },
    async delete() { deleted.push(this.id); }
  };
  const unrelated = {
    id: '1',
    createdTimestamp: 100,
    author: { id: '99999' },
    embeds: [{ title: 'Unrelated post' }],
    async delete() { deleted.push(this.id); }
  };
  const channel = {
    client: { user: { id: '99999' } },
    messages: { async fetch() { return new Map([['1', unrelated], ['2', older], ['3', newest]]); } },
    async send() { throw new Error('should reuse managed message'); }
  };
  const result = await reconcileAboutPanel(channel, renderAboutPanel('https://discord.gg/khaos'), { botId: '99999' });
  assert.equal(result.created, false);
  assert.equal(result.updated, true);
  assert.equal(edited, 1);
  assert.equal(pinned, 1);
  assert.equal(result.duplicatesRemoved, 1);
  assert.deepEqual(deleted, ['2']);
});

test('About panel comparison skips edits when embed and button payload are already current', () => {
  const payload = renderAboutPanel('https://discord.gg/khaos');
  const message = {
    content: '',
    embeds: payload.embeds.map((embed) => ({ toJSON: () => embed })),
    components: payload.components.map((component) => ({ toJSON: () => component }))
  };
  assert.equal(panelPayloadMatches(message, payload), true);
});

test('About panel comparison ignores Discord response-only payload decoration', () => {
  const payload = renderAboutPanel('https://discord.gg/khaos');
  const message = {
    content: '',
    embeds: payload.embeds.map((embed) => ({ toJSON: () => ({ type: 'rich', ...embed }) })),
    components: payload.components.map((row) => ({ toJSON: () => ({ ...row, id: 'response-row', components: row.components.map((component) => ({ ...component, id: 'response-button', emoji: { id: null, animated: false, ...component.emoji } })) }) }))
  };
  assert.equal(panelPayloadMatches(message, payload), true);
});

test('About permission updates are targeted to everyone and Sentinal instead of replacing existing overwrites', async () => {
  const edits = [];
  const everyone = { id: '11111' };
  const botMember = { id: '99999' };
  const channel = {
    permissionOverwrites: {
      cache: new Map(),
      async edit(target, permissions, options) {
        edits.push({ target: String(target.id || target), permissions, options });
        return channel;
      }
    }
  };
  const guild = {
    roles: { everyone },
    members: { me: botMember }
  };
  const result = await applyAboutPermissions(channel, guild, '99999');
  assert.equal(result.membersReadOnly, true);
  assert.equal(result.sentinalWritable, true);
  assert.equal(result.permissionsUpdated, true);
  assert.equal(edits.length, 2);
  assert.equal(edits[0].target, '11111');
  assert.equal(edits[0].permissions.SendMessages, false);
  assert.equal(edits[0].permissions.CreatePublicThreads, false);
  assert.equal(edits[1].target, '99999');
  assert.equal(edits[1].permissions.SendMessages, true);
  assert.equal(edits[1].permissions.CreateInstantInvite, true);
  assert.match(edits[0].options.reason, /read-only/i);
});

test('About permissions recognize an already-correct partial overwrite plan', () => {
  const memberDeny = [
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.CreatePrivateThreads,
    PermissionFlagsBits.SendMessagesInThreads
  ];
  const channel = {
    permissionOverwrites: {
      cache: new Map([['11111', {
        id: '11111',
        allow: { bitfield: 0n },
        deny: { bitfield: permissionMask(memberDeny) }
      }]])
    }
  };
  assert.equal(overwriteSatisfies(channel, '11111', { deny: memberDeny }), true);
});
