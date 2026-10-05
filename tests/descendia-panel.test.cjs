'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { OWNER_CATEGORY_IDS } = require('../src/game-bots/category-gate.cjs');
const { helpText } = require('../src/game-bots/ops-spine.cjs');
const { stageBuilders } = require('../src/game-bots/stage-commands.cjs');
const {
  PANELS,
  missionNameFromTypeKey,
  descendiaEmbed,
  descendiaWeekExpired,
  descendiaRolloverDelay,
  handleDescendiaCommand,
  refreshWarframePanels,
  scheduleWarframePanels
} = require('../src/game-bots/cephalon-warframe-panels.cjs');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/warframe/descendia.json'), 'utf8'));

function embedSize(embed) {
  const fields = embed.fields || [];
  return embed.title.length
    + embed.description.length
    + embed.footer.text.length
    + fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
}

test('typeKey maps to a clean mission name', () => {
  assert.equal(missionNameFromTypeKey('DT_EXTERMINATE'), 'Exterminate');
  assert.equal(missionNameFromTypeKey('DT_SHRINE_DEFENSE'), 'Shrine Defense');
  assert.equal(missionNameFromTypeKey('DT_MIMICS'), 'Mimics');
  assert.equal(missionNameFromTypeKey('DT_DEFENSE'), 'Defense');
  assert.equal(missionNameFromTypeKey('DT_SABOTAGE_DEFENSE'), 'Sabotage Defense');
  assert.equal(missionNameFromTypeKey('DT_PRESURE_GAUGE'), 'Presure Gauge');
  assert.equal(missionNameFromTypeKey('DT_NETRACELLS'), 'Netracells');
  assert.equal(missionNameFromTypeKey(' dt_capture '), 'Capture');
  assert.equal(missionNameFromTypeKey(''), '');
  assert.equal(missionNameFromTypeKey('DT_'), '');
  assert.equal(missionNameFromTypeKey(null), '');
});

test('descendia embed lists the fixture floors inside Discord limits', () => {
  const embed = descendiaEmbed({
    ...fixture,
    challenges: fixture.challenges.map((floor, index) => (
      index === 0 ? { ...floor, type: 'D T_ E X T E R M I N A T E' } : floor
    ))
  });
  const packed = JSON.stringify(embed);
  const lines = embed.fields.flatMap((field) => field.value.split('\n'));
  const expiry = Math.floor(Date.parse(fixture.expiry) / 1000);
  assert.equal(embed.title, 'Cephalon • Descendia');
  assert.match(embed.description, /Weekly Descent · 21 floors\./);
  assert.match(embed.description, new RegExp(`<t:${expiry}:R>`));
  assert.match(embed.description, new RegExp(`<t:${expiry}:F>`));
  assert.equal(lines.length, 21);
  assert.match(lines[0], /^1\. Exterminate — Fiery Trail Rollers · Fiery Trail$/);
  assert.match(lines[1], /^2\. Shrine Defense — Slip And Slide · Slip And Slide$/);
  assert.match(lines[2], /^3\. Mimics — Basic Mimics$/);
  assert.match(lines.find((line) => line.startsWith('10. ')), /Sabotage Hive — Heavy Weapons Only · Heavy Weapon Spawn, Heavy Weapons Only/);
  assert.match(lines.find((line) => line.startsWith('12. ')), /^12\. Collection — NC Security Spin/);
  assert.match(lines[20], /^21\. Protoframe — Devil$/);
  assert.doesNotMatch(packed, /D T_/);
  assert.doesNotMatch(packed, /N C_/);
  assert.match(embed.footer.text, /^Cephalon Nexus • warframe:descendia/);
  assert.match(embed.footer.text, /Many Worlds One Nexus/);
  assert.ok(embed.fields.length >= 1);
  assert.ok(embed.fields.length <= 25);
  assert.ok(embed.title.length <= 256);
  assert.ok(embed.description.length <= 4096);
  assert.ok(embed.footer.text.length <= 2048);
  for (const field of embed.fields) {
    assert.ok(field.name.length <= 256);
    assert.ok(field.value.length <= 1024);
  }
  assert.ok(embedSize(embed) <= 6000);
  assert.equal(PANELS.some((panel) => panel.id === 'news'), false);
});

test('missing or empty descendia data stays on the unavailable embed', () => {
  const samples = [null, undefined, {}, { challenges: [] }, { challenges: null }, { challenges: [{ type: 'D T_ E X T E R M I N A T E' }] }, 'descendia'];
  for (const sample of samples) {
    const embed = descendiaEmbed(sample);
    assert.equal(embed.title, 'Cephalon • Descendia');
    assert.equal(embed.description, 'Descendia data unavailable');
    assert.equal(embed.fields, undefined);
    assert.match(embed.footer.text, /Many Worlds One Nexus/);
  }
  assert.equal(descendiaWeekExpired(null), false);
  assert.equal(descendiaWeekExpired({}), false);
  assert.equal(descendiaWeekExpired(fixture, Date.parse(fixture.expiry) - 1), false);
  assert.equal(descendiaWeekExpired(fixture, Date.parse(fixture.expiry)), true);
  assert.equal(descendiaRolloverDelay(fixture.expiry, Date.parse(fixture.expiry) - 60_000), 65_000);
  assert.equal(descendiaRolloverDelay(fixture.expiry, Date.parse(fixture.expiry)), 5_000);
  assert.equal(descendiaRolloverDelay(fixture.expiry, Date.parse(fixture.expiry) + 5_000), 0);
  assert.equal(descendiaRolloverDelay(''), 0);
});

test('/descendia is a cephalon quick view and survives a dead feed', async () => {
  const names = stageBuilders('cephalon').map((builder) => builder.toJSON().name);
  assert.equal(names.includes('descendia'), true);
  assert.equal(stageBuilders('ascended').some((builder) => builder.toJSON().name === 'descendia'), false);
  const help = helpText('cephalon');
  assert.match(help, /\/descendia/);
  assert.ok(help.length <= 1900);

  const calls = [];
  const replies = [];
  // The captured week ended 2026-10-05T00:00:00Z. readDescendia busts the TTL
  // cache once a week is expired, so this cache-sharing case needs a live expiry.
  const liveWeek = { ...fixture, expiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() };
  const context = {
    env: {},
    provider: {
      worldstate: async (pathname) => {
        calls.push(pathname);
        return liveWeek;
      }
    }
  };
  const interaction = { reply: async (body) => { replies.push(body); } };
  await handleDescendiaCommand(interaction, context);
  await handleDescendiaCommand(interaction, context);
  assert.deepEqual(calls, ['descendia']);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  assert.match(replies[0].embeds[0].description, /<t:\d+:R>/);
  assert.equal(replies[1].embeds[0].description, replies[0].embeds[0].description);

  let generation = 0;
  const rolled = [];
  await handleDescendiaCommand({ reply: async (body) => { rolled.push(body); } }, {
    env: {},
    provider: {
      worldstate: async () => {
        generation += 1;
        if (generation === 1) {
          return { expiry: '2020-01-01T00:00:00.000Z', challenges: [{ index: 1, typeKey: 'DT_DEFENSE', challenge: 'Old Week' }] };
        }
        return { expiry: '2099-01-01T00:00:00.000Z', challenges: [{ index: 1, typeKey: 'DT_EXTERMINATE', challenge: 'New Week' }] };
      }
    }
  });
  assert.equal(generation, 2);
  assert.match(rolled[0].embeds[0].fields[0].value, /New Week/);
  assert.doesNotMatch(JSON.stringify(rolled[0]), /Old Week/);

  const empty = [];
  await handleDescendiaCommand({ reply: async (body) => { empty.push(body); } }, {
    env: {},
    provider: { worldstate: async () => ({ challenges: [] }) }
  });
  assert.equal(empty[0].embeds[0].description, 'Descendia data unavailable');

  const down = [];
  await handleDescendiaCommand({ reply: async (body) => { down.push(body); } }, {
    env: {},
    provider: { worldstate: async () => { throw new Error('down'); } }
  });
  assert.match(down[0].content, /Descendia data unavailable/);
  assert.equal(down[0].flags, MessageFlags.Ephemeral);
});

test('an expired descendia week is fetched again before the panel is edited', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'descendia-rollover-'));
  const channelId = '1540956147241062401';
  const sent = [];
  const list = [];
  let descendiaCalls = 0;
  const provider = {
    worldstate: async (pathname) => {
      if (pathname !== 'descendia') throw new Error(`skip ${pathname}`);
      descendiaCalls += 1;
      if (descendiaCalls === 1) {
        return {
          expiry: '2020-01-01T00:00:00.000Z',
          challenges: [{ index: 1, typeKey: 'DT_DEFENSE', challenge: 'Old Week' }]
        };
      }
      return {
        expiry: '2099-01-01T00:00:00.000Z',
        challenges: [{ index: 1, typeKey: 'DT_EXTERMINATE', challenge: 'New Week' }]
      };
    }
  };
  const channel = {
    id: channelId,
    parentId: OWNER_CATEGORY_IDS.cephalon,
    send: async (body) => {
      const created = {
        id: '1540956147241062499',
        author: { id: '111111111111111111', bot: true },
        embeds: body.embeds,
        edit: async (next) => { created.embeds = next.embeds; },
        delete: async () => {}
      };
      sent.push(body);
      list.push(created);
      return created;
    },
    messages: {
      fetch: async (arg) => {
        if (arg && typeof arg === 'object') return { values: () => list.values() };
        return list.find((item) => item.id === String(arg)) || null;
      }
    }
  };
  const client = {
    user: { id: '111111111111111111' },
    channels: { fetch: async (id) => (id === channelId ? channel : null) }
  };
  const env = { NEXUS_DATA_DIR: dir, CEPHALON_DESCENDIA_CHANNEL_ID: channelId };
  const boards = scheduleWarframePanels({ client, env, provider, dir });
  boards.stop();
  try {
    const first = await refreshWarframePanels({ client, env, provider, dir });
    assert.equal(first.refreshed, 1);
    assert.equal(first.descendiaExpiry, '2099-01-01T00:00:00.000Z');
    assert.equal(descendiaCalls, 2);
    assert.equal(sent.length, 1);
    assert.match(JSON.stringify(sent[0]), /New Week/);
    assert.doesNotMatch(JSON.stringify(sent[0]), /Old Week/);
    assert.match(sent[0].embeds[0].footer.text, /Many Worlds One Nexus/);
    assert.equal(sent[0].embeds[0].image.url, 'attachment://cephalon-banner.webp');
    assert.equal(sent[0].files[0].name, 'cephalon-banner.webp');
    assert.deepEqual(sent[0].attachments, []);
    const second = await refreshWarframePanels({ client, env, provider, dir });
    assert.equal(second.refreshed, 1);
    assert.equal(descendiaCalls, 2);
    assert.equal(sent.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
