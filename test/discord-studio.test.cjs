'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_STATUS_TEMPLATE,
  normalizeTemplate,
  normalizePanel,
  normalizeDiscordStudioConfig,
  interpolate,
  statusContext,
  renderTemplate
} = require('../shared/discord-studio.cjs');

test('template normalization enforces Discord limits and safe URLs', () => {
  const template = normalizeTemplate({
    id: 'test-template',
    name: 'x'.repeat(100),
    color: 'ff0000',
    imageUrl: 'javascript:alert(1)',
    thumbnailUrl: 'https://example.com/image.png',
    fields: Array.from({ length: 30 }, (_, index) => ({ name: `Field ${index}`, value: 'Value', inline: index % 2 === 0 })),
    buttons: Array.from({ length: 8 }, (_, index) => ({ label: `Button ${index}`, url: `https://example.com/${index}` }))
  });
  assert.equal(template.id, 'test-template');
  assert.equal(template.name.length, 80);
  assert.equal(template.color, '#ff0000');
  assert.equal(template.imageUrl, '');
  assert.equal(template.thumbnailUrl, 'https://example.com/image.png');
  assert.equal(template.fields.length, 25);
  assert.equal(template.buttons.length, 5);
});

test('studio config always preserves built-in templates and deduplicates panels', () => {
  const config = normalizeDiscordStudioConfig({
    templates: [{ id: DEFAULT_STATUS_TEMPLATE.id, name: 'Customized Status', kind: 'server-status', title: 'Custom' }],
    panels: [{ id: 'panel-one', serverId: 'server', channelId: '1234567890' }, { id: 'panel-one', serverId: 'other' }]
  });
  assert.ok(config.templates.some((template) => template.id === 'default-server-status'));
  assert.ok(config.templates.some((template) => template.id === 'default-announcement'));
  assert.equal(config.templates.find((template) => template.id === 'default-server-status').name, 'Customized Status');
  assert.equal(config.panels.length, 1);
});

test('panel normalization protects IDs and refresh limits', () => {
  const panel = normalizePanel({
    id: 'panel-test',
    name: 'Panel',
    serverId: 'server-one',
    guildId: 'bad',
    channelId: '123456789012345678',
    messageId: '123456789012345679',
    refreshSeconds: 4,
    includePlayers: false
  });
  assert.equal(panel.id, 'panel-test');
  assert.equal(panel.guildId, '');
  assert.equal(panel.channelId, '123456789012345678');
  assert.equal(panel.refreshSeconds, 60);
  assert.equal(panel.includePlayers, false);
});

test('status context contains public-safe values without host or credentials', () => {
  const context = statusContext({ id: 'server-one', name: 'Nexus Palworld', game: 'palworld', connectionType: 'rest', host: '10.0.0.5', password: 'secret' }, {
    info: { version: '1.0.0' },
    metrics: { currentplayernum: 2, maxplayernum: 32, serverfps: 60, serverframetime: 16.7, uptime: 3600 }
  }, { players: [{ name: 'Kirito', userId: 'private-id' }, { name: 'Asuna', playerId: 'private-platform' }] }, null, new Date('2026-07-23T08:00:00Z'));
  assert.equal(context.online, true);
  assert.equal(context.players.current, 2);
  assert.deepEqual(context.players.names, ['Kirito', 'Asuna']);
  assert.equal(JSON.stringify(context).includes('secret'), false);
  assert.equal(JSON.stringify(context).includes('private-id'), false);
  assert.equal(JSON.stringify(context).includes('10.0.0.5'), false);
});

test('template rendering interpolates status and disables mentions', () => {
  const context = statusContext({ name: 'Nexus Palworld', game: 'palworld', connectionType: 'rest' }, {
    info: { version: '1.0.0' }, metrics: { currentplayernum: 2, maxplayernum: 32, serverfps: 60, serverframetime: 16.7, uptime: 3600 }
  }, { players: [{ name: 'Kirito' }, { name: 'Asuna' }] }, null, new Date('2026-07-23T08:00:00Z'));
  const payload = renderTemplate(DEFAULT_STATUS_TEMPLATE, context);
  assert.equal(payload.embeds[0].title, 'Nexus Palworld');
  assert.equal(payload.embeds[0].color, 0x2ecc71);
  assert.ok(payload.embeds[0].fields.some((field) => field.value === '2 / 32'));
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('offline rendering uses the Nexus error color and readable reason', () => {
  const context = statusContext({ name: 'Offline Server', game: 'ark' }, null, null, new Error('Connection timed out'), new Date('2026-07-23T08:00:00Z'));
  const payload = renderTemplate(DEFAULT_STATUS_TEMPLATE, context);
  assert.equal(payload.embeds[0].color, 0xe3264f);
  assert.match(payload.embeds[0].description, /timed out/i);
});

test('placeholder interpolation resolves nested values and leaves missing values readable', () => {
  assert.equal(interpolate('{{server.name}} • {{players.current}} • {{missing.value}}', { server: { name: 'Nexus' }, players: { current: 3 } }), 'Nexus • 3 • —');
});
