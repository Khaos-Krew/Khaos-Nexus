'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { MessageFlags } = require('discord.js');
const { OWNER_CATEGORY_IDS, installCategoryGate } = require('../src/game-bots/category-gate.cjs');
const { helpText } = require('../src/game-bots/ops-spine.cjs');
const { handleStageCommand, stageBuilders } = require('../src/game-bots/stage-commands.cjs');
const {
  CLAN_DEFAULTS,
  clanConfig,
  parseClanCustomId,
  parseClanApplication,
  clanApplicationModal,
  circuitEmbed,
  profileCard,
  profileEmbed,
  startCephalonBoards
} = require('../src/game-bots/cephalon-relay.cjs');

const OFFICER = CLAN_DEFAULTS.officerRoleId;
const MEMBER = CLAN_DEFAULTS.memberRoleId;
const CHANNEL = CLAN_DEFAULTS.channelId;
const APPLICANT = '1552750453287161001';

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function officerMember(roleId = OFFICER) {
  return { roles: { cache: { has: (id) => id === roleId } } };
}

function staffConfig(userId = '42') {
  return { discord: { ownerUserIds: [userId], operatorRoleIds: [] } };
}

test('clan custom ids, modal parse, and officer gate', async () => {
  assert.deepEqual(parseClanCustomId('cephalon:clan:apply'), { action: 'apply', userId: '' });
  assert.deepEqual(parseClanCustomId(`cephalon:clan:approve:${APPLICANT}`), { action: 'approve', userId: APPLICANT });
  assert.deepEqual(parseClanCustomId(`cephalon:clan:reject:${APPLICANT}`), { action: 'reject', userId: APPLICANT });
  assert.equal(parseClanCustomId('cephalon:clan:approve:nope'), null);
  assert.equal(parseClanCustomId('cephalon:nw:5:hunt'), null);

  const modal = clanApplicationModal().toJSON();
  assert.equal(modal.custom_id, 'cephalon:clan:submit');
  assert.equal(modal.components.length, 5);
  const fieldIds = modal.components.map((row) => row.components[0].custom_id);
  assert.deepEqual(fieldIds, ['alias', 'platform_mr', 'availability', 'prior', 'why']);

  const parsed = parseClanApplication({
    alias: 'Nova',
    platform_mr: 'PC MR18',
    availability: 'Evenings',
    prior: 'Old Clan',
    why: 'Farm and help recruits'
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.application.platform, 'PC');
  assert.equal(parsed.application.mr, '18');
  assert.equal(parsed.application.prior, 'Old Clan');

  const split = parseClanApplication({ platform: 'Xbox', mr: '8', alias: 'Loki', availability: 'Weekends', why: 'Trades' });
  assert.equal(split.ok, true);
  assert.equal(split.application.platform, 'Xbox');
  assert.equal(split.application.mr, '8');

  const invalid = parseClanApplication({ alias: '', platform_mr: '18', availability: '', why: '' });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors, ['alias', 'platform', 'availability', 'why']);
  assert.equal(parseClanApplication({ alias: 'A', platform_mr: 'PC 99', availability: 'Now', why: 'Hi' }).ok, false);

  assert.equal(clanConfig({}).channelId, CHANNEL);
  assert.equal(clanConfig({}).officerRoleId, OFFICER);
  assert.equal(clanConfig({ CEPHALON_CLAN_OFFICER_ROLE_ID: 'nope' }).officerRoleId, '');

  const shown = [];
  const apply = {
    customId: 'cephalon:clan:apply',
    isButton: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    showModal: async (body) => { shown.push(body.toJSON()); }
  };
  assert.equal(await handleStageCommand(apply, { bot: 'cephalon', env: {} }), true);
  assert.equal(shown[0].custom_id, 'cephalon:clan:submit');
  assert.equal(await handleStageCommand({ ...apply, isButton: () => true }, { bot: 'ascended', env: {} }), false);

  const added = [];
  const updates = [];
  const followUps = [];
  const pendingMessage = {
    embeds: [{
      title: 'Warframe clan application',
      description: `<@${APPLICANT}>`,
      fields: [{ name: 'Alias', value: 'Nova', inline: true }],
      footer: { text: `cephalon:clan:pending:${APPLICANT}` }
    }]
  };
  const approve = {
    customId: `cephalon:clan:approve:${APPLICANT}`,
    isButton: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    message: pendingMessage,
    member: officerMember(),
    guild: {
      members: {
        fetch: async (id) => ({ id, roles: { add: async (roleId) => { added.push({ id, roleId }); } } })
      }
    },
    update: async (body) => { updates.push(body); },
    followUp: async (body) => { followUps.push(body); },
    reply: async () => { throw new Error('officer approve should edit the message'); }
  };
  assert.equal(await handleStageCommand(approve, { bot: 'cephalon', env: {} }), true);
  assert.deepEqual(added, [{ id: APPLICANT, roleId: MEMBER }]);
  assert.match(updates[0].embeds[0].title, /Approved/);
  assert.equal(updates[0].embeds[0].footer.text, `cephalon:clan:approved:${APPLICANT}`);
  assert.equal(updates[0].components[0].components.every((button) => button.disabled === true), true);
  assert.match(followUps[0].content, /Clan Member role added/);

  const denied = [];
  const blocked = {
    customId: `cephalon:clan:approve:${APPLICANT}`,
    isButton: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    message: pendingMessage,
    member: officerMember('1552750453287161999'),
    guild: { members: { fetch: async () => { throw new Error('should-not-fetch'); } } },
    update: async () => { throw new Error('should-not-update'); },
    reply: async (body) => { denied.push(body); }
  };
  assert.equal(await handleStageCommand(blocked, { bot: 'cephalon', env: {} }), true);
  assert.match(denied[0].content, /Officers/);
  assert.equal(denied[0].flags, MessageFlags.Ephemeral);

  const rejected = [];
  const rejectAdds = [];
  const reject = {
    customId: `cephalon:clan:reject:${APPLICANT}`,
    isButton: () => true,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    message: pendingMessage,
    member: officerMember(),
    guild: { members: { fetch: async () => { rejectAdds.push('fetch'); return { roles: { add: async () => { rejectAdds.push('add'); } } }; } } },
    update: async (body) => { rejected.push(body); },
    followUp: async () => {}
  };
  assert.equal(await handleStageCommand(reject, { bot: 'cephalon', env: {} }), true);
  assert.deepEqual(rejectAdds, []);
  assert.match(rejected[0].embeds[0].title, /Rejected/);
  assert.equal(rejected[0].components[0].components.every((button) => button.disabled === true), true);
});

test('clan modal posts an officer review and the panel edits in place', async () => {
  const dir = tempDir('clan-panel');
  const sent = [];
  const edited = [];
  const messages = new Map();
  const client = {
    user: { id: '1516640233389822001' },
    channels: {
      fetch: async (id) => {
        assert.equal(id, CHANNEL);
        return {
          send: async (body) => {
            sent.push(body);
            const message = {
              id: '181818181818181818',
              edit: async (body) => { edited.push(body); }
            };
            messages.set(message.id, message);
            return message;
          },
          messages: { fetch: async (id) => messages.get(id) || null }
        };
      }
    }
  };
  const env = { NEXUS_DATA_DIR: dir };
  try {
    const replies = [];
    const modal = {
      customId: 'cephalon:clan:submit',
      isButton: () => false,
      isModalSubmit: () => true,
      isChatInputCommand: () => false,
      user: { id: APPLICANT },
      fields: {
        getTextInputValue(key) {
          const values = { alias: 'Nova', platform_mr: 'PC 12', availability: 'Nights', prior: '', why: 'Help the dojo' };
          if (!(key in values)) throw new Error('missing');
          return values[key];
        }
      },
      reply: async (body) => { replies.push(body); }
    };
    assert.equal(await handleStageCommand(modal, { bot: 'cephalon', env, client, dir }), true);
    assert.match(replies[0].content, /posted/);
    assert.equal(sent[0].content, `<@&${OFFICER}>`);
    assert.deepEqual(sent[0].allowedMentions.roles, [OFFICER]);
    assert.equal(sent[0].embeds[0].fields.find((field) => field.name === 'Alias').value, 'Nova');
    assert.equal(sent[0].embeds[0].fields.find((field) => field.name === 'MR').value, '12');
    assert.equal(sent[0].components[0].components[0].custom_id, `cephalon:clan:approve:${APPLICANT}`);
    assert.equal(sent[0].components[0].components[1].custom_id, `cephalon:clan:reject:${APPLICANT}`);

    const bad = {
      ...modal,
      fields: { alias: 'Nova', platform_mr: 'PC', availability: 'Nights', why: '' },
      reply: async (body) => { replies.push(body); }
    };
    await handleStageCommand(bad, { bot: 'cephalon', env, client, dir });
    assert.match(replies.at(-1).content, /why you want to join/);
    assert.equal(sent.length, 1);

    const staffReplies = [];
    const panel = {
      commandName: 'clan',
      user: { id: '42' },
      isChatInputCommand: () => true,
      isButton: () => false,
      isModalSubmit: () => false,
      options: { getSubcommand: () => 'panel' },
      reply: async (body) => { staffReplies.push(body); }
    };
    const context = { bot: 'cephalon', env, client, dir, config: staffConfig('42') };
    assert.equal(await handleStageCommand(panel, context), true);
    assert.match(staffReplies[0].content, /Posted/);
    assert.equal(sent.length, 2);
    assert.match(JSON.stringify(sent[1]), /cephalon:clan:apply/);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'cephalon-clan-panel.json'), 'utf8'));
    assert.equal(saved.messageId, '181818181818181818');

    await handleStageCommand(panel, context);
    assert.equal(edited.length, 1);
    assert.match(staffReplies.at(-1).content, /Updated/);
    assert.equal(sent.length, 2);

    const visitor = { ...panel, user: { id: '7' }, reply: async (body) => { staffReplies.push(body); } };
    await handleStageCommand(visitor, { ...context, config: staffConfig('42') });
    assert.match(staffReplies.at(-1).content, /Nexus staff/);
    assert.equal(edited.length, 1);

    const readyDir = tempDir('clan-ready');
    const readySent = [];
    const readyClient = new EventEmitter();
    readyClient.user = { id: '1516640233389822001' };
    readyClient.isReady = () => false;
    readyClient.channels = {
      fetch: async () => ({
        send: async (body) => {
          readySent.push(body);
          return { id: '171717171717171717' };
        },
        messages: { fetch: async () => null }
      })
    };
    const boards = startCephalonBoards({
      client: readyClient,
      env: { NEXUS_DATA_DIR: readyDir },
      provider: { worldstate: async () => { throw new Error('should-not-fetch'); } }
    });
    assert.equal(readySent.length, 0);
    readyClient.emit('clientReady');
    await flush();
    await flush();
    assert.equal(readySent.length, 1);
    assert.match(JSON.stringify(readySent[0]), /cephalon:clan:apply/);
    boards.stop();
    fs.rmSync(readyDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('profile and circuit soft-fail and stay on cephalon', async () => {
  const names = stageBuilders('cephalon').map((builder) => builder.toJSON().name);
  assert.equal(names.includes('profile'), true);
  assert.equal(names.includes('circuit'), true);
  assert.equal(names.includes('clan'), true);
  assert.equal(stageBuilders('ascended').some((builder) => ['profile', 'circuit', 'clan'].includes(builder.toJSON().name)), false);
  const help = helpText('cephalon');
  assert.ok(help.length <= 1900);
  assert.match(help, /\/profile/);
  assert.match(help, /\/circuit/);
  assert.match(help, /\/clan/);

  const urls = [];
  const profileLookup = async (username) => {
    if (username === 'Missing') throw new Error('Warframe data request failed with HTTP 404.');
    if (username === 'Down') throw new Error('Warframe data request timed out after 10000 ms.');
    return { username, masteryRank: 4 };
  };
  const provider = {
    worldstateBase: 'https://api.warframestat.us',
    async requestJson(url) {
      urls.push(url);
      return { displayName: 'Nova Prime', masteryRank: 30, guildName: 'Khaos', guildId: 'guild-9' };
    },
    async worldstate(pathname) {
      urls.push(pathname);
      if (pathname === 'duviriCycle') {
        return { state: 'joy', timeLeft: '40m', choices: [{ category: 'Normal', choices: ['Excalibur', 'Braton'] }, { category: 'Hard', choices: ['Loki'] }] };
      }
      if (pathname === 'steelPath') return { currentReward: { name: 'Umbra Forma Blueprint' }, remaining: '2d' };
      if (pathname === 'deepArchimedea') {
        return { eta: '1d', missions: [{ missionType: 'Exterminate', faction: 'Grineer', deviation: { name: 'Tight Belt' }, risks: [{ name: 'Powerless' }] }] };
      }
      throw new Error(`unexpected ${pathname}`);
    }
  };
  const replies = [];
  const reply = async (body) => { replies.push(body); };
  const base = {
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    reply
  };
  const context = { bot: 'cephalon', env: {}, provider };
  await handleStageCommand({ ...base, commandName: 'profile', options: { getString: () => 'Nova' } }, context);
  assert.equal(urls[0], 'https://api.warframestat.us/profile/Nova');
  assert.match(replies[0].embeds[0].title, /Nova Prime/);
  assert.match(JSON.stringify(replies[0].embeds[0].fields), /MR 30/);
  assert.match(JSON.stringify(replies[0].embeds[0].fields), /Khaos/);
  assert.match(JSON.stringify(replies[0].embeds[0].fields), /guild-9/);
  assert.match(replies[0].embeds[0].footer.text, /WFCD/);

  await handleStageCommand({ ...base, commandName: 'profile', options: { getString: () => 'Missing' } }, { ...context, provider: { profile: profileLookup } });
  assert.match(replies.at(-1).content, /No public profile for \*\*Missing\*\*/);
  await handleStageCommand({ ...base, commandName: 'profile', options: { getString: () => 'Down' } }, { ...context, provider: { profile: profileLookup } });
  assert.match(replies.at(-1).content, /unavailable/);
  await handleStageCommand({ ...base, commandName: 'profile', options: { getString: () => 'bad name' } }, context);
  assert.match(replies.at(-1).content, /in-game name/);

  assert.equal(profileCard({ error: 'missing' }), null);
  assert.match(profileEmbed(profileCard({ displayName: 'OnlyName' })).fields.find((field) => field.name === 'Clan').value, /Not listed/);

  await handleStageCommand({ ...base, commandName: 'circuit' }, context);
  await handleStageCommand({ ...base, commandName: 'circuit' }, context);
  assert.equal(urls.filter((item) => item === 'duviriCycle').length, 1);
  const digest = replies.at(-1).embeds[0].description;
  assert.match(digest, /joy/);
  assert.match(digest, /Excalibur/);
  assert.match(digest, /Umbra Forma Blueprint/);
  assert.match(digest, /Exterminate/);
  assert.match(digest, /Tight Belt/);
  assert.match(digest, /Powerless/);

  const partial = circuitEmbed({
    missing: ['duviri', 'archimedea'],
    steelPath: { currentReward: { name: 'Forma' }, remaining: '1h' }
  });
  assert.match(partial.description, /Duviri:\*\* unavailable/);
  assert.match(partial.description, /Forma/);
  assert.match(partial.description, /Archimedea:\*\* unavailable/);

  const calls = [];
  const gated = new EventEmitter();
  installCategoryGate(gated, { bot: 'cephalon', env: {} });
  gated.on('interactionCreate', (item) => {
    void handleStageCommand(item, {
      bot: 'cephalon',
      provider: { profile: async () => { calls.push('profile'); return {}; } }
    });
  });
  const denied = {
    guildId: null,
    commandName: 'profile',
    isChatInputCommand: () => true,
    isButton: () => false,
    reply: async (body) => { replies.push(body); }
  };
  gated.emit('interactionCreate', denied);
  await flush();
  await flush();
  assert.deepEqual(calls, []);
  assert.equal(replies.at(-1).content, 'Use this bot in the Warframe category.');
  assert.equal(replies.at(-1).flags, MessageFlags.Ephemeral);
  assert.equal(OWNER_CATEGORY_IDS.cephalon, '1516640233389822042');
});
