'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const { handleCraftInteraction, listingPayload, notifyOwner } = require('../src/craft/bot.cjs');
const {
  COLORS,
  MOTTO,
  buildBedrockEmbed,
  buildGeyserEmbed,
  buildJavaEmbed,
  buildRealmEmbed,
  embedText
} = require('../src/craft/embeds.cjs');
const { parseJavaStatusPacket } = require('../src/craft/protocol.cjs');
const { CraftStore } = require('../src/craft/store.cjs');

const OWNER = '1516602943670059101';
const APPLICANT = '1516640233389822042';
const CATEGORY = '1516602943670059108';
const PUBLIC_HOST = 'play.example';
const RCON_HOST = 'rcon.secret.example';
const RCON_PASSWORD = 'correct-horse-battery-stash';

function field(body, name) {
  return body.embeds[0].fields?.find((item) => item.name === name) || null;
}

function names(body) {
  return (body.embeds[0].fields || []).map((item) => item.name);
}

test('Java status parse keeps a player sample when the server sends one', () => {
  const payload = Buffer.concat([
    Buffer.from([0x00])
  ]);
  const json = JSON.stringify({
    description: 'Hello',
    players: { online: 2, max: 20, sample: [{ name: 'Steve' }, { name: 'Alex' }, { name: '' }] },
    version: { name: 'Paper 1.21', protocol: 767 }
  });
  const body = Buffer.from(json, 'utf8');
  const { writeVarInt } = require('../src/craft/protocol.cjs');
  const packetBody = Buffer.concat([Buffer.from([0x00]), writeVarInt(body.length), body]);
  const packet = Buffer.concat([writeVarInt(packetBody.length), packetBody]);
  const parsed = parseJavaStatusPacket(packet);
  assert.deepEqual(parsed.sample, ['Steve', 'Alex']);
  assert.equal(payload.length, 1);
});

test('Java embed shows status, players, sample, version, MOTD, latency, and join', () => {
  const body = buildJavaEmbed({
    host: PUBLIC_HOST,
    javaPort: 25565,
    java: {
      online: 2,
      max: 20,
      sample: ['Steve', 'Alex'],
      version: 'Paper 1.21',
      motd: `Welcome ${RCON_PASSWORD}`,
      latencyMs: 42
    },
    includeStaffActions: true,
    rconName: 'survival',
    forbidden: [RCON_HOST, RCON_PASSWORD, '25575']
  });
  assert.equal(body.embeds[0].title, 'Nexus Craft • Java');
  assert.equal(body.embeds[0].color, COLORS.fieryRed);
  assert.equal(body.embeds[0].footer.text, `${MOTTO} • status`);
  assert.equal(field(body, 'Status').value, 'Online');
  assert.equal(field(body, 'Players').value, '2/20');
  assert.equal(field(body, 'Playing').value, 'Steve, Alex');
  assert.equal(field(body, 'Version').value, 'Paper 1.21');
  assert.equal(field(body, 'MOTD').value, 'Welcome');
  assert.equal(field(body, 'Latency').value, '42 ms');
  assert.equal(field(body, 'Join').value, `${PUBLIC_HOST}:25565`);
  assert.equal(body.components[0].components[0].custom_id, 'craft:staff:players:survival');
  assert.equal(body.components[0].components[1].custom_id, 'craft:staff:whitelist:survival');
  assert.deepEqual(body.allowedMentions, { parse: [] });
  const text = embedText(body);
  assert.equal(text.includes(RCON_HOST), false);
  assert.equal(text.includes(RCON_PASSWORD), false);
  assert.equal(text.includes('25575'), false);
  assert.equal(text.includes('N/A'), false);
  assert.equal(/rcon/i.test(text), false);
});

test('Java embed hides empty fields and staff actions when RCON is not configured', () => {
  const body = buildJavaEmbed({
    host: PUBLIC_HOST,
    javaPort: 25565,
    java: { offline: true, version: '', motd: 'N/A', sample: [], latencyMs: null },
    includeStaffActions: false
  });
  assert.equal(body.embeds[0].color, COLORS.black);
  assert.deepEqual(names(body), ['Status', 'Join']);
  assert.equal(field(body, 'Status').value, 'Offline');
  assert.equal(body.components, undefined);
});

test('Bedrock embed is status and join only', () => {
  const body = buildBedrockEmbed({
    host: PUBLIC_HOST,
    javaPort: 25565,
    bedrockPort: 19132,
    bedrock: { online: 4, max: 10, version: '1.21.50', motd: 'Bedrock home', latencyMs: 12, sample: ['Steve'] },
    includeStaffActions: true,
    rconName: 'survival',
    forbidden: [RCON_HOST, RCON_PASSWORD]
  });
  assert.equal(body.embeds[0].title, 'Nexus Craft • Bedrock');
  assert.equal(body.embeds[0].color, COLORS.gunmetal);
  assert.deepEqual(names(body), ['Status', 'Players', 'Version', 'MOTD', 'Join']);
  assert.equal(field(body, 'Join').value, `${PUBLIC_HOST}:19132`);
  assert.equal(field(body, 'Status').value, 'Online');
  assert.equal(body.components, undefined);
  const text = embedText(body);
  assert.equal(text.includes('25565'), false);
  assert.equal(text.includes('Latency'), false);
  assert.equal(text.includes('Playing'), false);
  assert.equal(text.includes(RCON_HOST), false);
  assert.equal(/rcon/i.test(text), false);
});

test('Geyser embed shows Java status and both join addresses', () => {
  const body = buildGeyserEmbed({
    host: PUBLIC_HOST,
    javaPort: 25565,
    bedrockPort: 19132,
    java: { online: 1, max: 8, version: 'Paper', motd: 'Crossplay', latencyMs: 15, sample: ['Alex'] },
    includeStaffActions: true,
    rconName: 'survival',
    forbidden: [RCON_HOST, RCON_PASSWORD, '25575']
  });
  assert.equal(body.embeds[0].title, 'Nexus Craft • Geyser');
  assert.equal(field(body, 'Status').value, 'Online');
  assert.equal(field(body, 'Playing').value, 'Alex');
  assert.equal(field(body, 'Join (Java)').value, `${PUBLIC_HOST}:25565`);
  assert.equal(field(body, 'Join (Bedrock)').value, `${PUBLIC_HOST}:19132`);
  assert.equal(body.components, undefined);
  assert.equal(embedText(body).includes(RCON_PASSWORD), false);
  assert.equal(/rcon/i.test(embedText(body)), false);
});

test('Realm embed is the listing only and does not carry status or RCON', () => {
  const body = buildRealmEmbed({
    id: 'abc123abc123',
    name: 'Khaos Realm',
    description: 'Be kind',
    ownerId: OWNER,
    edition: 'java',
    slots: 4,
    status: 'open'
  });
  assert.equal(body.embeds[0].title, 'Khaos Realm');
  assert.equal(body.embeds[0].description, 'Be kind');
  assert.equal(field(body, 'Owner').value, `<@${OWNER}>`);
  assert.equal(body.embeds[0].footer.text, `${MOTTO} • realm:abc123abc123`);
  assert.equal(body.components[0].components[0].label, 'Apply');
  assert.deepEqual(body.allowedMentions, { parse: [] });
  assert.equal(body.allowedMentions.users, undefined);
  const text = embedText(body);
  assert.equal(names(body).includes('Status'), false);
  assert.equal(names(body).includes('Edition'), false);
  assert.equal(text.includes('Open slots'), false);
  assert.equal(/rcon|N\/A/i.test(text), false);
  assert.equal(listingPayload({ id: 'abc123abc123', name: 'Khaos Realm', description: 'Be kind', ownerId: OWNER, status: 'open' }).embeds[0].title, 'Khaos Realm');
});

test('Apply notifies the Realm owner by DM and does not ping a public channel', async () => {
  const listing = { id: 'abc123abc123', name: 'Khaos Realm', ownerId: OWNER, description: 'Be kind', status: 'open' };
  const application = { id: 'def456def456', applicantId: APPLICANT, gamertag: 'Steve', note: 'evening' };
  const sends = [];
  let threaded = false;
  const client = {
    users: {
      fetch: async (id) => {
        assert.equal(id, OWNER);
        return { send: async (body) => sends.push(body) };
      }
    }
  };
  const where = await notifyOwner(client, listing, application, {
    startThread: async () => { threaded = true; }
  });
  assert.equal(where, 'dm');
  assert.equal(threaded, false);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, undefined);
  assert.deepEqual(sends[0].allowedMentions, { parse: [] });
  assert.equal(embedText(sends[0]).includes(`<@${OWNER}>`), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-craft-apply-'));
  try {
    const store = new CraftStore(dir, {});
    const saved = store.createListing({ ownerId: OWNER, name: 'Khaos Realm', edition: 'java', description: 'Be kind', slots: 2 });
    const replies = [];
    let threadAttempt = false;
    const interaction = {
      customId: `craft:realm:submit:${saved.id}`,
      user: { id: APPLICANT },
      guildId: '100000000000000001',
      channel: { parentId: CATEGORY, type: 0 },
      message: { startThread: async () => { threadAttempt = true; } },
      replied: false,
      deferred: false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isModalSubmit: () => true,
      fields: { getTextInputValue: (key) => (key === 'gamertag' ? 'Steve' : 'evening') },
      reply: async (payload) => {
        replies.push(payload);
        interaction.replied = true;
      }
    };
    const dms = [];
    await handleCraftInteraction(interaction, {
      env: { NEXUS_CRAFT_DISCORD_CATEGORY_ID: CATEGORY },
      store,
      config: { discord: {} },
      client: { users: { fetch: async () => ({ send: async (body) => dms.push(body) }) } }
    });
    assert.equal(threadAttempt, false);
    assert.equal(dms.length, 1);
    assert.deepEqual(dms[0].allowedMentions, { parse: [] });
    assert.match(String(replies[0].content), /private message/);
    assert.equal(replies[0].allowedMentions.parse.length, 0);
    assert.equal(embedText(replies[0]).includes(`<@${OWNER}>`), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('staff-only Apply fallback stays ephemeral when the owner DM fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-craft-apply-staff-'));
  try {
    const store = new CraftStore(dir, {});
    const saved = store.createListing({ ownerId: OWNER, name: 'Khaos Realm', edition: 'bedrock', description: 'Be kind', slots: 1 });
    const replies = [];
    const interaction = {
      customId: `craft:realm:submit:${saved.id}`,
      user: { id: OWNER },
      guildId: '100000000000000001',
      channel: { parentId: CATEGORY, type: 0, send: async () => { throw new Error('public send'); } },
      message: { startThread: async () => { throw new Error('public thread'); } },
      memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator },
      replied: false,
      deferred: false,
      isChatInputCommand: () => false,
      isButton: () => false,
      isModalSubmit: () => true,
      fields: { getTextInputValue: (key) => (key === 'gamertag' ? 'Alex' : '') },
      reply: async (payload) => {
        replies.push(payload);
        interaction.replied = true;
      }
    };
    await handleCraftInteraction(interaction, {
      env: { NEXUS_CRAFT_DISCORD_CATEGORY_ID: CATEGORY },
      store,
      config: { discord: {} },
      client: { users: { fetch: async () => { throw new Error('dm closed'); } } }
    });
    assert.equal(replies.length, 1);
    assert.equal(replies[0].embeds[0].title, 'Realm application');
    assert.deepEqual(replies[0].allowedMentions, { parse: [] });
    assert.equal(replies[0].content, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
