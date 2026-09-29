'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PANEL_IDENTITIES,
  isForeignPanel,
  panelMatcher,
  upsertEmbed
} = require('../src/game-bots/panel-message.cjs');
const { BANNERS, PANEL_BOTS, attachBanner, bannerFor, bannerBotForPanel } = require('../src/game-bots/brand-banners.cjs');
const { refreshDurablePins } = require('../src/game-bots/stage-commands.cjs');
const { OWNER_CATEGORY_IDS } = require('../src/game-bots/category-gate.cjs');
const { PANELS, refreshWarframePanels, retireNewsPanel, singleFlight } = require('../src/game-bots/cephalon-warframe-panels.cjs');
const {
  FEEDS,
  WARFRAME_FEED,
  WARFRAME_FEED_MANUAL_FALLBACK,
  FeedState,
  EventFeedPublisher,
  feedMarker,
  feedsFor,
  warframeFeedDisabled
} = require('../src/sentinel/event-feed.cjs');
const { handleFissureCommand, handleNightwaveCommand, handleCycleCommand, handleCephalonButton, NightwaveDesk } = require('../src/game-bots/cephalon-relay.cjs');
const { handleClusterCommand } = require('../src/game-bots/asa-cluster-presence.cjs');
const { reconcileArkClusterPanel, arkClusterBoardPayload, PANEL_TITLE, PANEL_MARKER } = require('../src/sentinel/ark-cluster-panel.cjs');
const { sendToButtonChannel } = require('../src/sentinel/sanctuary-bot.cjs');
const { roleMenuPayload, SanctuaryStore, allRoleNames } = require('../src/sentinel/sanctuary-suite.cjs');

const CHANNEL_ID = '1516640233389822111';
const BOT_ID = '111111111111111111';
const SENTINAL_ID = '222222222222222222';

function message(partial) {
  return {
    id: partial.id,
    author: partial.author,
    embeds: partial.embeds || [],
    createdTimestamp: partial.createdTimestamp || 0,
    edit: partial.edit,
    delete: partial.delete
  };
}

function channelFrom(messages, sent) {
  const list = [...messages];
  return {
    id: CHANNEL_ID,
    send: async (body) => {
      const created = message({
        id: `9000000000000000${sent.length + 1}`.slice(0, 18),
        author: { id: BOT_ID, bot: true },
        embeds: body.embeds,
        createdTimestamp: 100,
        edit: async () => {},
        delete: async () => {}
      });
      sent.push(body);
      list.push(created);
      return created;
    },
    messages: {
      fetch: async (arg) => {
        if (arg && typeof arg === 'object' && arg.limit) {
          return { values: () => list.values() };
        }
        return list.find((item) => item.id === arg) || null;
      }
    }
  };
}

function clientFor(channel) {
  return {
    user: { id: BOT_ID },
    channels: { fetch: async () => channel }
  };
}

test('persisted panel id is edited and not sent again', async () => {
  const edited = [];
  const sent = [];
  const existing = message({
    id: '333333333333333333',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Fissure Relay Board' }],
    edit: async (body) => { edited.push(body); }
  });
  const channel = channelFrom([existing], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, existing.id, {
    embeds: [{ title: 'Fissure Relay Board', description: 'updated' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(result.edited, true);
  assert.equal(result.created, false);
  assert.equal(result.messageId, existing.id);
  assert.equal(sent.length, 0);
  assert.equal(edited.length, 1);
  assert.equal(edited[0].embeds[0].description, 'updated');
});

test('missing panel id reuses this bot message and persists that id', async () => {
  const edited = [];
  const sent = [];
  const existing = message({
    id: '444444444444444444',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Official ASA Network', footer: { text: 'old' } }],
    createdTimestamp: 5,
    edit: async (body) => { edited.push(body); },
    delete: async () => { throw new Error('canonical deleted'); }
  });
  const channel = channelFrom([existing], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Official ASA Network', description: 'online' }]
  }, { panel: 'official', botId: BOT_ID });
  assert.equal(sent.length, 0);
  assert.equal(edited.length, 1);
  assert.equal(result.created, false);
  assert.equal(result.messageId, existing.id);
});

test('missing panel id creates once when the channel has no matching panel', async () => {
  const sent = [];
  const channel = channelFrom([], sent);
  const first = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Fissure Relay Board', description: 'first' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(first.created, true);
  assert.match(first.messageId, /^\d{17,20}$/);
  const second = await upsertEmbed(clientFor(channel), CHANNEL_ID, first.messageId, {
    embeds: [{ title: 'Fissure Relay Board', description: 'second' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(second.edited, true);
  assert.equal(second.messageId, first.messageId);
});

test('a Sentinal panel is migrated once because this bot cannot edit it', async () => {
  const deleted = [];
  const sent = [];
  const legacy = message({
    id: '555555555555555555',
    author: { id: SENTINAL_ID, bot: true },
    embeds: [{ title: 'WARFRAME • FISSURES', footer: { text: 'Nexus Sentinal • Live Feed • warframe:fissures:v3' } }],
    createdTimestamp: 1,
    edit: async () => { throw Object.assign(new Error('Cannot edit a message authored by another user'), { code: 50005 }); },
    delete: async () => { deleted.push(legacy.id); }
  });
  const channel = channelFrom([legacy], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Fissure Relay Board', description: 'adopted' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(result.created, true);
  assert.equal(result.migrated, true);
  assert.equal(result.foreignRemoved, 1);
  assert.deepEqual(deleted, [legacy.id]);
  assert.notEqual(result.messageId, legacy.id);

  const again = await upsertEmbed(clientFor(channel), CHANNEL_ID, result.messageId, {
    embeds: [{ title: 'Fissure Relay Board', description: 'refresh' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(again.edited, true);
  assert.equal(again.messageId, result.messageId);
});

test('member messages with the same title are left in place', async () => {
  const deleted = [];
  const sent = [];
  const member = message({
    id: '666666666666666666',
    author: { id: '777777777777777777', bot: false },
    embeds: [{ title: 'Official ASA Network' }],
    delete: async () => { deleted.push(member.id); }
  });
  const channel = channelFrom([member], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Official ASA Network' }]
  }, { panel: 'official', botId: BOT_ID });
  assert.equal(sent.length, 1);
  assert.equal(deleted.length, 0);
  assert.equal(result.foreignRemoved, 0);
  assert.equal(isForeignPanel(member, BOT_ID), false);
  assert.equal(panelMatcher(PANEL_IDENTITIES.official)(member), true);
});

test('duplicate panels from earlier redeploys collapse to one message', async () => {
  const deleted = [];
  const edited = [];
  const sent = [];
  const older = message({
    id: '121212121212121212',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Fissure Relay Board' }],
    createdTimestamp: 1,
    edit: async () => { throw new Error('older edited'); },
    delete: async () => { deleted.push(older.id); }
  });
  const newer = message({
    id: '131313131313131313',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Fissure Relay Board' }],
    createdTimestamp: 9,
    edit: async (body) => { edited.push(body); },
    delete: async () => { deleted.push(newer.id); }
  });
  const channel = channelFrom([older, newer], sent);
  const result = await upsertEmbed(clientFor(channel), CHANNEL_ID, '', {
    embeds: [{ title: 'Fissure Relay Board', description: 'one' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(sent.length, 0);
  assert.equal(result.messageId, newer.id);
  assert.equal(edited.length, 1);
  assert.deepEqual(deleted, [older.id]);
});

test('sanctuary role menu startup reuses the button-channel panel', async () => {
  const edited = [];
  let sent = 0;
  const buttonId = '1541540948239060992';
  const existing = {
    id: '888888888888888888',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Sanctuary Nexus roles', footer: { text: 'Sanctuary Nexus • self-roles' } }],
    createdTimestamp: 3,
    edit: async (payload) => { edited.push(payload); },
    delete: async () => {}
  };
  const roles = new Map(allRoleNames().map((name, index) => [String(index + 1), { id: String(1700000000000000000n + BigInt(index)), name }]));
  const guild = {
    roles: { cache: { values: () => roles.values(), find: (fn) => [...roles.values()].find(fn) } },
    members: { me: { permissions: { has: () => true }, roles: { highest: { position: 5 } } } }
  };
  const discord = {
    user: { id: BOT_ID },
    channels: {
      fetch: async () => ({
        send: async () => { sent += 1; return { id: '999999999999999999' }; },
        messages: {
          fetch: async (arg) => {
            if (arg && arg.limit) return { values: () => [existing].values() };
            return arg === existing.id ? existing : null;
          }
        }
      })
    }
  };
  const { syncRoleMenu } = require('../src/sentinel/sanctuary-bot.cjs');
  const store = new SanctuaryStore();
  const result = await syncRoleMenu({ env: { SANCTUARY_BUTTON_CHANNEL_ID: buttonId }, client: discord, store }, guild);
  assert.equal(result.posted, true);
  assert.equal(result.updated, true);
  assert.equal(sent, 0);
  assert.equal(edited.length, 1);
  assert.match(edited[0].embeds[0].title, /Sanctuary Nexus roles/);
  assert.equal(store.panelId('roles'), existing.id);
  assert.equal(roleMenuPayload([]).embeds[0].footer.text, 'Sanctuary Nexus • self-roles');
  assert.equal(edited[0].embeds[0].image.url, bannerFor('sanctuary').url);
  assert.equal(edited[0].files[0].name, bannerFor('sanctuary').name);
  assert.deepEqual(edited[0].attachments, []);
  assert.equal(JSON.stringify(edited[0].files).includes(bannerFor('cephalon').name), false);
  assert.equal(JSON.stringify(edited[0].files).includes(bannerFor('ascended').name), false);
});

test('sanctuary group posts still send a new button-channel message', async () => {
  let sent = 0;
  let body = null;
  const result = await sendToButtonChannel({
    channels: {
      fetch: async () => ({
        send: async (payload) => { sent += 1; body = payload; return { id: '141414141414141414' }; },
        messages: { fetch: async () => { throw new Error('group posts do not reuse the role menu'); } }
      })
    }
  }, { SANCTUARY_BUTTON_CHANNEL_ID: CHANNEL_ID }, { content: 'group' });
  assert.equal(result.posted, true);
  assert.equal(result.updated, false);
  assert.equal(sent, 1);
  assert.equal(body.content, 'group');
  assert.equal(body.files, undefined);
  assert.equal(body.embeds, undefined);
});

test('ARK cluster panel adopts a Sentinal message once and then edits', async () => {
  const deleted = [];
  const sent = [];
  const edited = [];
  const legacy = {
    id: '151515151515151515',
    author: { id: SENTINAL_ID, bot: true },
    embeds: [{ title: PANEL_TITLE, footer: { text: PANEL_MARKER } }],
    createdTimestamp: 1,
    delete: async () => { deleted.push(legacy.id); }
  };
  const payload = { embeds: [{ title: PANEL_TITLE, description: 'live', footer: { text: PANEL_MARKER } }], components: [] };
  const channel = {
    id: CHANNEL_ID,
    send: async (body) => {
      const created = {
        id: '161616161616161616',
        author: { id: BOT_ID, bot: true },
        embeds: body.embeds,
        components: body.components,
        pinned: false,
        pin: async () => { created.pinned = true; },
        edit: async (next) => { edited.push(next); created.embeds = next.embeds; },
        delete: async () => { deleted.push(created.id); }
      };
      sent.push(body);
      channel.recent.push(created);
      return created;
    },
    messages: { fetch: async () => ({ values: () => channel.recent.values() }) },
    recent: [legacy]
  };
  const saved = [];
  const registry = { setMeta: (meta) => saved.push(meta) };
  const first = await reconcileArkClusterPanel(channel, payload, { botId: BOT_ID, registry });
  assert.equal(sent.length, 1);
  assert.equal(first.created, true);
  assert.equal(first.migrated, true);
  assert.equal(first.foreignRemoved, 1);
  assert.deepEqual(deleted, [legacy.id]);
  assert.equal(saved.at(-1).panelMessageId, '161616161616161616');

  const second = await reconcileArkClusterPanel(channel, payload, { botId: BOT_ID, registry });
  assert.equal(sent.length, 1);
  assert.equal(second.created, false);
  assert.equal(second.message.id, '161616161616161616');

  const savedOnly = {
    id: '171717171717171717',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: PANEL_TITLE, footer: { text: PANEL_MARKER }, description: 'stored' }],
    components: payload.components,
    pinned: true,
    edit: async (next) => { savedOnly.embeds = next.embeds; }
  };
  const quiet = {
    id: CHANNEL_ID,
    send: async () => { throw new Error('stored panel id should be edited'); },
    messages: {
      fetch: async (arg) => {
        if (arg && arg.limit) return { values: () => [].values() };
        return arg === savedOnly.id ? savedOnly : null;
      }
    }
  };
  const stored = await reconcileArkClusterPanel(quiet, payload, {
    botId: BOT_ID,
    registry: { getMeta: () => ({ panelMessageId: savedOnly.id }), setMeta: () => {} }
  });
  assert.equal(stored.created, false);
  assert.equal(stored.updated, true);
  assert.equal(stored.message.id, savedOnly.id);
});

function assertBotBanner(body, bot) {
  const banner = bannerFor(bot);
  const packed = `${JSON.stringify(body.embeds)}\n${JSON.stringify(body.files)}`;
  assert.equal(body.embeds[0].image.url, banner.url);
  assert.equal(body.files.length, 1);
  assert.equal(body.files[0].name, banner.name);
  assert.equal(body.files[0].attachment, banner.path);
  assert.deepEqual(body.attachments, []);
  for (const [other, name] of Object.entries(BANNERS)) {
    if (other === bot) continue;
    assert.equal(packed.includes(name), false);
  }
}

test('each durable panel embed carries only that bot banner', async () => {
  assert.equal(bannerBotForPanel('fissures'), 'cephalon');
  assert.equal(bannerBotForPanel('cephalonWelcome'), 'cephalon');
  assert.equal(bannerBotForPanel('cephalonEvent'), 'cephalon');
  assert.equal(bannerBotForPanel('official'), 'ascended');
  assert.equal(bannerBotForPanel('ascendedWelcome'), 'ascended');
  assert.equal(bannerBotForPanel('arkCluster'), 'ascended');
  assert.equal(bannerBotForPanel('sanctuaryRoles'), 'sanctuary');
  assert.equal(Object.values(PANEL_BOTS).includes('sentinal'), false);

  const panels = [
    ['fissures', 'Fissure Relay Board', 'cephalon'],
    ['cephalonWelcome', 'Welcome to Cephalon Nexus', 'cephalon'],
    ['cephalonEvent', 'Warframe event calendar', 'cephalon'],
    ['official', 'Official ASA Network', 'ascended'],
    ['ascendedWelcome', 'Welcome to Nexus Ascended', 'ascended'],
    ['sanctuaryRoles', 'Sanctuary Nexus roles', 'sanctuary']
  ];
  for (const [panel, title, bot] of panels) {
    const edited = [];
    const sent = [];
    const existing = message({
      id: '181818181818181818',
      author: { id: BOT_ID, bot: true },
      embeds: [{ title }],
      edit: async (body) => { edited.push(body); }
    });
    const result = await upsertEmbed(clientFor(channelFrom([existing], sent)), CHANNEL_ID, existing.id, {
      embeds: [{ title, description: 'refresh' }]
    }, { panel, botId: BOT_ID });
    assert.equal(result.edited, true);
    assert.equal(result.created, false);
    assert.equal(sent.length, 0);
    assert.equal(edited.length, 1);
    assert.equal(edited[0].embeds[0].description, 'refresh');
    assertBotBanner(edited[0], bot);
  }
});

test('an existing panel edit adds the banner attachment instead of posting again', async () => {
  const edited = [];
  const sent = [];
  const existing = message({
    id: '191919191919191919',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Fissure Relay Board', description: 'before' }],
    edit: async (body) => { edited.push(body); }
  });
  const result = await upsertEmbed(clientFor(channelFrom([existing], sent)), CHANNEL_ID, existing.id, {
    embeds: [{ title: 'Fissure Relay Board', description: 'after' }]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(result.messageId, existing.id);
  assert.equal(sent.length, 0);
  assert.equal(edited.length, 1);
  assert.equal(edited[0].embeds[0].description, 'after');
  assertBotBanner(edited[0], 'cephalon');
});

test('a restart does not create a welcome or event pin that is not already posted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-banners-'));
  const sent = [];
  const absent = await refreshDurablePins(clientFor(channelFrom([], sent)), 'cephalon', {
    NEXUS_DATA_DIR: dir,
    CEPHALON_WELCOME_CHANNEL_ID: CHANNEL_ID,
    CEPHALON_EVENT_CHANNEL_ID: CHANNEL_ID
  });
  assert.equal(sent.length, 0);
  assert.equal(absent.refreshed, 0);
  const ascended = await refreshDurablePins(clientFor(channelFrom([], sent)), 'ascended', {
    NEXUS_DATA_DIR: dir,
    ASCENDED_WELCOME_CHANNEL_ID: CHANNEL_ID
  });
  assert.equal(sent.length, 0);
  assert.equal(ascended.refreshed, 0);
});

test('restart edits saved welcome and event pins with that bot banner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-banners-'));
  fs.writeFileSync(path.join(dir, 'cephalon-event-calendar.json'), `${JSON.stringify({
    title: 'Baro',
    when: 'Friday',
    note: '',
    updatedBy: '',
    updatedAt: '',
    messageId: '212121212121212121'
  })}\n`);
  const edited = [];
  const sent = [];
  const welcome = message({
    id: '202020202020202020',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Welcome to Cephalon Nexus' }],
    edit: async (body) => { edited.push(body); }
  });
  const event = message({
    id: '212121212121212121',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Baro', footer: { text: 'Cephalon Nexus • staff-refreshable event pin' } }],
    edit: async (body) => { edited.push(body); }
  });
  const result = await refreshDurablePins(clientFor(channelFrom([welcome, event], sent)), 'cephalon', {
    NEXUS_DATA_DIR: dir,
    CEPHALON_WELCOME_CHANNEL_ID: CHANNEL_ID,
    CEPHALON_WELCOME_MESSAGE_ID: welcome.id,
    CEPHALON_EVENT_CHANNEL_ID: CHANNEL_ID
  });
  assert.equal(sent.length, 0);
  assert.equal(result.refreshed, 2);
  assert.equal(edited.length, 2);
  assert.equal(edited[0].embeds[0].title, 'Welcome to Cephalon Nexus');
  assert.equal(edited[1].embeds[0].title, 'Baro');
  assertBotBanner(edited[0], 'cephalon');
  assertBotBanner(edited[1], 'cephalon');

  const ascendedEdited = [];
  const ascendedSent = [];
  const ascendedWelcome = message({
    id: '222222222222222223',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Welcome to Nexus Ascended' }],
    edit: async (body) => { ascendedEdited.push(body); }
  });
  const ascended = await refreshDurablePins(clientFor(channelFrom([ascendedWelcome], ascendedSent)), 'ascended', {
    NEXUS_DATA_DIR: dir,
    ASCENDED_WELCOME_CHANNEL_ID: CHANNEL_ID,
    ASCENDED_WELCOME_MESSAGE_ID: ascendedWelcome.id
  });
  assert.equal(ascendedSent.length, 0);
  assert.equal(ascended.refreshed, 1);
  assert.equal(ascendedEdited[0].embeds[0].title, 'Welcome to Nexus Ascended');
  assertBotBanner(ascendedEdited[0], 'ascended');
});

test('public ARK cluster board edit attaches the Ascended banner', async () => {
  const payload = arkClusterBoardPayload({
    servers: [],
    summary: { state: 'offline', enabled: 0, totalPlayers: 0 },
    checkedAt: '2026-09-24T00:00:00.000Z'
  });
  assert.equal(payload.embeds[0].title, PANEL_TITLE);
  assert.equal(payload.embeds[0].footer.text, PANEL_MARKER);
  assertBotBanner(payload, 'ascended');
  const edited = [];
  const sent = [];
  const existing = {
    id: '232323232323232323',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: PANEL_TITLE, footer: { text: PANEL_MARKER }, description: 'previous' }],
    components: [],
    createdTimestamp: 4,
    pinned: true,
    edit: async (next) => { edited.push(next); }
  };
  const channel = {
    id: CHANNEL_ID,
    send: async () => { sent.push(true); throw new Error('cluster board should be edited'); },
    messages: { fetch: async () => ({ values: () => [existing].values() }) }
  };
  const result = await reconcileArkClusterPanel(channel, payload, { botId: BOT_ID });
  assert.equal(result.created, false);
  assert.equal(result.updated, true);
  assert.equal(sent.length, 0);
  assert.equal(edited.length, 1);
  assertBotBanner(edited[0], 'ascended');
});

test('ephemeral nightwave, cycles, and cluster replies use that bot banner', async () => {
  const replies = [];
  const interaction = {
    user: { id: '42' },
    reply: async (body) => { replies.push(body); }
  };
  await handleNightwaveCommand(interaction, {
    env: {},
    nightwaveCache: { get: async () => ({ value: { season: 1, phase: 1, tag: '', eta: '', challenges: [] } }) },
    nightwaveDesk: { isDone() { return false; } }
  });
  await handleCycleCommand(interaction, {
    env: {},
    cycleCache: { get: async () => ({ value: [] }) },
    cycleRoles: {}
  });
  await handleClusterCommand(interaction, {
    env: {},
    sessionIds: ['session-1'],
    clusterCache: { load: async () => ({ servers: [], stale: false, fetchedAt: '2026-09-24T00:00:00.000Z' }) }
  });
  assert.equal(replies.length, 3);
  assert.equal(replies[0].embeds[0].title, 'Nightwave Challenge Desk');
  assert.equal(replies[1].embeds[0].title, 'Open-World Cycle Watch');
  assert.equal(replies[2].embeds[0].title, 'Nexus Cluster');
  assertBotBanner(replies[0], 'cephalon');
  assertBotBanner(replies[1], 'cephalon');
  assertBotBanner(replies[2], 'ascended');
});

test('nightwave button updates keep the Cephalon banner on the same reply', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-nightwave-'));
  const updated = [];
  await handleCephalonButton({
    customId: 'cephalon:nw:3:abc',
    user: { id: '42' },
    update: async (body) => { updated.push(body); }
  }, {
    env: {},
    dir,
    nightwaveCache: {
      get: async () => ({
        value: {
          season: 3,
          phase: 1,
          tag: '',
          eta: '',
          challenges: [{ key: 'abc', title: 'Hunt', description: '', reputation: 1, daily: true, elite: false, eta: '1h' }]
        }
      })
    },
    nightwaveDesk: new NightwaveDesk(dir)
  });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].flags, undefined);
  assertBotBanner(updated[0], 'cephalon');
});

test('fissure slash reply stays text-only while the board edit gets the banner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-fissures-'));
  const replies = [];
  const edited = [];
  const sent = [];
  const existing = message({
    id: '242424242424242424',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Fissure Relay Board' }],
    edit: async (body) => { edited.push(body); }
  });
  const client = clientFor(channelFrom([existing], sent));
  await handleFissureCommand({
    reply: async (body) => { replies.push(body); },
    client
  }, {
    env: { CEPHALON_FISSURE_CHANNEL_ID: CHANNEL_ID, NEXUS_DATA_DIR: dir },
    dir,
    client,
    fissureCache: { get: async () => ({ value: [] }) }
  });
  assert.equal(replies[0].embeds[0].image, undefined);
  assert.equal(replies[0].files, undefined);
  assert.equal(sent.length, 0);
  assertBotBanner(edited[0], 'cephalon');
});

test('discord.js edit payload uploads the banner and drops the previous attachment', async () => {
  const { MessagePayload } = require('discord.js');
  const options = attachBanner('ascended', {
    embeds: [{ title: 'Official ASA Network', description: 'online' }],
    allowedMentions: { parse: [] }
  });
  const target = { client: { options: { jsonTransformer: (value) => value } } };
  const payload = MessagePayload.create(target, options);
  payload.resolveBody();
  await payload.resolveFiles();
  assert.equal(payload.body.embeds[0].image.url, bannerFor('ascended').url);
  assert.deepEqual(payload.body.attachments.map((item) => String(item.id)), ['0']);
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].name, bannerFor('ascended').name);
  assert.ok(payload.files[0].data.length > 1000);
});

test('brand banner files exist inside the paths the game-bot images copy', () => {
  const root = path.join(__dirname, '..');
  for (const bot of ['cephalon', 'ascended', 'sanctuary']) {
    const banner = bannerFor(bot);
    const relative = path.relative(root, banner.path).split(path.sep).join('/');
    const bytes = fs.readFileSync(banner.path);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
    assert.ok(bytes.length > 8_000);
    assert.ok(bytes.length < 500_000);
    assert.equal(relative.startsWith('src/'), true);
    const docker = fs.readFileSync(path.join(root, `Dockerfile.${bot}`), 'utf8');
    assert.match(docker, /^COPY src \.\/src$/m);
    const copied = docker.split('\n').some((line) => {
      const match = /^COPY\s+(\S+)\s+/.exec(line.trim());
      if (!match) return false;
      const prefix = match[1].replace(/\/$/, '');
      return relative === prefix || relative.startsWith(`${prefix}/`);
    });
    assert.equal(copied, true);
  }
  const hub = bannerFor('sentinal');
  const hubRelative = path.relative(root, hub.path).split(path.sep).join('/');
  assert.equal(fs.existsSync(hub.path), true);
  assert.equal(hubRelative.startsWith('src/'), true);
  assert.match(fs.readFileSync(path.join(root, 'Dockerfile.sentinal'), 'utf8'), /^COPY src \.\/src$/m);
  assert.equal(PANEL_IDENTITIES.fissures.titles.includes('Fissure Relay Board'), true);
});

function warframeWorldstate(pathname) {
  const table = {
    news: [{ message: 'TennoCon', link: 'https://example.com/news', date: 'today' }],
    events: [{ description: 'Double affinity', node: 'Earth', eta: '1d', expired: false }],
    alerts: [{ mission: { node: 'Lua', type: 'Survival', reward: { credits: 5000 } }, eta: '30m' }],
    sortie: { boss: 'Ambulas', eta: '12h', variants: [{ node: 'Mars', missionType: 'Spy', modifier: 'Eximus' }] },
    arbitration: { node: 'Helene', type: 'Defense', enemy: 'Grineer', eta: '40m' },
    nightwave: { season: 9, phase: 2, eta: '5d', activeChallenges: [{ title: 'Survivor', reputation: 1000 }] },
    voidTrader: { character: "Baro Ki'Teer", location: 'Orcus Relay', active: true, eta: '2d', inventory: [{ item: 'Prisma Gorgon', ducats: 600, credits: 150000 }] },
    steelPath: { currentReward: { name: 'Umbra Forma Blueprint' }, remaining: '3d', rotation: [{ name: 'Forma', cost: 10 }] },
    duviriCycle: { state: 'joy', timeLeft: '40m', choices: [{ category: 'Normal', choices: ['Excalibur'] }] },
    deepArchimedea: { eta: '1d', missions: [{ missionType: 'Exterminate', faction: 'Grineer', deviation: { name: 'Tight Belt' }, risks: [{ name: 'Powerless' }] }] }
  };
  if (!Object.prototype.hasOwnProperty.call(table, pathname)) throw new Error(`unexpected ${pathname}`);
  return table[pathname];
}

function liveChannel({ id, name, parentId, sent, edited, deleted, seed = [] }) {
  const list = [...seed];
  return {
    id,
    name,
    parentId,
    send: async (body) => {
      const created = message({
        id: `81${String(list.length + 1).padStart(16, '0')}`,
        author: { id: BOT_ID, bot: true },
        embeds: body.embeds,
        createdTimestamp: list.length + 1,
        edit: async (next) => {
          edited.push({ id: created.id, body: next });
          created.embeds = next.embeds;
        },
        delete: async () => { deleted.push(created.id); }
      });
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
}

test('Sentinal stops the Warframe feed by default and deletes its old messages once', async () => {
  assert.equal(warframeFeedDisabled({}), true);
  assert.equal(warframeFeedDisabled({ SENTINAL_WARFRAME_FEED_DISABLED: 'true' }), true);
  assert.equal(warframeFeedDisabled({ SENTINAL_WARFRAME_FEED_DISABLED: 'false' }), false);
  assert.equal(warframeFeedDisabled({ SENTINAL_WARFRAME_FEED_DISABLED: '0' }), false);
  assert.equal(FEEDS.some((feed) => feed.moduleId === 'warframe'), false);
  assert.equal(feedsFor({}).some((feed) => feed.moduleId === 'warframe'), false);
  assert.equal(feedsFor({}).some((feed) => feed.moduleId === 'ark'), true);
  assert.equal(feedsFor({}).some((feed) => feed.moduleId === 'pokemongo'), true);
  const enabled = feedsFor({ SENTINAL_WARFRAME_FEED_DISABLED: 'off' });
  assert.equal(enabled.filter((feed) => feed.moduleId === 'warframe').length, 1);
  assert.equal(WARFRAME_FEED.actions.includes('void-trader'), true);
  assert.match(WARFRAME_FEED_MANUAL_FALLBACK, /warframe:<action>:v3/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinal-warframe-feed-'));
  const feedState = new FeedState(dir);
  const channelId = '1516640233389822222';
  const newsId = '300000000000000001';
  const baroId = '300000000000000002';
  const extraId = '300000000000000004';
  const pogoId = '300000000000000003';
  const otherBotId = '300000000000000005';
  const divisionId = '300000000000000006';
  const legacyWarframeId = '300000000000000007';
  feedState.set('warframe:warframe-world-state:news', { messageId: newsId, channelId, actionId: 'news' });
  feedState.set('warframe:warframe-world-state:void-trader', { messageId: baroId, channelId, actionId: 'void-trader' });
  feedState.set('pokemongo:pokemon-go-events:events', { messageId: pogoId, channelId, actionId: 'events' });

  const deleted = [];
  const make = (id, footer, author = 'sentinal') => ({
    id,
    author: { id: author, bot: true },
    content: '',
    embeds: [{ footer: { text: footer } }],
    delete: async () => { deleted.push(id); }
  });
  const all = new Map([
    [newsId, make(newsId, feedMarker('warframe', 'news'))],
    [baroId, make(baroId, feedMarker('warframe', 'void-trader'))],
    [extraId, make(extraId, feedMarker('warframe', 'sortie'))],
    [pogoId, make(pogoId, feedMarker('pokemongo', 'events'))],
    [otherBotId, make(otherBotId, feedMarker('warframe', 'alerts'), 'cephalon')],
    [divisionId, {
      id: divisionId,
      author: { id: 'sentinal', bot: true },
      content: '📡 **Nexus Sentinal Live Feed** • news\nUpdated',
      embeds: [{ title: '📰 THE DIVISION 2 • NEWS', footer: { text: 'old footer' } }],
      delete: async () => { deleted.push(divisionId); }
    }],
    [legacyWarframeId, {
      id: legacyWarframeId,
      author: { id: 'sentinal', bot: true },
      content: '📡 **Nexus Sentinal Live Feed** • news\nUpdated',
      embeds: [{ title: '📰 WARFRAME • NEWS', footer: { text: 'old footer' } }],
      delete: async () => { deleted.push(legacyWarframeId); }
    }]
  ]);
  let fetches = 0;
  const channel = {
    id: channelId,
    isTextBased: () => true,
    messages: {
      fetch: async (input) => {
        fetches += 1;
        if (typeof input === 'string') return all.get(input) || null;
        const recent = new Map(all);
        recent.delete(baroId);
        return recent;
      }
    }
  };
  const publisher = new EventFeedPublisher({
    client: { user: { id: 'sentinal' }, channels: { fetch: async () => channel } },
    guild: {},
    backend: { invoke: async () => { throw new Error('warframe feed should not post'); } },
    state: {
      getModuleSetup: () => ({ textChannels: [{ name: 'warframe-world-state', id: channelId }] })
    },
    env: {},
    logger: { log() {}, warn() {}, error() {} }
  });
  publisher.feedState = feedState;
  let invoked = false;
  publisher.backend = { invoke: async () => { invoked = true; return { ok: true, data: {} }; } };
  publisher.state = {
    getModuleSetup() { invoked = true; return null; }
  };
  assert.equal((await publisher.publish(WARFRAME_FEED)).skipped, 'warframe-disabled');
  assert.equal(invoked, false);
  publisher.state = {
    getModuleSetup: () => ({ textChannels: [{ name: 'warframe-world-state', id: channelId }] })
  };

  const first = await publisher.retireWarframeFeed();
  assert.equal(first.status, 'done');
  assert.equal(first.skipped, false);
  assert.equal(deleted.includes(newsId), true);
  assert.equal(deleted.includes(baroId), true);
  assert.equal(deleted.includes(extraId), true);
  assert.equal(deleted.includes(pogoId), false);
  assert.equal(deleted.includes(otherBotId), false);
  assert.equal(deleted.includes(divisionId), false);
  assert.equal(deleted.includes(legacyWarframeId), true);
  const saved = JSON.parse(fs.readFileSync(feedState.file, 'utf8'));
  assert.equal(saved.retired.warframe.status, 'done');
  assert.equal(saved.feeds['warframe:warframe-world-state:news'], undefined);
  assert.equal(saved.feeds['pokemongo:pokemon-go-events:events'].messageId, pogoId);
  const after = fetches;
  const second = await publisher.retireWarframeFeed();
  assert.equal(second.skipped, true);
  assert.equal(fetches, after);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Cephalon edits Warframe panels in place and stays inside its category', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cephalon-warframe-panels-'));
  const sent = [];
  const edited = [];
  const deleted = [];
  const foreignEdits = [];
  const foreign = message({
    id: '555555555555555551',
    author: { id: SENTINAL_ID, bot: true },
    embeds: [{ title: '📰 WARFRAME • NEWS', footer: { text: feedMarker('warframe', 'news') } }],
    edit: async () => { foreignEdits.push('edit'); },
    delete: async () => { foreignEdits.push('delete'); }
  });
  const titled = message({
    id: '555555555555555552',
    author: { id: '333333333333333333', bot: true },
    webhookId: '333333333333333333',
    embeds: [{ title: "Cephalon • Baro Ki'Teer" }, { title: "Baro Ki'Teer" }],
    edit: async () => { foreignEdits.push('webhook-edit'); },
    delete: async () => { foreignEdits.push('webhook-delete'); }
  });
  const circuitTitle = message({
    id: '555555555555555553',
    author: { id: SENTINAL_ID, bot: true },
    embeds: [{ title: 'Cephalon • Circuit', footer: { text: 'Cephalon Nexus • warframe:circuit' } }],
    edit: async () => { foreignEdits.push('circuit-edit'); },
    delete: async () => { foreignEdits.push('circuit-delete'); }
  });
  const outside = {
    id: '1516640233389822777',
    name: 'warframe-world-state',
    parentId: '1516602943670059108',
    send: async () => { throw new Error('outside category'); }
  };
  const board = liveChannel({
    id: CHANNEL_ID,
    name: 'warframe-world-state',
    parentId: OWNER_CATEGORY_IDS.cephalon,
    sent,
    edited,
    deleted,
    seed: [foreign, titled, circuitTitle]
  });
  const calls = [];
  const provider = {
    worldstate: async (pathname) => {
      calls.push(pathname);
      return warframeWorldstate(pathname);
    }
  };
  const client = {
    user: { id: BOT_ID },
    channels: { fetch: async (id) => (id === CHANNEL_ID ? board : null) },
    guilds: { cache: { values: () => [{ channels: { cache: { values: () => [outside, board] } } }] } }
  };
  const env = { NEXUS_DATA_DIR: dir, CEPHALON_WARFRAME_WORLD_CHANNEL_ID: 'warframe-world-state' };
  try {
    const blocked = await refreshWarframePanels({
      client: { user: { id: BOT_ID }, channels: { fetch: async () => outside }, guilds: { cache: { values: () => [] } } },
      env: { ...env, CEPHALON_WARFRAME_WORLD_CHANNEL_ID: outside.id },
      provider: { worldstate: async () => { throw new Error('should-not-fetch'); } },
      dir
    });
    assert.equal(blocked.refreshed, 0);
    assert.equal(blocked.skipped.every((item) => item.reason === 'wrong-category'), true);
    assert.equal(sent.length, 0);

    const first = await refreshWarframePanels({ client, env, provider, dir });
    assert.equal(PANELS.some((panel) => panel.id === 'news'), false);
    assert.equal(calls.includes('news'), false);
    assert.equal(first.refreshed, PANELS.length);
    assert.equal(sent.length, PANELS.length);
    assert.equal(foreignEdits.length, 0);
    const packed = JSON.stringify(sent);
    assert.doesNotMatch(packed, /Cephalon • Warframe News/);
    assert.match(packed, /Cephalon • Baro Ki'Teer/);
    assert.match(packed, /Prisma Gorgon/);
    assert.match(packed, /Cephalon • Circuit/);
    assert.match(packed, /joy/);
    assert.match(packed, /Excalibur/);
    assert.match(packed, /Umbra Forma Blueprint/);
    assertBotBanner(sent[0], 'cephalon');
    const titles = sent.map((body) => body.embeds[0].title);
    assert.equal(new Set(titles).size, titles.length);
    for (const panel of PANELS) {
      assert.equal(panelMatcher(PANEL_IDENTITIES[panel.panel])({ embeds: [sent.find((body) => body.embeds[0].footer.text.startsWith(`Cephalon Nexus • warframe:${panel.id}`)).embeds[0]] }), true);
    }
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cephalon-warframe-panels.json'), 'utf8'));
    assert.equal(Object.keys(saved.panels).length, PANELS.length);

    const callsAfterCreate = calls.length;
    const second = await refreshWarframePanels({ client, env, provider, dir });
    assert.equal(second.refreshed, PANELS.length);
    assert.equal(sent.length, PANELS.length);
    assert.equal(edited.length, PANELS.length);
    assert.equal(calls.length, callsAfterCreate);
    assert.equal(foreignEdits.length, 0);
    assert.equal(deleted.length, 0);
    assert.deepEqual(foreignEdits, []);
    const ids = new Set(edited.map((item) => item.id));
    assert.equal(ids.size, PANELS.length);
    for (const panel of PANELS) assert.equal(ids.has(saved.panels[panel.id].messageId), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a panel refresh already in flight is not posted a second time', async () => {
  let runs = 0;
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  const key = `warframe-panel-flight-${Date.now()}`;
  const ready = singleFlight(key, async () => {
    runs += 1;
    await hold;
    return 'posted';
  });
  const tick = singleFlight(key, async () => {
    runs += 1;
    return 'duplicate';
  });
  assert.equal(ready, tick);
  release();
  assert.equal(await ready, 'posted');
  assert.equal(await tick, 'posted');
  assert.equal(runs, 1);
});

test('the ready refresh and the first timer tick share one post per panel', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cephalon-warframe-race-'));
  const sent = [];
  const list = [];
  const channel = {
    id: CHANNEL_ID,
    name: 'warframe-world-state',
    parentId: OWNER_CATEGORY_IDS.cephalon,
    send: async (body) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      const created = message({
        id: `82${String(list.length + 1).padStart(16, '0')}`,
        author: { id: BOT_ID, bot: true },
        embeds: body.embeds,
        createdTimestamp: list.length + 1,
        edit: async () => {},
        delete: async () => { throw new Error('race deleted a panel'); }
      });
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
  const provider = { worldstate: async (pathname) => warframeWorldstate(pathname) };
  const client = {
    user: { id: BOT_ID },
    channels: { fetch: async () => channel }
  };
  const env = { NEXUS_DATA_DIR: dir, CEPHALON_WARFRAME_WORLD_CHANNEL_ID: CHANNEL_ID };
  try {
    const ready = refreshWarframePanels({ client, env, provider, dir });
    const tick = refreshWarframePanels({ client, env, provider, dir });
    const [first, second] = await Promise.all([ready, tick]);
    assert.equal(sent.length, PANELS.length);
    assert.equal(first.refreshed, PANELS.length);
    assert.equal(second.refreshed, PANELS.length);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cephalon-warframe-panels.json'), 'utf8'));
    assert.equal(Object.keys(saved.panels).length, PANELS.length);
    assert.equal(new Set(Object.values(saved.panels).map((panel) => panel.messageId)).size, PANELS.length);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Cephalon retires a Warframe news panel once and leaves the other boards in place', async () => {
  assert.deepEqual(PANELS.map((panel) => panel.id), [
    'events',
    'alerts',
    'sortie',
    'arbitration',
    'nightwave',
    'void-trader',
    'steel-path',
    'circuit'
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cephalon-news-retire-'));
  const channelId = '1540956147241062401';
  const newsId = '1554380090337534017';
  const strayId = '1554380090337534018';
  const titleOnlyId = '1554380090337534019';
  const eventsId = '1554380090337534020';
  const foreignId = '1554380090337534021';
  const webhookId = '1554380090337534022';
  const file = path.join(dir, 'cephalon-warframe-panels.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    panels: {
      news: { channelId, messageId: newsId },
      events: { channelId, messageId: eventsId }
    }
  }));
  const deleted = [];
  const logs = [];
  const warns = [];
  let fetches = 0;
  const authored = (id, title, footer, extra = {}) => ({
    id,
    author: { id: BOT_ID, bot: true },
    embeds: [{ title, footer: footer ? { text: footer } : undefined }],
    delete: async () => { deleted.push(id); },
    ...extra
  });
  const news = authored(newsId, 'Cephalon • Warframe News', 'Cephalon Nexus • warframe:news');
  const stray = authored(strayId, 'Cephalon • Warframe News', 'Cephalon Nexus • warframe:news');
  const titleOnly = authored(titleOnlyId, 'Cephalon • Warframe News', '');
  const events = authored(eventsId, 'Cephalon • Warframe Events', 'Cephalon Nexus • warframe:events');
  const foreign = {
    id: foreignId,
    author: { id: SENTINAL_ID, bot: true },
    embeds: [{ title: 'Cephalon • Warframe News', footer: { text: 'Cephalon Nexus • warframe:news' } }],
    delete: async () => { deleted.push(foreignId); }
  };
  const webhook = authored(webhookId, 'Cephalon • Warframe News', 'Cephalon Nexus • warframe:news', { webhookId: '999999999999999999' });
  const recent = [news, titleOnly, events, foreign, webhook];
  const byId = new Map([...recent, stray].map((item) => [item.id, item]));
  const channel = {
    id: channelId,
    messages: {
      fetch: async (arg) => {
        fetches += 1;
        if (arg && typeof arg === 'object') return { values: () => recent.values() };
        return byId.get(String(arg)) || null;
      }
    }
  };
  const logger = {
    log(line) { logs.push(String(line)); },
    warn(line) { warns.push(String(line)); }
  };
  const client = {
    user: { id: BOT_ID },
    channels: { fetch: async (id) => (String(id) === channelId ? channel : null) }
  };
  const env = {
    NEXUS_DATA_DIR: dir,
    CEPHALON_WARFRAME_WORLD_CHANNEL_ID: channelId,
    CEPHALON_WARFRAME_NEWS_CHANNEL_ID: channelId,
    CEPHALON_WARFRAME_NEWS_MESSAGE_ID: strayId
  };
  try {
    const earlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cephalon-news-early-'));
    const early = await retireNewsPanel({
      client: { channels: { fetch: async () => { throw new Error('too early'); } } },
      env: { NEXUS_DATA_DIR: earlyDir, CEPHALON_WARFRAME_WORLD_CHANNEL_ID: channelId },
      dir: earlyDir,
      logger
    });
    assert.equal(early.status, 'deferred');
    assert.equal(logs.length, 0);
    assert.equal(fs.existsSync(path.join(earlyDir, 'cephalon-warframe-panels.json')), false);
    fs.rmSync(earlyDir, { recursive: true, force: true });

    const first = await retireNewsPanel({ client, env, dir, logger });
    assert.equal(first.status, 'done');
    assert.equal(first.skipped, false);
    assert.equal(first.deleted, 3);
    assert.equal(deleted.includes(newsId), true);
    assert.equal(deleted.includes(strayId), true);
    assert.equal(deleted.includes(titleOnlyId), true);
    assert.equal(deleted.includes(eventsId), false);
    assert.equal(deleted.includes(foreignId), false);
    assert.equal(deleted.includes(webhookId), false);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.panels.news, undefined);
    assert.equal(saved.panels.events.messageId, eventsId);
    assert.equal(saved.retired.news.status, 'done');
    assert.equal(logs.length, 1);
    assert.equal(warns.length, 0);
    assert.match(logs[0], /warframe news retired deleted=3 failed=0/);
    const after = fetches;
    const second = await retireNewsPanel({ client, env, dir, logger });
    assert.equal(second.skipped, true);
    assert.equal(fetches, after);
    assert.equal(logs.length, 1);
    assert.equal(deleted.length, 3);

    const failDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cephalon-news-fail-'));
    const failFile = path.join(failDir, 'cephalon-warframe-panels.json');
    const stuckId = '1554380090337534030';
    fs.writeFileSync(failFile, JSON.stringify({
      version: 1,
      panels: { news: { channelId, messageId: stuckId }, events: { channelId, messageId: eventsId } }
    }));
    let failFetches = 0;
    const stuck = {
      id: stuckId,
      author: { id: BOT_ID, bot: true },
      embeds: [{ title: 'Cephalon • Warframe News', footer: { text: 'Cephalon Nexus • warframe:news' } }],
      delete: async () => { throw new Error('missing access'); }
    };
    const failChannel = {
      id: channelId,
      messages: {
        fetch: async (arg) => {
          failFetches += 1;
          if (arg && typeof arg === 'object') return { values: () => [stuck].values() };
          return String(arg) === stuckId ? stuck : null;
        }
      }
    };
    const failClient = {
      user: { id: BOT_ID },
      channels: { fetch: async () => failChannel }
    };
    const failed = await retireNewsPanel({
      client: failClient,
      env: { NEXUS_DATA_DIR: failDir, CEPHALON_WARFRAME_WORLD_CHANNEL_ID: channelId },
      dir: failDir,
      logger
    });
    assert.equal(failed.status, 'done');
    assert.equal(failed.failed, 1);
    assert.equal(warns.length, 0);
    assert.equal(logs.length, 2);
    assert.match(logs[1], /deleted=0 failed=1/);
    const failSaved = JSON.parse(fs.readFileSync(failFile, 'utf8'));
    assert.equal(failSaved.panels.news, undefined);
    assert.equal(failSaved.panels.events.messageId, eventsId);
    assert.equal(failSaved.retired.news.status, 'done');
    const failAfter = failFetches;
    const again = await retireNewsPanel({
      client: failClient,
      env: { NEXUS_DATA_DIR: failDir },
      dir: failDir,
      logger
    });
    assert.equal(again.skipped, true);
    assert.equal(failFetches, failAfter);
    assert.equal(logs.length, 2);
    assert.equal(warns.length, 0);
    fs.rmSync(failDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
