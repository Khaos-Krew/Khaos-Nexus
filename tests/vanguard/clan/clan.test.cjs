'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { fetchClanRoster, normalizeRoster, normalizeSummary } = require('../../../src/game-bots/vanguard/bungie/clan.cjs');
const { createBungieRuntime, reasonText } = require('../../../src/game-bots/vanguard/bungie/runtime.cjs');
const { renderClanSummary, renderRoster } = require('../../../src/game-bots/vanguard/panels/clan.cjs');
const { panelFooter } = require('../../../src/game-bots/vanguard/panels.cjs');
const { handleClanAutocomplete } = require('../../../src/game-bots/vanguard/commands/d2-clan.cjs');
const { handleRoster } = require('../../../src/game-bots/vanguard/commands/d2-roster.cjs');
const { handleD2 } = require('../../../src/game-bots/vanguard/commands/d2.cjs');
const { GuildStateStore } = require('../../../src/game-bots/vanguard/state-store.cjs');

const GROUP = '5453042';
const PANELS = '1516640233389822991';
const BOT = '111111111111111111';
const STAFF = '1516640233389822888';

function summaryJson() {
  return {
    ErrorCode: 1,
    Response: {
      detail: { groupId: GROUP, name: 'KHAOS NEXUS', memberCount: 51, motto: 'One Nexus', clanInfo: { clanCallsign: 'KNXS' } },
      founder: { destinyUserInfo: { bungieGlobalDisplayName: 'Ada', bungieGlobalDisplayNameCode: 7 } }
    }
  };
}

function member(index) {
  return {
    memberType: index === 0 ? 5 : 2,
    isOnline: index % 2 === 0,
    joinDate: '2024-01-02T18:00:00Z',
    destinyUserInfo: { bungieGlobalDisplayName: `Guardian${index}`, bungieGlobalDisplayNameCode: index }
  };
}

function channelFor(messages) {
  return {
    id: PANELS,
    send: async (body) => {
      const message = {
        id: `90000000000000000${messages.length + 1}`,
        author: { id: BOT, bot: true },
        embeds: body.embeds,
        createdTimestamp: messages.length + 1,
        edit: async (next) => {
          message.embeds = next.embeds;
          return message;
        },
        delete: async () => {}
      };
      messages.push(message);
      return message;
    },
    messages: {
      fetch: async (arg) => {
        if (arg && typeof arg === 'object') return { values: () => messages.values() };
        return messages.find((item) => item.id === arg) || null;
      }
    }
  };
}

test('clan summary omits weekly rewards and roster pages past 50', async () => {
  const source = ['bungie/clan.cjs', 'panels/clan.cjs', 'commands/d2-clan.cjs', 'commands/d2-roster.cjs']
    .map((file) => fs.readFileSync(path.join(__dirname, '../../../src/game-bots/vanguard', file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /reward|redeemed|AdminGroups|MoveEquip|oauth/i);
  const summary = normalizeSummary(summaryJson());
  const embed = renderClanSummary({
    summary,
    admins: [{ name: 'Ada#0007', memberType: 5, founder: true }, { name: 'Bee#0002', memberType: 3, founder: false }]
  });
  assert.match(embed.title, /KHAOS NEXUS/);
  assert.doesNotMatch(embed.title, /Vanguard •/);
  assert.match(embed.description, /Members: 51/);
  assert.doesNotMatch(embed.description, /Online:/);
  const unnamed = renderClanSummary({ summary: { memberCount: 3 } });
  assert.match(unnamed.title, /KHAOS NEXUS/);
  assert.match(unnamed.description, /^Join:$/m);
  assert.equal((unnamed.description.match(/^Join:/gm) || []).length, 1);
  assert.doesNotMatch(unnamed.description, /ask a clan admin|Online:/);
  const unnamedRoster = renderRoster({ summary: {}, roster: { members: [], total: 0 }, page: 1 });
  assert.match(unnamedRoster.title, /KHAOS NEXUS/);
  assert.match(embed.description, /groupId=5453042/);
  assert.match(embed.description, /-# Not affiliated with or endorsed by Bungie/);
  assert.doesNotMatch(embed.description, /reward|redeemed/i);
  assert.ok(embed.description.split('\n').length <= 4);
  const page = normalizeRoster({
    Response: { results: [member(50)], totalResults: 51, hasMore: false, query: { currentPage: 2, itemsPerPage: 50 } }
  }, 2);
  const roster = renderRoster({ summary, roster: page, page: 2 });
  assert.match(roster.description, /page 2/);
  assert.match(roster.description, /Guardian50/);
  const calls = [];
  const client = {
    async get(pathname, query) {
      calls.push({ pathname, query });
      return { ok: true, json: { Response: { results: [], totalResults: 51, hasMore: false, query: { currentPage: query.currentpage } } } };
    }
  };
  await fetchClanRoster(client, GROUP, 2);
  assert.equal(calls[0].pathname, `/GroupV2/${GROUP}/Members/`);
  assert.equal(calls[0].query.currentpage, 2);
});

test('the clan panel is one message per group and is edited in place', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-clan-'));
  const messages = [];
  const channel = channelFor(messages);
  const env = {
    BUNGIE_API_KEY: 'present',
    VANGUARD_DATA_DIR: dir,
    VANGUARD_CLAN_PANEL_ENABLED: 'true',
    VANGUARD_CLAN_GROUP_IDS: GROUP,
    VANGUARD_XUR_PANEL_ENABLED: 'false',
    VANGUARD_RESET_PANEL_ENABLED: 'false'
  };
  let memberPage = 0;
  const runtime = createBungieRuntime({
    env,
    now: () => Date.parse('2026-10-01T22:00:00Z'),
    sleep: async () => {},
    discord: { user: { id: BOT }, channels: { fetch: async () => channel } },
    panelStore: new GuildStateStore(path.join(dir, 'panels.json')),
    channelsFor: () => ({ panels: PANELS }),
    fetch: async (url) => {
      if (String(url).endsWith('/Settings/')) {
        return {
          status: 200,
          headers: { get: () => 'application/json' },
          async text() {
            return JSON.stringify({
              ErrorCode: 1,
              Response: { systems: { Destiny2: { enabled: true }, D2Profiles: { enabled: true }, D2Vendors: { enabled: true }, D2Manifest: { enabled: false } } }
            });
          }
        };
      }
      if (String(url).includes('/AdminsAndFounder/')) {
        return {
          status: 200,
          headers: { get: () => 'application/json' },
          async text() {
            return JSON.stringify({ ErrorCode: 1, Response: { results: [{ memberType: 5, destinyUserInfo: { bungieGlobalDisplayName: 'Ada', bungieGlobalDisplayNameCode: 7 } }] } });
          }
        };
      }
      if (String(url).includes('/Members/')) {
        memberPage += 1;
        return { status: 200, headers: { get: () => 'application/json' }, async text() { return JSON.stringify({ ErrorCode: 1, Response: { results: [], totalResults: 1 } }); } };
      }
      return {
        status: 200,
        headers: { get: () => 'application/json' },
        async text() { return JSON.stringify(summaryJson()); }
      };
    }
  });
  await runtime.boot('1516640233389822001');
  await runtime.refreshPanels('1516640233389822001', { which: 'clan', force: true });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].embeds[0].footer.text, panelFooter(`clan:${GROUP}`));
  assert.match(messages[0].embeds[0].description, /KHAOS NEXUS/);
  assert.equal(messages[0].embeds[0].description.includes('reward'), false);
});

test('roster is staff-only and can request a later page', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-roster-'));
  const env = {
    BUNGIE_API_KEY: 'present',
    VANGUARD_DATA_DIR: dir,
    VANGUARD_CLAN_GROUP_IDS: GROUP,
    VANGUARD_STAFF_ROLE_IDS: STAFF
  };
  const pages = [];
  const runtime = createBungieRuntime({
    env,
    now: () => 5_000,
    sleep: async () => {},
    channelsFor: () => ({}),
    panelStore: { read: () => ({}), async update(fn) { return fn({}); } },
    fetch: async (url) => {
      pages.push(String(url));
      if (String(url).endsWith('/Settings/')) {
        return {
          status: 200,
          headers: { get: () => 'application/json' },
          async text() {
            return JSON.stringify({ ErrorCode: 1, Response: { systems: { Destiny2: { enabled: true }, D2Profiles: { enabled: true } } } });
          }
        };
      }
      if (String(url).includes('/Members/')) {
        const page = new URL(url).searchParams.get('currentpage');
        const index = page === '2' ? 50 : 0;
        return {
          status: 200,
          headers: { get: () => 'application/json' },
          async text() {
            return JSON.stringify({
              ErrorCode: 1,
              Response: {
                results: [member(index)],
                totalResults: 51,
                hasMore: page !== '2',
                query: { currentPage: Number(page), itemsPerPage: 50 }
              }
            });
          }
        };
      }
      if (String(url).includes('/AdminsAndFounder/')) {
        return { status: 200, headers: { get: () => 'application/json' }, async text() { return JSON.stringify({ ErrorCode: 1, Response: { results: [] } }); } };
      }
      return { status: 200, headers: { get: () => 'application/json' }, async text() { return JSON.stringify(summaryJson()); } };
    }
  });
  await runtime.health.poll(runtime.api);
  const replies = [];
  const reply = {
    async replyText(interaction, text) { replies.push(text); },
    async replyEmbed(interaction, embed) { replies.push(embed.description); }
  };
  await handleRoster({
    user: { id: '1516640233389822101' },
    member: { roles: { cache: new Map() } },
    options: { getString: () => '', getInteger: () => 1 }
  }, { bungie: runtime, env }, reply);
  assert.match(replies[0], /restricted to Nexus staff/);
  replies.length = 0;
  const interaction = {
    user: { id: '1516640233389822101' },
    member: { roles: { cache: new Map([[STAFF, { id: STAFF }]]) } },
    deferred: false,
    replied: false,
    options: {
      getString: () => '',
      getInteger: (name) => (name === 'page' ? 2 : null)
    },
    async deferReply() { this.deferred = true; }
  };
  await handleRoster(interaction, { bungie: runtime, env }, reply);
  assert.match(replies[0], /page 2/);
  assert.match(replies[0], /Guardian50/);
  assert.ok(pages.some((url) => url.includes('currentpage=2')));
  const outside = [];
  await handleD2({
    commandName: 'd2',
    options: { getSubcommand: () => 'clan', getString: () => '' },
    user: { id: '1516640233389822101' },
    deferred: false,
    async deferReply(body) { this.deferred = true; outside.push(body); },
    async editReply(body) { outside.push(body); }
  }, { bungie: runtime, env });
  assert.equal(outside[0].flags, MessageFlags.Ephemeral);
  assert.match(outside[1].embeds[0].description, /KHAOS NEXUS/);
  assert.match(outside[1].embeds[0].description, /-# Not affiliated with or endorsed by Bungie/);
  assert.equal(outside[1].embeds[0].footer.text, 'Many Worlds One Nexus • clan');
  assert.equal(outside[1].embeds[0].thumbnail.url, 'attachment://icon-vanguard.png');
  assert.equal(outside[1].embeds[0].image, undefined);
  const choices = [];
  await handleClanAutocomplete({
    options: { getFocused: () => ({ name: 'clan', value: '' }) },
    respond: async (rows) => choices.push(...rows)
  }, {
    env,
    bungie: { cache: { get: () => ({ summary: { name: 'KHAOS NEXUS' } }) } }
  });
  assert.equal(choices[0].name, 'KHAOS NEXUS');
  assert.equal(choices[0].value, GROUP);
  assert.equal(choices[0].name.includes(GROUP), false);
});

test('clan autocomplete answers from cache only while Bungie hangs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-clan-ac-'));
  let fetches = 0;
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const env = {
    BUNGIE_API_KEY: 'present',
    VANGUARD_DATA_DIR: dir,
    VANGUARD_CLAN_GROUP_IDS: GROUP
  };
  const runtime = createBungieRuntime({
    env,
    now: () => 1_000_000,
    sleep: async () => {},
    fetch: async () => {
      fetches += 1;
      await gate;
      return {
        status: 503,
        headers: { get: () => 'application/json' },
        async text() { return ''; }
      };
    }
  });
  const choices = [];
  const started = Date.now();
  try {
    const pending = handleClanAutocomplete({
      options: { getFocused: () => ({ name: 'clan', value: '' }) },
      respond: async (rows) => choices.push(...rows)
    }, { env, bungie: runtime });
    const result = await Promise.race([
      pending.then(() => 'done'),
      new Promise((resolve) => setTimeout(() => resolve('slow'), 80))
    ]);
    assert.equal(result, 'done');
    assert.ok(Date.now() - started < 50);
    assert.equal(fetches, 0);
    assert.equal(choices.length, 1);
    assert.equal(choices[0].name, GROUP);
    assert.equal(choices[0].value, GROUP);
    assert.equal(reasonText('system-disabled'), 'Bungie is down for maintenance right now; try again later.');
    assert.equal(reasonText('unconfigured'), "Bungie isn't turned on yet. Ask staff.");
  } finally {
    release();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function settingsResponse(body, status = 200) {
  return {
    status,
    headers: { get: () => 'application/json' },
    async text() { return JSON.stringify(body); }
  };
}

test('maintenance copy is used only after Bungie reports the system disabled', async () => {
  const maintenance = 'Bungie is down for maintenance right now; try again later.';
  const notOn = "Bungie isn't turned on yet. Ask staff.";
  const flagOff = "That Destiny lookup isn't turned on yet. Ask staff.";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-maintenance-'));
  const base = {
    now: () => 50_000_000,
    sleep: async () => {},
    channelsFor: () => ({}),
    panelStore: { read: () => ({}), update: async (fn) => fn({}) }
  };
  try {
    const before = createBungieRuntime({
      ...base,
      env: { BUNGIE_API_KEY: 'present', VANGUARD_DATA_DIR: dir },
      fetch: async () => settingsResponse({ ErrorCode: 1, Response: { systems: {} } })
    });
    assert.equal(before.feature('xur').reason, 'gated');
    assert.equal(before.reasonText(before.feature('xur').reason), notOn);

    const flagged = createBungieRuntime({
      ...base,
      env: { BUNGIE_API_KEY: 'present', VANGUARD_DATA_DIR: dir, VANGUARD_XUR_PANEL_ENABLED: 'false' },
      fetch: async () => settingsResponse({ ErrorCode: 1, Response: { systems: {} } })
    });
    assert.equal(flagged.feature('xur').reason, 'disabled');
    assert.equal(flagged.reasonText(flagged.feature('xur').reason), flagOff);

    const disabledSystems = createBungieRuntime({
      ...base,
      env: { BUNGIE_API_KEY: 'present', VANGUARD_DATA_DIR: path.join(dir, 'systems') },
      fetch: async () => settingsResponse({
        ErrorCode: 1,
        Response: { systems: { D2Vendors: { enabled: false }, Destiny2: { enabled: true }, D2Profiles: { enabled: true } } }
      })
    });
    fs.mkdirSync(path.join(dir, 'systems'), { recursive: true });
    await disabledSystems.health.poll(disabledSystems.api);
    assert.equal(disabledSystems.health.read().degraded, false);
    assert.equal(disabledSystems.feature('xur').reason, 'system-disabled');
    assert.equal(disabledSystems.reasonText(disabledSystems.feature('xur').reason), maintenance);

    const errorFive = createBungieRuntime({
      ...base,
      env: { BUNGIE_API_KEY: 'present', VANGUARD_DATA_DIR: path.join(dir, 'error5') },
      fetch: async () => settingsResponse({ ErrorCode: 5, Response: null })
    });
    fs.mkdirSync(path.join(dir, 'error5'), { recursive: true });
    await errorFive.health.poll(errorFive.api);
    assert.equal(errorFive.health.read().degraded, true);
    assert.equal(errorFive.health.read().reason, 'system-disabled');
    assert.equal(errorFive.feature('xur').reason, 'system-disabled');
    assert.equal(errorFive.reasonText(errorFive.feature('xur').reason), maintenance);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a rejected staff alert does not take the process down', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-alert-crash-'));
  const script = path.join(dir, 'alert-crash.cjs');
  const runtimePath = path.join(__dirname, '../../../src/game-bots/vanguard/bungie/runtime.cjs');
  const entryPath = path.join(__dirname, '../../../src/game-bots/vanguard/entry.cjs');
  fs.writeFileSync(script, `'use strict';
const { createBungieRuntime } = require(${JSON.stringify(runtimePath)});
const { installRejectionGuard } = require(${JSON.stringify(entryPath)});
installRejectionGuard();
const dir = ${JSON.stringify(dir)};
const channel = '1516640233389822777';
async function main() {
  const runtime = createBungieRuntime({
    env: {
      BUNGIE_API_KEY: 'present',
      VANGUARD_DATA_DIR: dir,
      VANGUARD_CLAN_GROUP_IDS: '5453042',
      VANGUARD_STAFF_ALERT_CHANNEL_ID: channel
    },
    now: () => 50000000,
    sleep: async () => {},
    discord: {
      channels: {
        fetch: async () => ({
          send: async () => {
            const error = new Error('Missing Access');
            error.name = 'DiscordAPIError';
            error.code = 50001;
            throw error;
          }
        })
      }
    },
    fetch: async (url) => {
      const target = String(url);
      if (target.includes('/Settings/')) {
        return {
          status: 200,
          headers: { get: () => 'application/json' },
          async text() {
            return JSON.stringify({
              ErrorCode: 1,
              Response: { systems: { Destiny2: { enabled: true }, D2Profiles: { enabled: true } } }
            });
          }
        };
      }
      return {
        status: 403,
        headers: { get: () => 'text/html' },
        async text() { return '<html>down</html>'; }
      };
    }
  });
  await runtime.health.poll(runtime.api);
  if (!runtime.feature('clan').ok) {
    console.error('health-not-open');
    process.exit(2);
  }
  runtime.warmClan('5453042');
  await new Promise((resolve) => setTimeout(resolve, 150));
  Promise.reject(Object.assign(new Error('Missing Access'), { name: 'DiscordAPIError', code: 50001 }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  console.log('STAYED_UP');
  process.exit(0);
}
main().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
`);
  try {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 15000 });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.equal(result.status, 0, output);
    assert.match(result.stdout || '', /STAYED_UP/);
    assert.match(output, /clan warm class=DiscordAPIError:50001/);
    assert.match(output, /unhandled rejection class=DiscordAPIError:50001/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
