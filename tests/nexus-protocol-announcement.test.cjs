'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { updateProtocolAnnouncement } = require('../src/sentinel/nexus-protocol-announcement.cjs');

test('banner edit preserves copy, role mention and unrelated attachments without sending messages', async () => {
  let payload;
  const attachments = new Map([['old', { id: 'old', name: 'other.png' }]]);
  attachments.find = (fn) => [...attachments.values()].find(fn);
  const message = { author: { id: 'bot' }, content: '<@&123> Nexus', attachments,
    embeds: [{ toJSON: () => ({ title: 'NEXUS', description: 'Original copy', fields: [{ name: 'Signal', value: 'Detected' }] }) }],
    edit: async (value) => { payload = value; } };
  const client = { user: { id: 'bot' }, channels: { fetch: async () => ({ messages: { fetch: async (arg) => typeof arg === 'string' ? message : {
    content: message.content, attachments: { some: (fn) => fn({ name: 'nexus-protocol-banner.png' }) }, embeds: [{ image: { url: 'attachment' } }]
  } } }) } };
  await updateProtocolAnnouncement(client);
  assert.equal(payload.content, undefined);
  assert.equal(payload.embeds[0].description, 'Original copy');
  assert.deepEqual(payload.attachments, [{ id: 'old' }]);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('missing target fails without posting a duplicate', async () => {
  const client = { channels: { fetch: async () => ({ messages: { fetch: async () => { throw new Error('Unknown Message'); } }, send: () => assert.fail('must not send') }) } };
  await assert.rejects(updateProtocolAnnouncement(client), /Unknown Message/);
});
