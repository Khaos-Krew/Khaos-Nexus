'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { fetchClanRoster, normalizeRoster, normalizeSummary } = require('../../../src/game-bots/vanguard/bungie/clan.cjs');
const { createBungieRuntime } = require('../../../src/game-bots/vanguard/bungie/runtime.cjs');
const { renderClanSummary, renderRoster } = require('../../../src/game-bots/vanguard/panels/clan.cjs');
const { panelFooter } = require('../../../src/game-bots/vanguard/panels.cjs');
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
  assert.match(embed.description, /Members: 51/);
  assert.match(embed.description, /Founder: Ada#0007/);
  assert.match(embed.description, /Admin — Bee#0002/);
  assert.doesNotMatch(embed.description, /reward|redeemed/i);
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
  assert.match(outside[1].embeds[0].footer.text, /Not affiliated with or endorsed by Bungie/);
});
