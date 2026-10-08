'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HostedServerStore } = require('../src/backend/core/hosted-server-store.cjs');
const { ArkClusterRegistry } = require('../src/sentinel/ark-cluster-registry.cjs');
const { renderGameServersPanel, COMMUNITY_SERVER_RULES_TITLE } = require('../src/sentinel/game-servers-panel.cjs');
const { refreshGameServersPanel } = require('../src/sentinel/game-servers-extension.cjs');
const { LIVE_PROBE_TIMEOUT_MS, collectLivePublicServers, mergePanelServers } = require('../src/sentinel/game-servers-live.cjs');
const {
  ServerAlertMonitor,
  alertOwnerIds,
  alertTargets,
  alertsEnabled,
  formatDuration,
  isAlertableGameServer,
  renderServerAlert,
  runServerAlerts,
  sanitizeSavedServers
} = require('../src/sentinel/server-down-alerts.cjs');

const OWNER = '1516602943670059101';
const GUILD_OWNER = '1516602943670059199';
const ALERT_CHANNEL = '1516602943670059108';

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-gs-alerts-')); }

const LIVE_ROWS = [
  { id: 'ark:astraeos', game: 'ARK: Survival Ascended', name: 'Khaos Nexus (Astraeos)', kind: 'ark', joins: ['In-game server list: Khaos Nexus (Astraeos)'], status: 'Online', players: '3' },
  { id: 'ark:gen1', game: 'ARK: Survival Ascended', name: 'Khaos Nexus (Gen1)', kind: 'ark', joins: ['In-game server list: Khaos Nexus (Gen1)'], status: 'Offline', players: '' },
  { id: 'minecraft:env', game: 'Minecraft', name: 'Nexus Craft', kind: 'java', joins: ['Java play.mc.example:25565'], status: 'Online', players: '2/20' }
];

function row(name, status, extra = {}) {
  return { id: `ark:${name}`, game: 'ARK: Survival Ascended', name, kind: 'ark', status, ...extra };
}

test('managed panel renders the live public servers with the same names and status', () => {
  const payload = renderGameServersPanel({ servers: mergePanelServers(LIVE_ROWS, []), privateServers: [] });
  const embed = payload.embeds[0];
  const text = JSON.stringify(embed);
  assert.equal(text.includes('No public Nexus game servers are registered yet'), false);
  assert.equal(embed.fields[0].name, '🛡️ Official • ARK: Survival Ascended');
  assert.match(embed.fields[0].value, /🟢 \*\*Khaos Nexus \(Astraeos\)\*\*/);
  assert.match(embed.fields[0].value, /🛡️ Khaos Nexus Official • Online/);
  assert.match(embed.fields[0].value, /🔴 \*\*Khaos Nexus \(Gen1\)\*\*/);
  assert.match(embed.fields[0].value, /Offline/);
  assert.match(embed.fields[0].value, /\*\*Players:\*\* 3/);
  assert.equal(embed.fields[1].name, '🛡️ Official • Minecraft');
  assert.match(embed.fields[1].value, /🟢 \*\*Nexus Craft\*\*/);
  assert.match(embed.fields[1].value, /\*\*Players:\*\* 2 \/ 20/);
  assert.match(embed.fields[1].value, /\*\*Join:\*\* Java play\.mc\.example:25565/);
  assert.equal(embed.fields.at(-1).name, 'Community Server Program');
  assert.equal(payload.embeds[1].title, COMMUNITY_SERVER_RULES_TITLE);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('panel keeps /server add community entries, merged and deduped with live rows', () => {
  const registry = [
    { id: 'SRV-1', moduleId: 'ark', game: 'ARK: Survival Ascended', name: 'khaos nexus (astraeos)', trackingState: 'active', ownershipType: 'nexus-official', region: 'US' },
    { id: 'SRV-2', moduleId: 'palworld', game: 'Palworld', name: 'Community Pal', trackingState: 'online', ownershipType: 'community-approved', joinInfo: 'Search Community Pal' }
  ];
  const servers = mergePanelServers(LIVE_ROWS, registry);
  assert.equal(servers.length, 4);
  const astraeos = servers.find((server) => /astraeos/i.test(server.name));
  assert.equal(astraeos.trackingState, 'online');
  assert.equal(astraeos.region, 'US');
  const text = JSON.stringify(renderGameServersPanel({ servers, privateServers: [] }));
  assert.match(text, /Approved Community • Palworld/);
  assert.match(text, /Community Pal/);
  assert.equal((text.match(/\*\*Khaos Nexus \(Astraeos\)\*\*/g) || []).length, 1);
});

test('live collector reads the public inventory, ARK check time, and hosted ownership', async () => {
  const dir = tempDir();
  try {
    const arkRegistry = new ArkClusterRegistry(path.join(dir, 'ark'));
    arkRegistry.upsert({ id: 'gen1', envPrefix: 'ARK_GEN1', name: 'Khaos Nexus (Gen1)', mapName: 'Genesis', enabled: true, runtime: { state: 'offline', playerCount: 0, lastCheckedAt: '2026-10-07T23:00:00.000Z' } });
    const hostedStore = new HostedServerStore({ filePath: path.join(dir, 'hosted.json') });
    const added = hostedStore.add({ game: 'Palworld', serverType: 'hosted', name: 'Community Pal', joinInfo: 'Search Community Pal', public: true, ownershipType: 'community-approved' });
    hostedStore.update(added.id, { trackingState: 'online' });
    const rows = await collectLivePublicServers({
      env: { NEXUS_CRAFT_PUBLIC_JOIN: 'play.mc.example:25565', NEXUS_CRAFT_DATA_DIR: path.join(dir, 'craft') },
      config: { modules: {} },
      arkRegistry,
      hostedStore,
      probeServerStatus: async () => ({ java: { offline: false, online: 1, max: 10 } })
    });
    const gen1 = rows.find((item) => item.id === 'ark:gen1');
    assert.equal(gen1.status, 'Offline');
    assert.equal(gen1.checkedAt, '2026-10-07T23:00:00.000Z');
    const craft = rows.find((item) => item.game === 'Minecraft');
    assert.equal(craft.status, 'Online');
    assert.equal(craft.players, '1/10');
    const pal = rows.find((item) => item.name === 'Community Pal');
    assert.ok(pal);
    assert.equal(pal.ownershipType, 'community-approved');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('down alert is debounced: one offline check does not alert, two do', () => {
  let now = 1_000_000;
  const monitor = new ServerAlertMonitor({ file: null, now: () => now });
  assert.deepEqual(monitor.observe([row('Gen1', 'Offline')]), []);
  now += 60_000;
  const events = monitor.observe([row('Gen1', 'Offline')]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'down');
  assert.equal(events[0].name, 'Gen1');
  assert.equal(events[0].since, 1_000_000);
});

test('a single blip that recovers never alerts', () => {
  let now = 0;
  const monitor = new ServerAlertMonitor({ file: null, now: () => now });
  assert.deepEqual(monitor.observe([row('Gen1', 'Offline')]), []);
  now += 60_000;
  assert.deepEqual(monitor.observe([row('Gen1', 'Online')]), []);
  now += 60_000;
  assert.deepEqual(monitor.observe([row('Gen1', 'Offline')]), []);
});

test('no repeat alerts while a server stays down, then one recovery with downtime', () => {
  let now = 1_000_000;
  const monitor = new ServerAlertMonitor({ file: null, now: () => now });
  monitor.observe([row('Gen1', 'Offline')]);
  now += 60_000;
  assert.equal(monitor.observe([row('Gen1', 'Offline')]).length, 1);
  for (let index = 0; index < 10; index += 1) {
    now += 60_000;
    assert.deepEqual(monitor.observe([row('Gen1', 'Offline')]), []);
  }
  now = 1_000_000 + 45 * 60_000;
  const events = monitor.observe([row('Gen1', 'Online')]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'up');
  assert.equal(events[0].downMs, 45 * 60_000);
  const payload = renderServerAlert(events);
  assert.match(payload.content, /🟢 ARK: Survival Ascended • \*\*Gen1\*\* is \*\*back online\*\* after 45m down\./);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  now += 60_000;
  assert.deepEqual(monitor.observe([row('Gen1', 'Online')]), []);
});

test('stale upstream readings (same checkedAt) do not advance the debounce', () => {
  const monitor = new ServerAlertMonitor({ file: null });
  assert.deepEqual(monitor.observe([row('Gen1', 'Offline', { checkedAt: 'a' })]), []);
  assert.deepEqual(monitor.observe([row('Gen1', 'Offline', { checkedAt: 'a' })]), []);
  assert.equal(monitor.observe([row('Gen1', 'Offline', { checkedAt: 'b' })]).length, 1);
});

test('maintenance and unknown status never alert; Realms and Veyra are excluded', () => {
  const monitor = new ServerAlertMonitor({ file: null });
  const rows = [
    row('Gen1', 'Maintenance'),
    row('Astraeos', ''),
    { id: 'realm:1', game: 'Minecraft', name: 'Realm One', kind: 'realm', status: 'Offline' },
    { id: 'bot:veyra', game: 'Nexus D&D', name: 'Veyra', kind: 'hosted', status: 'Offline' }
  ];
  for (let index = 0; index < 4; index += 1) assert.deepEqual(monitor.observe(rows), []);
  assert.equal(isAlertableGameServer(rows[2]), false);
  assert.equal(isAlertableGameServer(rows[3]), false);
  assert.equal(isAlertableGameServer(LIVE_ROWS[0]), true);
});

test('alert state persists across restarts: no repeat down alert, recovery still sent', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'alerts.json');
    let now = 0;
    const first = new ServerAlertMonitor({ file, now: () => now });
    first.observe([row('Gen1', 'Offline')]);
    now += 60_000;
    assert.equal(first.observe([row('Gen1', 'Offline')]).length, 1);
    const restarted = new ServerAlertMonitor({ file, now: () => now });
    now += 60_000;
    assert.deepEqual(restarted.observe([row('Gen1', 'Offline')]), []);
    now += 60_000;
    const events = restarted.observe([row('Gen1', 'Online')]);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'up');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('fresh start with no saved state waits two checks before alerting', () => {
  const dir = tempDir();
  try {
    const monitor = new ServerAlertMonitor({ file: path.join(dir, 'missing', 'alerts.json') });
    assert.deepEqual(monitor.observe([row('Gen1', 'Offline')]), []);
    assert.equal(monitor.observe([row('Gen1', 'Offline')]).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('alert text neutralises mentions and masked links', () => {
  const payload = renderServerAlert([{ type: 'down', game: 'ARK', name: '@everyone [Click](https://x) <@123>', since: 1_700_000_000_000, checks: 2 }]);
  assert.equal(payload.content.includes('@everyone'), false);
  assert.equal(payload.content.includes('<@'), false);
  assert.match(payload.content, /\\\[Click\\\]\\\(https:\/\/x\\\)/);
  assert.match(payload.content, /<t:1700000000:t>/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.equal(formatDuration(90 * 60_000 + 26 * 3_600_000), '1d 3h 30m');
});

test('owner targets: configured owner ids first, guild owner fallback, channel optional, kill switch', () => {
  assert.deepEqual(alertOwnerIds({ discord: { ownerUserIds: [OWNER] } }, { ownerId: GUILD_OWNER }), [OWNER]);
  assert.deepEqual(alertOwnerIds({ discord: { ownerUserIds: [] } }, { ownerId: GUILD_OWNER }), [GUILD_OWNER]);
  assert.deepEqual(alertOwnerIds({}, null), []);
  assert.deepEqual(alertTargets({}, {}, { ownerId: GUILD_OWNER }), { ownerIds: [GUILD_OWNER], channelId: '' });
  assert.deepEqual(alertTargets({ SERVER_ALERT_CHANNEL_ID: ALERT_CHANNEL, SERVER_ALERT_DM_OWNER: 'false' }, {}, { ownerId: GUILD_OWNER }), { ownerIds: [], channelId: ALERT_CHANNEL });
  assert.deepEqual(alertTargets({ SERVER_ALERT_CHANNEL_ID: 'not-an-id' }, {}, null).channelId, '');
  assert.equal(alertsEnabled({}), true);
  assert.equal(alertsEnabled({ SERVER_DOWN_ALERTS: 'off' }), false);
});

function fakeClient() {
  const sent = { dms: [], channel: [] };
  return {
    sent,
    users: { fetch: async (id) => ({ id, send: async (payload) => { sent.dms.push({ id, payload }); } }) },
    channels: { fetch: async (id) => ({ id, send: async (payload) => { sent.channel.push({ id, payload }); } }) }
  };
}

test('runServerAlerts DMs the owner and optionally posts to the alert channel; kill switch skips', async () => {
  const client = fakeClient();
  const monitor = new ServerAlertMonitor({ file: null });
  const env = { SERVER_ALERT_CHANNEL_ID: ALERT_CHANNEL };
  await runServerAlerts(client, [row('Gen1', 'Offline')], { env, config: {}, guild: { ownerId: GUILD_OWNER }, monitor });
  assert.equal(client.sent.dms.length, 0);
  const result = await runServerAlerts(client, [row('Gen1', 'Offline')], { env, config: {}, guild: { ownerId: GUILD_OWNER }, monitor });
  assert.equal(result.delivery.dms, 1);
  assert.equal(result.delivery.channel, true);
  assert.equal(client.sent.dms[0].id, GUILD_OWNER);
  assert.match(client.sent.dms[0].payload.content, /\*\*Gen1\*\* is \*\*offline\*\*/);
  assert.deepEqual(client.sent.channel[0].payload.allowedMentions, { parse: [] });
  const off = await runServerAlerts(client, [row('Gen1', 'Online')], { env: { SERVER_DOWN_ALERTS: 'false' }, monitor });
  assert.equal(off.skipped, 'disabled');
});

test('panel refresh uses live rows, runs alerts, and still merges the registry', async () => {
  let edited = null;
  const channel = { id: ALERT_CHANNEL, name: 'game-servers', parentId: 'info', type: 0, isTextBased: () => true, messages: { fetch: async () => new Map() }, send: async (payload) => { edited = payload; return { id: 'm1', pinned: true }; } };
  const guild = { ownerId: GUILD_OWNER, channels: { fetch: async () => new Map([['info', { id: 'info', name: 'INFORMATION', type: 4 }], [channel.id, channel]]) } };
  const client = { ...fakeClient(), user: { id: 'sentinal' }, guilds: { fetch: async () => guild } };
  const backend = { trackedServers: async () => ({ ok: true, servers: [], privateServers: [] }) };
  const monitor = new ServerAlertMonitor({ file: null });
  const options = { backend, env: {}, alertMonitor: monitor, collectLive: async () => LIVE_ROWS };
  const first = await refreshGameServersPanel(client, { discord: { guildId: '1516602943670059000' } }, options);
  assert.equal(first.live, 3);
  assert.ok(edited);
  assert.match(JSON.stringify(edited.embeds[0]), /Khaos Nexus \(Gen1\)/);
  assert.equal(client.sent.dms.length, 0);
  await refreshGameServersPanel(client, { discord: { guildId: '1516602943670059000' } }, options);
  assert.equal(client.sent.dms.length, 1);
});

test('alerts still go out when INFORMATION / #game-servers is missing or the guild is unset', async () => {
  const guild = { ownerId: GUILD_OWNER, channels: { fetch: async () => new Map() } };
  const client = { ...fakeClient(), user: { id: 'sentinal' }, guilds: { fetch: async () => guild } };
  const backend = { trackedServers: async () => { throw new Error('panel path must not run'); } };
  const monitor = new ServerAlertMonitor({ file: null });
  const seen = [];
  const options = { backend, env: {}, alertMonitor: monitor, onAlerts: (alerts) => seen.push(alerts), collectLive: async () => [row('Gen1', 'Offline')] };
  const config = { discord: { guildId: '1516602943670059000' } };
  const first = await refreshGameServersPanel(client, config, options);
  assert.equal(first.skipped, 'information-category-missing');
  assert.equal(client.sent.dms.length, 0);
  const second = await refreshGameServersPanel(client, config, options);
  assert.equal(second.skipped, 'information-category-missing');
  assert.equal(second.alerts.events.length, 1);
  assert.equal(client.sent.dms.length, 1);
  assert.equal(client.sent.dms[0].id, GUILD_OWNER);
  assert.equal(seen.length, 2);

  const noGuild = { ...fakeClient(), user: { id: 'sentinal' }, guilds: { fetch: async () => { throw new Error('no guild'); } } };
  const unsetMonitor = new ServerAlertMonitor({ file: null });
  const ownerConfig = { discord: { ownerUserIds: [OWNER] } };
  const unsetOptions = { ...options, alertMonitor: unsetMonitor };
  await refreshGameServersPanel(noGuild, ownerConfig, unsetOptions);
  const unset = await refreshGameServersPanel(noGuild, ownerConfig, unsetOptions);
  assert.equal(unset.skipped, 'guild-unconfigured');
  assert.equal(noGuild.sent.dms.length, 1);
  assert.equal(noGuild.sent.dms[0].id, OWNER);
});

test('panel/alert Minecraft probe uses a 4s timeout', async () => {
  const dir = tempDir();
  try {
    const requests = [];
    await collectLivePublicServers({
      env: { NEXUS_CRAFT_PUBLIC_JOIN: 'play.mc.example:25565', NEXUS_CRAFT_DATA_DIR: path.join(dir, 'craft') },
      config: { modules: {} },
      arkRegistry: new ArkClusterRegistry(path.join(dir, 'ark')),
      hostedStore: new HostedServerStore({ filePath: path.join(dir, 'hosted.json') }),
      probeServerStatus: async (request) => { requests.push(request); return { java: { offline: true } }; }
    });
    assert.equal(LIVE_PROBE_TIMEOUT_MS, 4000);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].timeoutMs, 4000);
    assert.equal(requests[0].host, 'play.mc.example');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('corrupt or wrong-shape alert state resets to empty', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'alerts.json');
    const bad = [
      '{not json',
      'null',
      '[]',
      JSON.stringify({ servers: [] }),
      JSON.stringify({ servers: 'x' }),
      JSON.stringify({ servers: { 'ark|gen1': [] } }),
      JSON.stringify({ servers: { 'ark|gen1': { offlineChecks: -1, alerted: false, downSince: 0 } } }),
      JSON.stringify({ servers: { 'ark|gen1': { offlineChecks: 1, alerted: 'yes', downSince: 5 } } }),
      JSON.stringify({ servers: { 'ark|gen1': { offlineChecks: 2, alerted: true, downSince: 0 } } }),
      JSON.stringify({ servers: { nokey: { offlineChecks: 0, alerted: false, downSince: 0 } } })
    ];
    for (const text of bad) {
      fs.writeFileSync(file, text);
      const monitor = new ServerAlertMonitor({ file });
      assert.deepEqual(monitor.servers, {}, text);
      assert.deepEqual(monitor.observe([row('Gen1', 'Offline')]), [], text);
      assert.equal(monitor.observe([row('Gen1', 'Offline')]).length, 1, text);
    }
    const good = { servers: { 'ark: survival ascended|gen1': { offlineChecks: 3, alerted: true, downSince: 1000, checkedAt: '', game: 'ARK: Survival Ascended', name: 'Gen1' } } };
    assert.equal(sanitizeSavedServers(good)['ark: survival ascended|gen1'].alerted, true);
    fs.writeFileSync(file, JSON.stringify(good));
    const restored = new ServerAlertMonitor({ file, now: () => 61_000 });
    assert.deepEqual(restored.observe([row('Gen1', 'Offline')]), []);
    const up = restored.observe([row('Gen1', 'Online')]);
    assert.equal(up.length, 1);
    assert.equal(up[0].downMs, 60_000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
