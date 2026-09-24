'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');
const { SourceRcon } = require('../src/backend/transports/source-rcon.cjs');
const { decideCategory, realmDecisionAllowed } = require('../src/craft/access.cjs');
const { handleCraftInteraction } = require('../src/craft/bot.cjs');
const { startNexusCraft } = require('../src/craft/boot.cjs');
const { craftHelpText } = require('../src/craft/help.cjs');
const {
  decodeRconPackets,
  encodeRconPacket,
  parseBedrockPong,
  parseJavaStatusPacket,
  redactSecret
} = require('../src/craft/protocol.cjs');
const { CraftStore } = require('../src/craft/store.cjs');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const OWNER = '1516602943670059101';
const APPLICANT = '1516640233389822042';
const STRANGER = '1541540940471210128';
const CATEGORY = '1516602943670059108';

function writeVarInt(value) {
  const bytes = [];
  let num = value >>> 0;
  do {
    let next = num & 0x7f;
    num >>>= 7;
    if (num !== 0) next |= 0x80;
    bytes.push(next);
  } while (num !== 0);
  return Buffer.from(bytes);
}

function javaStatusPacket(json) {
  const body = Buffer.from(json, 'utf8');
  const payload = Buffer.concat([Buffer.from([0x00]), writeVarInt(body.length), body]);
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

function bedrockPong(text) {
  const body = Buffer.from(text, 'utf8');
  const magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
  const packet = Buffer.alloc(35 + body.length);
  packet.writeUInt8(0x1c, 0);
  packet.writeBigInt64BE(5n, 1);
  packet.writeBigInt64BE(9n, 9);
  magic.copy(packet, 17);
  packet.writeUInt16BE(body.length, 33);
  body.copy(packet, 35);
  return packet;
}

function button(customId, userId, extra = {}) {
  const replies = [];
  const updates = [];
  const interaction = {
    customId,
    user: { id: userId },
    guildId: '100000000000000001',
    channelId: '100000000000000002',
    deferred: false,
    replied: false,
    isChatInputCommand: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    reply: async (payload) => {
      replies.push(payload);
      interaction.replied = true;
    },
    update: async (payload) => {
      updates.push(payload);
      interaction.replied = true;
    },
    followUp: async (payload) => {
      replies.push(payload);
    },
    replies,
    updates,
    ...extra
  };
  return interaction;
}

function contentOf(payload) {
  return String(payload?.content || '');
}

test('RCON packet encode and decode round-trip a Source packet', () => {
  const known = Buffer.from([
    0x0b, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00,
    0x03, 0x00, 0x00, 0x00,
    0x78, 0x00, 0x00
  ]);
  assert.deepEqual(encodeRconPacket(1, 3, 'x'), known);
  const decoded = decodeRconPackets(known);
  assert.equal(decoded.packets.length, 1);
  assert.equal(decoded.packets[0].requestId, 1);
  assert.equal(decoded.packets[0].type, 3);
  assert.equal(decoded.packets[0].body, 'x');
  assert.equal(decoded.remaining.length, 0);

  const encoded = encodeRconPacket(10, 2, 'list');
  const partial = decodeRconPackets(encoded.subarray(0, 4));
  assert.equal(partial.packets.length, 0);
  const rest = decodeRconPackets(Buffer.concat([partial.remaining, encoded.subarray(4)]));
  assert.equal(rest.packets[0].requestId, 10);
  assert.equal(rest.packets[0].type, 2);
  assert.equal(rest.packets[0].body, 'list');

  const failure = Buffer.alloc(14);
  failure.writeInt32LE(10, 0);
  failure.writeInt32LE(-1, 4);
  failure.writeInt32LE(2, 8);
  assert.equal(decodeRconPackets(failure).packets[0].requestId, -1);
  assert.equal(redactSecret('auth failed correct-horse-battery', 'correct-horse-battery'), 'auth failed [redacted]');
});

test('Java status packet parse reads MOTD, version, and player counts', () => {
  const simple = parseJavaStatusPacket(javaStatusPacket(
    '{"description":"§aHi","players":{"max":4,"online":1},"version":{"name":"1.21.1","protocol":767}}'
  ));
  assert.equal(simple.motd, 'Hi');
  assert.equal(simple.version, '1.21.1');
  assert.equal(simple.protocol, 767);
  assert.equal(simple.online, 1);
  assert.equal(simple.max, 4);

  const component = parseJavaStatusPacket(javaStatusPacket(
    '{"description":{"text":"Khaos","extra":[{"text":" Craft"}]},"players":{"online":0,"max":20},"version":{"name":"Paper","protocol":1}}'
  ));
  assert.equal(component.motd, 'Khaos Craft');
  assert.equal(component.version, 'Paper');
  assert.equal(component.online, 0);
  assert.equal(component.max, 20);
  assert.throws(() => parseJavaStatusPacket(Buffer.from([0x01])), /Incomplete Java status packet/);
});

test('Bedrock pong parse reads the semicolon MOTD fields', () => {
  const text = 'MCPE;Khaos Realm;800;1.21.50;4;10;12345;Survival line;Survival;1;19132;19133;';
  const parsed = parseBedrockPong(bedrockPong(text));
  assert.equal(parsed.edition, 'MCPE');
  assert.equal(parsed.motd, 'Khaos Realm');
  assert.equal(parsed.protocol, '800');
  assert.equal(parsed.version, '1.21.50');
  assert.equal(parsed.online, 4);
  assert.equal(parsed.max, 10);
  assert.equal(parsed.motd2, 'Survival line');
  assert.equal(parsed.gamemode, 'Survival');

  const broken = bedrockPong(text);
  broken[17] = 0x11;
  assert.throws(() => parseBedrockPong(broken), /Invalid Bedrock pong/);
});

test('RCON settings come from the Discord store and the password is not echoed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-craft-'));
  const previous = {
    NEXUS_CRAFT_RCON_HOST: process.env.NEXUS_CRAFT_RCON_HOST,
    NEXUS_CRAFT_RCON_PORT: process.env.NEXUS_CRAFT_RCON_PORT,
    NEXUS_CRAFT_RCON_PASSWORD: process.env.NEXUS_CRAFT_RCON_PASSWORD,
    MINECRAFT_RCON_PASSWORD: process.env.MINECRAFT_RCON_PASSWORD
  };
  process.env.NEXUS_CRAFT_RCON_HOST = 'env-host.example';
  process.env.NEXUS_CRAFT_RCON_PORT = '25575';
  process.env.NEXUS_CRAFT_RCON_PASSWORD = 'env-secret-should-not-load';
  process.env.MINECRAFT_RCON_PASSWORD = 'env-secret-should-not-load';
  try {
    const store = new CraftStore(dir, {});
    assert.equal(store.getServer('default'), null);
    const password = 'correct-horse-battery';
    const saved = store.saveServer({ name: 'survival', host: 'play.example', port: 25575, password, actorId: OWNER });
    assert.equal(saved.password, 'configured');
    assert.equal(saved.host, 'play.example');
    assert.equal(JSON.stringify(saved).includes(password), false);
    const loaded = store.getServer('survival');
    assert.equal(loaded.password, password);
    assert.equal(loaded.host, 'play.example');
    assert.equal(loaded.source, 'discord-store');
    const file = fs.readFileSync(store.rconFile, 'utf8');
    assert.equal(file.includes(password), false);
    assert.equal(file.includes('env-secret-should-not-load'), false);
    assert.equal(store.clearServer('survival'), true);
    assert.equal(store.getServer('survival'), null);
    const sources = ['store.cjs', 'query.cjs', 'bot.cjs', 'boot.cjs', 'access.cjs']
      .map((name) => read(`src/craft/${name}`))
      .join('\n');
    assert.doesNotMatch(sources, /RCON_PASSWORD|RCON_HOST|RCON_PORT|MINECRAFT_RCON/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('RCON client times out instead of hanging', async () => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.resume();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const client = new SourceRcon({ host: '127.0.0.1', port, password: 'secret-pass', timeoutMs: 1000 });
    const started = Date.now();
    let message = '';
    try {
      await client.execute('list');
    } catch (error) {
      message = error.message;
    }
    assert.match(message, /timed out/i);
    assert.equal(message.includes('secret-pass'), false);
    assert.ok(Date.now() - started < 3000);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Realm approve and deny are limited to the listing owner or staff', async () => {
  assert.equal(realmDecisionAllowed({ actorId: OWNER, listingOwnerId: OWNER, staff: false }), true);
  assert.equal(realmDecisionAllowed({ actorId: STRANGER, listingOwnerId: OWNER, staff: true }), true);
  assert.equal(realmDecisionAllowed({ actorId: APPLICANT, listingOwnerId: OWNER, staff: false }), false);
  assert.equal(realmDecisionAllowed({ actorId: '', listingOwnerId: OWNER, staff: true }), false);
  assert.equal(realmDecisionAllowed({ actorId: STRANGER, listingOwnerId: '', staff: true }), false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-craft-realm-'));
  try {
    const store = new CraftStore(dir, {});
    const listing = store.createListing({
      ownerId: OWNER,
      name: 'Khaos Realm',
      edition: 'java',
      description: 'Be kind',
      slots: 2
    });
    const application = store.addApplication({
      listingId: listing.id,
      applicantId: APPLICANT,
      gamertag: 'Steve',
      note: 'evening'
    });
    const context = {
      env: { NEXUS_CRAFT_DISCORD_CATEGORY_ID: CATEGORY },
      store,
      config: { discord: {} },
      client: { users: { fetch: async () => ({ send: async () => {} }) } }
    };
    const stranger = button(`craft:realm:approve:${application.id}`, STRANGER);
    await handleCraftInteraction(stranger, context);
    assert.match(contentOf(stranger.replies[0]), /Only the Realm owner or Nexus staff/);
    assert.equal(stranger.updates.length, 0);
    assert.equal(store.getApplication(application.id).status, 'pending');

    const applicant = button(`craft:realm:deny:${application.id}`, APPLICANT);
    await handleCraftInteraction(applicant, context);
    assert.equal(store.getApplication(application.id).status, 'pending');

    const owner = button(`craft:realm:approve:${application.id}`, OWNER);
    await handleCraftInteraction(owner, context);
    assert.equal(store.getApplication(application.id).status, 'approved');
    assert.equal(owner.updates[0].components[0].components[0].disabled, true);
    assert.equal(owner.updates[0].components[0].components[1].disabled, true);
    assert.match(contentOf(owner.replies.at(-1)), /still adds them inside Minecraft/);

    const again = button(`craft:realm:deny:${application.id}`, OWNER);
    await handleCraftInteraction(again, context);
    assert.match(contentOf(again.replies[0]), /already decided/);
    assert.equal(store.getApplication(application.id).status, 'approved');

    const second = store.addApplication({
      listingId: listing.id,
      applicantId: STRANGER,
      gamertag: 'Alex',
      note: ''
    });
    const staff = button(`craft:realm:deny:${second.id}`, '1541540961937526916', {
      memberPermissions: { has: (bit) => bit === PermissionFlagsBits.Administrator }
    });
    await handleCraftInteraction(staff, context);
    assert.equal(store.getApplication(second.id).status, 'denied');
    assert.equal(staff.updates.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('category gate says not configured until the category id is set', async () => {
  const unset = decideCategory({}, CATEGORY);
  assert.equal(unset.allow, false);
  assert.match(unset.message, /not configured/);
  assert.match(unset.message, /NEXUS_CRAFT_DISCORD_CATEGORY_ID/);
  const blank = decideCategory({ NEXUS_CRAFT_DISCORD_CATEGORY_ID: '   ' }, CATEGORY);
  assert.equal(blank.code, 'unset');
  const invalid = decideCategory({ NEXUS_CRAFT_DISCORD_CATEGORY_ID: 'nope' }, CATEGORY);
  assert.equal(invalid.allow, false);
  assert.match(invalid.message, /not configured/);
  const outside = decideCategory({ NEXUS_CRAFT_DISCORD_CATEGORY_ID: CATEGORY }, STRANGER);
  assert.equal(outside.allow, false);
  assert.match(outside.message, /Discord category/);
  const inside = decideCategory({ NEXUS_CRAFT_DISCORD_CATEGORY_ID: CATEGORY }, CATEGORY);
  assert.equal(inside.allow, true);

  const replies = [];
  const interaction = {
    guildId: '100000000000000001',
    channel: { parentId: CATEGORY, type: 0 },
    commandName: 'craft',
    replied: false,
    deferred: false,
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    options: { getSubcommand: () => 'help', getSubcommandGroup: () => null },
    reply: async (payload) => replies.push(payload)
  };
  await handleCraftInteraction(interaction, { env: {}, store: {}, config: {} });
  assert.match(String(replies[0]?.content || ''), /not configured/);
  assert.match(String(replies[0]?.content || ''), /NEXUS_CRAFT_DISCORD_CATEGORY_ID/);
});

test('help text covers setup and the edition matrix', () => {
  const help = craftHelpText();
  assert.ok(help.length <= 1900);
  assert.match(help, /\/craft help/);
  assert.match(help, /\/mcrcon setup/);
  assert.match(help, /NEXUS_CRAFT_DISCORD_CATEGORY_ID/);
  assert.match(help, /not configured/);
  assert.match(help, /Geyser/);
  assert.match(help, /no official Realms API/);
  assert.match(help, /Bedrock dedicated server: status ping only/);
  assert.match(help, /Java dedicated server: status ping and full RCON/);
});

test('boots healthy when NEXUS_CRAFT_TOKEN is missing', async () => {
  const lines = [];
  let started;
  try {
    started = await startNexusCraft({ env: {}, port: 0, log: (line) => lines.push(line) });
    assert.equal(started.idle, true);
    assert.equal(started.state.discord, 'idle');
    assert.deepEqual(lines, ['[Nexus Craft] token missing, Discord idle']);
    assert.match(read('src/craft/boot.cjs'), /console\.log\(line\)/);
    assert.match(read('src/railway/craft-service.cjs'), /startNexusCraft\(\)/);
    const address = started.server.address();
    const health = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${address.port}/health`, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
    });
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), {
      ok: true,
      service: 'nexus-craft',
      bot: 'Nexus Craft',
      discord: 'idle'
    });
    const missing = await new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${address.port}/other`, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', reject);
    });
    assert.equal(missing, 404);
  } finally {
    if (started?.server) await new Promise((resolve) => started.server.close(resolve));
  }
});

test('Craft image and slash commands stay inside the Minecraft bot', () => {
  const dockerfile = read('Dockerfile.craft');
  assert.match(dockerfile, /src\/railway\/craft-service\.cjs/);
  assert.match(dockerfile, /docs\/ops\/NEXUS_CRAFT\.md/);
  assert.doesNotMatch(dockerfile, /RCON_PASSWORD|RCON_PORT|RCON_HOST|NEXUS_CRAFT_TOKEN=/);
  const doc = read('docs/ops/NEXUS_CRAFT.md');
  assert.match(doc, /Dockerfile\.craft/);
  assert.match(doc, /\/health/);
  assert.match(doc, /NEXUS_CRAFT_TOKEN/);
  assert.match(doc, /NEXUS_CRAFT_DISCORD_CATEGORY_ID/);
  assert.match(doc, /NEXUS_CRAFT_REALMS_CHANNEL_ID/);
  assert.match(doc, /src\/craft\/\*\*/);

  const { craftCommands } = require('../src/craft/bot.cjs');
  const commands = craftCommands().map((command) => command.toJSON());
  assert.deepEqual(commands.map((command) => command.name), ['craft', 'mcrcon', 'mc', 'realm']);
  function walk(option, label) {
    assert.ok(option.description && option.description.length <= 100, label);
    for (const child of option.options || []) walk(child, `${label}.${child.name}`);
  }
  for (const command of commands) walk(command, command.name);
});
