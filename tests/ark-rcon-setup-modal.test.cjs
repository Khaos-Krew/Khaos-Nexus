'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags, TextInputStyle } = require('discord.js');
const { helpText } = require('../src/game-bots/ops-spine.cjs');
const { ArkRconConfigStore } = require('../src/sentinel/ark-rcon-config-store.cjs');
const {
  SETUP_FIELDS,
  SETUP_MODAL_PREFIX,
  PASSWORD_MODAL_PREFIX,
  DEFAULT_TIMEOUT_MS,
  rconCommand,
  setupModal,
  passwordModal,
  handleCommand,
  handlePasswordModal,
  handleSetupModal
} = require('../src/sentinel/ark-rcon-config-extension.cjs');

const root = path.resolve(__dirname, '..');
const OWNER_CONFIG_ERROR = 'RCON configuration and raw command execution are restricted to the Nexus owner.';
const PASSWORD = 'setup-modal-password';
const DECOY_PASSWORD = 'railway-decoy-secret';

function ownerConfig(extraOwners = []) {
  return {
    discord: {
      ownerUserIds: ['owner-1', ...extraOwners],
      operatorRoleIds: ['op-role'],
      guildId: 'guild-1'
    }
  };
}

function subcommand(json, name) {
  return json.options.find((option) => option.name === name);
}

function modalInputs(modal) {
  const json = modal.toJSON();
  const inputs = [];
  for (const row of json.components) {
    assert.equal(row.components.length, 1);
    inputs.push(row.components[0]);
  }
  return { json, inputs };
}

function commandInteraction({
  userId = 'owner-1',
  sub = 'setup',
  server = 'ARK_GEN1',
  guildOwnerId = 'guild-owner',
  admin = false,
  operator = false,
  host = '192.0.2.10',
  port = 30100,
  confirm = false
} = {}) {
  const shown = [];
  const replies = [];
  const interaction = {
    commandName: 'arkrcon',
    user: { id: userId },
    guild: { ownerId: guildOwnerId },
    guildId: 'guild-1',
    memberPermissions: { has: () => admin },
    member: { roles: { cache: operator ? [{ id: 'op-role' }] : [] } },
    isChatInputCommand: () => true,
    isModalSubmit: () => false,
    options: {
      getSubcommand: () => sub,
      getString: (name) => {
        if (name === 'server') return server;
        if (name === 'host') return host;
        return null;
      },
      getInteger: (name) => (name === 'port' ? port : null),
      getBoolean: (name) => (name === 'confirm' ? confirm : null)
    },
    showModal: async (modal) => {
      shown.push(modal);
    },
    deferReply: async (payload) => {
      interaction.deferred = true;
      replies.push({ type: 'defer', payload });
    },
    editReply: async (payload) => {
      replies.push({ type: 'edit', payload });
    },
    reply: async () => {
      throw new Error('slash setup must open a modal and not send a message');
    },
    shown,
    replies
  };
  return interaction;
}

function modalInteraction({
  userId = 'owner-1',
  customId = `${SETUP_MODAL_PREFIX}ARK_GEN1`,
  values = { host: '192.0.2.10', port: '30100', password: PASSWORD },
  guildOwnerId = 'guild-owner'
} = {}) {
  const replies = [];
  const interaction = {
    customId,
    user: { id: userId },
    guild: { ownerId: guildOwnerId },
    guildId: 'guild-1',
    isChatInputCommand: () => false,
    isModalSubmit: () => true,
    fields: {
      getTextInputValue: (id) => {
        if (!Object.prototype.hasOwnProperty.call(values, id)) throw new Error(`missing ${id}`);
        return values[id];
      }
    },
    deferReply: async (payload) => {
      interaction.deferred = true;
      replies.push({ type: 'defer', payload });
    },
    editReply: async (payload) => {
      replies.push({ type: 'edit', payload });
    },
    shown: [],
    replies
  };
  return interaction;
}

function snapshotEnv(keys) {
  const previous = {};
  for (const key of keys) previous[key] = process.env[key];
  return previous;
}

function restoreEnv(previous) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('setup subcommand is owner-only and keeps the existing arkrcon subcommands', () => {
  const json = rconCommand().toJSON();
  assert.equal(json.name, 'arkrcon');
  assert.ok(json.description.length <= 100);
  assert.match(json.description, /setup/);
  const names = json.options.map((option) => option.name);
  assert.deepEqual(names, ['status', 'test', 'setup', 'configure', 'password', 'send', 'clear']);

  const setup = subcommand(json, 'setup');
  assert.equal(setup.type, 1);
  assert.match(setup.description, /Owner-only/);
  assert.ok(setup.description.length <= 100);
  assert.deepEqual(setup.options.map((option) => option.name), ['server']);
  const server = setup.options[0];
  assert.equal(server.required, true);
  const choiceValues = server.choices.map((choice) => choice.value);
  assert.ok(choiceValues.includes('ARK_GEN1'));
  assert.ok(choiceValues.includes('ARK_MAP2'));
  const gen1 = server.choices.find((choice) => choice.value === 'ARK_GEN1');
  const map2 = server.choices.find((choice) => choice.value === 'ARK_MAP2');
  assert.equal(gen1.name, process.env.ARK_GEN1_NAME || 'Gen1');
  assert.equal(map2.name, process.env.ARK_MAP2_NAME || 'Astraeos');

  const configure = subcommand(json, 'configure');
  assert.deepEqual(configure.options.map((option) => option.name), ['server', 'host', 'port', 'enabled', 'timeout_ms']);
  assert.deepEqual(subcommand(json, 'password').options.map((option) => option.name), ['server']);
  assert.deepEqual(subcommand(json, 'test').options.map((option) => option.name), ['server']);
  assert.equal(subcommand(json, 'clear').options.some((option) => option.name === 'confirm'), true);
});

test('setup modal is one popup with three described fields inside Discord limits', () => {
  for (const field of Object.values(SETUP_FIELDS)) {
    assert.ok(field.label.length > 0 && field.label.length <= 45, field.customId);
    assert.ok(field.placeholder.length >= 60 && field.placeholder.length <= 100, field.customId);
    assert.equal(field.style, TextInputStyle.Short);
  }

  const { json, inputs } = modalInputs(setupModal('ARK_GEN1'));
  assert.equal(inputs.length, 3);
  assert.ok(json.title.length <= 45);
  assert.equal(json.custom_id, `${SETUP_MODAL_PREFIX}ARK_GEN1`);
  assert.deepEqual(inputs.map((input) => input.custom_id), ['host', 'port', 'password']);
  for (const input of inputs) {
    const field = SETUP_FIELDS[input.custom_id];
    assert.equal(input.label, field.label);
    assert.equal(input.placeholder, field.placeholder);
    assert.equal(input.style, TextInputStyle.Short);
    assert.equal(input.required, true);
    assert.equal(input.min_length, field.minLength);
    assert.equal(input.max_length, field.maxLength);
    assert.equal(input.type, 4);
  }

  const previous = process.env.ARK_GEN1_NAME;
  process.env.ARK_GEN1_NAME = 'VeryLongMapNameForModalTitleLimitCheck';
  try {
    const longTitle = setupModal('ARK_GEN1').toJSON();
    assert.ok(longTitle.title.length <= 45);
    assert.match(longTitle.title, /^Setup /);
  } finally {
    if (previous === undefined) delete process.env.ARK_GEN1_NAME;
    else process.env.ARK_GEN1_NAME = previous;
  }

  const existing = modalInputs(passwordModal('ARK_GEN1'));
  assert.equal(existing.json.custom_id, `${PASSWORD_MODAL_PREFIX}ARK_GEN1`);
  assert.equal(existing.inputs.length, 1);
  assert.equal(existing.inputs[0].label, SETUP_FIELDS.password.label);
  assert.equal(existing.inputs[0].style, inputs[2].style);
  assert.equal(existing.inputs[0].max_length, inputs[2].max_length);
  assert.equal(existing.inputs[0].style, TextInputStyle.Short);
  assert.equal(Object.keys(TextInputStyle).filter((key) => Number.isInteger(TextInputStyle[key])).length, 2);
});

test('only an owner can open setup, and the slash command does not also send a message', async () => {
  const config = ownerConfig();
  const owner = commandInteraction();
  assert.equal(await handleCommand(owner, config), true);
  assert.equal(owner.shown.length, 1);
  assert.equal(owner.replies.length, 0);
  assert.equal(owner.shown[0].toJSON().custom_id, `${SETUP_MODAL_PREFIX}ARK_GEN1`);

  const guildOwner = commandInteraction({ userId: 'guild-owner', guildOwnerId: 'guild-owner' });
  assert.equal(await handleCommand(guildOwner, { discord: { ownerUserIds: [], operatorRoleIds: [] } }), true);
  assert.equal(guildOwner.shown.length, 1);

  const admin = commandInteraction({ userId: 'staff-admin', admin: true });
  await assert.rejects(() => handleCommand(admin, config), { message: OWNER_CONFIG_ERROR });
  assert.equal(admin.shown.length, 0);

  const operator = commandInteraction({ userId: 'staff-op', operator: true });
  await assert.rejects(() => handleCommand(operator, config), { message: OWNER_CONFIG_ERROR });
  assert.equal(operator.shown.length, 0);

  const stranger = commandInteraction({ userId: 'stranger' });
  await assert.rejects(() => handleCommand(stranger, config), { message: 'ARK RCON controls require Nexus staff authorization.' });
  assert.equal(stranger.shown.length, 0);
});

test('setup modal submit saves the Discord override and never echoes the password', async () => {
  const keys = [
    'NEXUS_DATA_DIR',
    'NEXUS_RCON_RAILWAY_ENV_FORBIDDEN',
    'NEXUS_RCON_SOURCE',
    'NEXUS_RCON_CONFIG_SECRET',
    'ARK_GEN1_NAME',
    'ARK_GEN1_HOST',
    'ARK_GEN1_RCON_PORT',
    'ARK_GEN1_RCON_PASSWORD',
    'ARK_MAP2_NAME',
    'ARK_MAP2_HOST',
    'ARK_MAP2_RCON_PORT',
    'ARK_MAP2_RCON_PASSWORD'
  ];
  const previous = snapshotEnv(keys);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arkrcon-setup-'));
  process.env.NEXUS_DATA_DIR = dir;
  process.env.NEXUS_RCON_RAILWAY_ENV_FORBIDDEN = 'true';
  process.env.NEXUS_RCON_SOURCE = 'discord_override_store';
  delete process.env.NEXUS_RCON_CONFIG_SECRET;
  process.env.ARK_GEN1_NAME = 'Gen1';
  process.env.ARK_MAP2_NAME = 'Astraeos';
  process.env.ARK_GEN1_HOST = '198.51.100.9';
  process.env.ARK_GEN1_RCON_PORT = '1';
  process.env.ARK_GEN1_RCON_PASSWORD = DECOY_PASSWORD;
  process.env.ARK_MAP2_HOST = '198.51.100.8';
  process.env.ARK_MAP2_RCON_PORT = '2';
  process.env.ARK_MAP2_RCON_PASSWORD = DECOY_PASSWORD;

  try {
    const config = ownerConfig();
    const submitted = modalInteraction();
    assert.equal(await handleSetupModal(submitted, config), true);
    assert.equal(submitted.replies[0].type, 'defer');
    assert.equal(submitted.replies[0].payload.flags, MessageFlags.Ephemeral);
    const content = submitted.replies[1].payload.content;
    assert.match(content, /Next: `\/arkrcon test server:Gen1`/);
    assert.match(content, /Discord override store/);
    assert.match(content, /192\.0\.2\.10:30100/);
    assert.match(content, /configured/);
    assert.equal(content.includes(PASSWORD), false);
    assert.equal(content.includes(DECOY_PASSWORD), false);
    assert.equal(JSON.stringify(submitted.replies).includes(PASSWORD), false);

    const store = new ArkRconConfigStore(dir);
    const saved = store.get('ARK_GEN1');
    assert.equal(saved.host, '192.0.2.10');
    assert.equal(saved.port, 30100);
    assert.equal(saved.enabled, true);
    assert.equal(saved.timeoutMs, DEFAULT_TIMEOUT_MS);
    assert.equal(saved.timeoutMs, 8000);
    assert.equal(saved.password === PASSWORD, true);
    assert.equal(saved.updatedBy, 'owner-1');
    const resolved = store.resolve('ARK_GEN1', process.env);
    assert.equal(resolved.host, '192.0.2.10');
    assert.equal(resolved.port, 30100);
    assert.equal(resolved.password === PASSWORD, true);
    assert.equal(resolved.source, 'discord-override');

    const onDisk = fs.readFileSync(path.join(dir, 'ark-rcon-overrides.json'), 'utf8');
    assert.equal(onDisk.includes(PASSWORD), false);
    assert.equal(onDisk.includes(DECOY_PASSWORD), false);
    assert.match(onDisk, /aes-256-gcm/);
    assert.equal(process.env.ARK_GEN1_HOST, '198.51.100.9');
    assert.equal(process.env.ARK_GEN1_RCON_PASSWORD, DECOY_PASSWORD);

    const map2 = modalInteraction({
      customId: `${SETUP_MODAL_PREFIX}ARK_MAP2`,
      values: { host: '192.0.2.20', port: '30120', password: PASSWORD }
    });
    assert.equal(await handleSetupModal(map2, config), true);
    assert.match(map2.replies[1].payload.content, /Next: `\/arkrcon test server:Astraeos`/);
    assert.equal(map2.replies[1].payload.content.includes(PASSWORD), false);
    assert.equal(store.get('ARK_MAP2').port, 30120);

    const denied = modalInteraction({ userId: 'staff-admin' });
    await assert.rejects(() => handleSetupModal(denied, config), { message: OWNER_CONFIG_ERROR });
    assert.equal(denied.replies.length, 0);
    assert.equal(store.get('ARK_GEN1').password === PASSWORD, true);

    const badPort = modalInteraction({
      values: { host: '192.0.2.10', port: 'game-port', password: PASSWORD }
    });
    assert.equal(await handleSetupModal(badPort, config), true);
    assert.match(badPort.replies[1].payload.content, /port was rejected/);
    assert.equal(badPort.replies[1].payload.content.includes(PASSWORD), false);
    assert.equal(badPort.replies[1].payload.content.includes('game-port'), false);
    assert.equal(store.get('ARK_GEN1').port, 30100);

    const badHost = modalInteraction({
      values: { host: 'not a host', port: '30100', password: PASSWORD }
    });
    assert.equal(await handleSetupModal(badHost, config), true);
    assert.match(badHost.replies[1].payload.content, /host was rejected/);
    assert.equal(badHost.replies[1].payload.content.includes(PASSWORD), false);
    assert.equal(badHost.replies[1].payload.content.includes('not a host'), false);

    const emptyPassword = modalInteraction({
      values: { host: '192.0.2.11', port: '30111', password: '' }
    });
    assert.equal(await handleSetupModal(emptyPassword, config), true);
    assert.match(emptyPassword.replies[1].payload.content, /password was empty/);
    assert.equal(store.get('ARK_GEN1').host, '192.0.2.10');
    assert.equal(store.get('ARK_GEN1').password === PASSWORD, true);

    const configured = commandInteraction({
      sub: 'configure',
      host: '192.0.2.30',
      port: 30130
    });
    assert.equal(await handleCommand(configured, config), true);
    assert.equal(configured.shown.length, 0);
    assert.equal(configured.replies[0].payload.flags, MessageFlags.Ephemeral);
    assert.equal(configured.replies[1].payload.content.includes(PASSWORD), false);
    assert.match(configured.replies[1].payload.content, /192\.0\.2\.30:30130/);
    assert.equal(store.get('ARK_GEN1').password === PASSWORD, true);
    assert.equal(store.get('ARK_GEN1').timeoutMs, 8000);

    const passwordOnly = modalInteraction({
      customId: `${PASSWORD_MODAL_PREFIX}ARK_GEN1`,
      values: { password: 'replacement-modal-password' }
    });
    assert.equal(await handlePasswordModal(passwordOnly, config), true);
    assert.equal(passwordOnly.replies[1].payload.content.includes('replacement-modal-password'), false);
    assert.equal(store.get('ARK_GEN1').host, '192.0.2.30');
    assert.equal(store.get('ARK_GEN1').password === 'replacement-modal-password', true);
    const afterPassword = fs.readFileSync(path.join(dir, 'ark-rcon-overrides.json'), 'utf8');
    assert.equal(afterPassword.includes('replacement-modal-password'), false);

    const cleared = commandInteraction({ sub: 'clear', confirm: true });
    assert.equal(await handleCommand(cleared, config), true);
    assert.equal(cleared.replies[1].payload.content.includes('replacement-modal-password'), false);
    assert.equal(store.get('ARK_GEN1'), null);

    assert.equal(await handleSetupModal(modalInteraction({ customId: 'nexus:other:modal' }), config), false);
    assert.equal(await handleCommand({ isChatInputCommand: () => false }, config), false);
  } finally {
    restoreEnv(previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nexushelp points Ascended owners at /arkrcon setup and leaves Cephalon unchanged', () => {
  const ascended = helpText('ascended');
  const cephalon = helpText('cephalon');
  assert.match(ascended, /\/arkrcon setup server:Gen1/);
  assert.match(ascended, /server:Astraeos/);
  assert.match(ascended, /One modal for host, RCON port, and password\./);
  assert.match(ascended, /RCON setup, diagnostics, and the Discord override store/);
  assert.ok(ascended.length <= 1900);
  assert.doesNotMatch(cephalon, /\/arkrcon/);
  assert.doesNotMatch(helpText('sanctuary'), /\/arkrcon setup/);

  const extension = fs.readFileSync(path.join(root, 'src/sentinel/ark-rcon-config-extension.cjs'), 'utf8');
  assert.doesNotMatch(extension, /process\.env\.ARK_[A-Z0-9_]+_(HOST|RCON_PORT|RCON_PASSWORD)\s*=/);
  assert.doesNotMatch(extension, /RAILWAY_VARIABLE/);
});
