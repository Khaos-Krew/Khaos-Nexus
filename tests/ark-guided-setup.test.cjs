'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArkClusterRegistry } = require('../src/sentinel/ark-cluster-registry.cjs');
const { ArkRconConfigStore } = require('../src/sentinel/ark-rcon-config-store.cjs');
const {
  SETUP_FIELDS,
  SETUP_MODAL_PREFIX,
  PASSWORD_MODAL_PREFIX,
  DEFAULT_TIMEOUT_MS,
  rconCommand,
  setupModal,
  handleCommand,
  handleSetupModal,
  handlePasswordModal
} = require('../src/sentinel/ark-rcon-config-extension.cjs');
const {
  CLUSTER_SETUP_FIELDS,
  SETUP_MODAL_ID,
  SETUP_MAP_BUTTON_PREFIX,
  SETUP_MAP_MODAL_PREFIX,
  arkClusterCommand,
  clusterSetupModal,
  handleClusterCommand,
  handleClusterButton,
  handleClusterSetupModal
} = require('../src/sentinel/ark-cluster-extension.cjs');
const { helpText } = require('../src/game-bots/ops-spine.cjs');
const { mapLabel, openRegistry, resolveHealthPrefixes } = require('../src/game-bots/ascended-rcon-health.cjs');
const { startAscendedOpsLoop } = require('../src/game-bots/ascended-presence.cjs');

const PASSWORD = 'vault-secret-value';
const EOS = '0123456789abcdef0123456789abcdef';

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
}

function ownerConfig(id = 'owner-1') {
  return { discord: { ownerUserIds: [id], operatorRoleIds: [], guildId: 'guild' } };
}

function staffConfig() {
  return { discord: { ownerUserIds: ['owner-1'], operatorRoleIds: ['role-ops'], guildId: 'guild' } };
}

function modalInputs(modal) {
  const json = modal.toJSON();
  assert.ok(json.title.length >= 1 && json.title.length <= 45);
  assert.ok(json.custom_id.length >= 1 && json.custom_id.length <= 100);
  assert.ok(json.components.length >= 1 && json.components.length <= 5);
  return json.components.map((row) => {
    assert.equal(row.components.length, 1);
    const input = row.components[0];
    assert.ok(input.label.length >= 1 && input.label.length <= 45);
    assert.ok(input.placeholder.length >= 1 && input.placeholder.length <= 100);
    return input;
  });
}

function chat(overrides = {}) {
  const replies = [];
  const modals = [];
  const target = {
    guildId: 'guild',
    commandName: 'arkrcon',
    user: { id: 'owner-1' },
    memberPermissions: { has: () => false },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isModalSubmit: () => false,
    isButton: () => false,
    options: {
      getSubcommand: () => 'setup',
      getString: () => null,
      getInteger: () => null,
      getBoolean: () => null
    },
    async showModal(modal) {
      modals.push(modal);
      target.replied = true;
    },
    async deferReply() { target.deferred = true; },
    async editReply(payload) { replies.push(payload); return payload; },
    async reply(payload) { replies.push(payload); target.replied = true; return payload; },
    replies,
    modals,
    ...overrides
  };
  return target;
}

test('rcon setup modal explains host, port, and password inside Discord limits', () => {
  const definition = rconCommand().toJSON();
  const names = definition.options.map((option) => option.name);
  for (const name of ['status', 'test', 'setup', 'configure', 'password', 'send', 'clear']) {
    assert.ok(names.includes(name), name);
  }
  const setup = definition.options.find((option) => option.name === 'setup');
  assert.equal(setup.options[0].name, 'server');
  assert.ok(setup.options[0].choices.some((choice) => choice.value === 'ARK_GEN1'));
  assert.ok(setup.options[0].choices.some((choice) => choice.value === 'ARK_MAP2'));
  assert.ok(definition.description.length <= 100);
  assert.ok(setup.description.length <= 100);

  const inputs = modalInputs(setupModal('ARK_GEN1', { host: '192.0.2.20', port: 30100 }));
  assert.deepEqual(inputs.map((input) => input.custom_id), SETUP_FIELDS.map((field) => field.id));
  assert.deepEqual(inputs.map((input) => input.label), SETUP_FIELDS.map((field) => field.label));
  assert.deepEqual(inputs.map((input) => input.placeholder), SETUP_FIELDS.map((field) => field.placeholder));
  assert.equal(inputs[0].value, '192.0.2.20');
  assert.equal(inputs[1].value, '30100');
  assert.equal(inputs[2].value, undefined);
  assert.equal(inputs[2].required, true);
});

test('owner setup writes the encrypted vault and points at /arkrcon test', async () => {
  const dir = tempDir('rcon-setup');
  const previousData = process.env.NEXUS_DATA_DIR;
  const previousForbidden = process.env.NEXUS_RCON_RAILWAY_ENV_FORBIDDEN;
  process.env.NEXUS_DATA_DIR = dir;
  process.env.NEXUS_RCON_RAILWAY_ENV_FORBIDDEN = 'true';
  try {
    const denied = chat({
      user: { id: 'staff' },
      memberPermissions: { has: () => true },
      options: {
        getSubcommand: () => 'setup',
        getString: (name) => (name === 'server' ? 'ARK_GEN1' : null),
        getInteger: () => null,
        getBoolean: () => null
      }
    });
    await assert.rejects(() => handleCommand(denied, ownerConfig()), /restricted to the Nexus owner/);
    assert.equal(denied.modals.length, 0);

    const seeded = new ArkRconConfigStore(dir);
    seeded.setEndpoint('ARK_GEN1', { host: '192.0.2.10', port: 27020, timeoutMs: 12000, enabled: false, actorId: 'owner-1' });
    seeded.setPassword('ARK_GEN1', 'old-password', 'owner-1');

    const opened = chat({
      options: {
        getSubcommand: () => 'setup',
        getString: (name) => (name === 'server' ? 'ARK_GEN1' : null),
        getInteger: () => null,
        getBoolean: () => null
      }
    });
    assert.equal(await handleCommand(opened, ownerConfig()), true);
    const shown = JSON.stringify(opened.modals[0].toJSON());
    assert.match(shown, /192\.0\.2\.10/);
    assert.doesNotMatch(shown, /old-password/);
    assert.match(opened.modals[0].toJSON().custom_id, new RegExp(`^${SETUP_MODAL_PREFIX}ARK_GEN1$`));

    const submitted = chat({
      isChatInputCommand: () => false,
      isModalSubmit: () => true,
      customId: `${SETUP_MODAL_PREFIX}ARK_GEN1`,
      fields: {
        getTextInputValue(id) {
          return { host: '203.0.113.9', port: '30111', password: PASSWORD }[id];
        }
      }
    });
    assert.equal(await handleSetupModal(submitted, ownerConfig()), true);
    assert.equal(await handlePasswordModal(submitted, ownerConfig()), false);
    const reply = submitted.replies[0].content;
    assert.match(reply, /\/arkrcon test/);
    assert.match(reply, /not echoed/);
    assert.doesNotMatch(reply, new RegExp(PASSWORD));
    assert.equal(submitted.replies[0].allowedMentions.parse.length, 0);

    const saved = new ArkRconConfigStore(dir);
    const resolved = saved.resolve('ARK_GEN1', process.env);
    assert.equal(resolved.host, '203.0.113.9');
    assert.equal(resolved.port, 30111);
    assert.equal(resolved.password, PASSWORD);
    assert.equal(resolved.enabled, true);
    assert.equal(resolved.timeoutMs, 12000);
    assert.equal(DEFAULT_TIMEOUT_MS, 8000);
    const onDisk = fs.readFileSync(path.join(dir, 'ark-rcon-overrides.json'), 'utf8');
    assert.doesNotMatch(onDisk, new RegExp(PASSWORD));
    assert.doesNotMatch(onDisk, /old-password/);

    const fresh = chat({
      isModalSubmit: () => true,
      isChatInputCommand: () => false,
      customId: `${SETUP_MODAL_PREFIX}ARK_MAP2`,
      fields: {
        getTextInputValue(id) {
          return { host: '192.0.2.40', port: '27021', password: PASSWORD }[id];
        }
      }
    });
    await handleSetupModal(fresh, ownerConfig());
    assert.equal(new ArkRconConfigStore(dir).resolve('ARK_MAP2', process.env).timeoutMs, 8000);

    const password = chat({
      options: {
        getSubcommand: () => 'password',
        getString: () => 'ARK_MAP2',
        getInteger: () => null,
        getBoolean: () => null
      }
    });
    assert.equal(await handleCommand(password, ownerConfig()), true);
    assert.match(password.modals[0].toJSON().custom_id, new RegExp(`^${PASSWORD_MODAL_PREFIX}ARK_MAP2$`));

    const configured = chat({
      options: {
        getSubcommand: () => 'configure',
        getString: (name) => (name === 'server' ? 'ARK_MAP2' : '192.0.2.41'),
        getInteger: (name) => (name === 'port' ? 27022 : null),
        getBoolean: () => true
      }
    });
    assert.equal(await handleCommand(configured, ownerConfig()), true);
    assert.match(configured.replies[0].content, /endpoint override saved/);
    assert.equal(configured.deferred, true);
    assert.equal(new ArkRconConfigStore(dir).resolve('ARK_MAP2', process.env).port, 27022);
  } finally {
    if (previousData === undefined) delete process.env.NEXUS_DATA_DIR;
    else process.env.NEXUS_DATA_DIR = previousData;
    if (previousForbidden === undefined) delete process.env.NEXUS_RCON_RAILWAY_ENV_FORBIDDEN;
    else process.env.NEXUS_RCON_RAILWAY_ENV_FORBIDDEN = previousForbidden;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cluster setup writes registry metadata and never an RCON password', async () => {
  const root = tempDir('cluster-setup');
  const registry = new ArkClusterRegistry(root);
  const refreshes = [];
  const context = {
    config: staffConfig(),
    registry,
    async runRefresh(reason, poll) { refreshes.push({ reason, poll }); return { skipped: 'test' }; }
  };
  const outsider = chat({
    commandName: 'arkcluster',
    user: { id: 'visitor' },
    memberPermissions: { has: () => false },
    options: { getSubcommand: () => 'setup', getString: () => null, getInteger: () => null, getBoolean: () => null }
  });
  await assert.rejects(() => handleClusterCommand(outsider, context), /staff authorization/);
  assert.equal(outsider.modals.length, 0);

  const opened = chat({
    commandName: 'arkcluster',
    user: { id: 'staff-1' },
    memberPermissions: { has: () => true },
    options: { getSubcommand: () => 'setup', getString: () => null, getInteger: () => null, getBoolean: () => null }
  });
  assert.equal(await handleClusterCommand(opened, { ...context, config: staffConfig() }), true);
  const inputs = modalInputs(opened.modals[0]);
  assert.equal(opened.modals[0].toJSON().custom_id, SETUP_MODAL_ID);
  assert.deepEqual(inputs.map((input) => input.custom_id), CLUSTER_SETUP_FIELDS.map((field) => field.id));
  assert.deepEqual(inputs.map((input) => input.label), CLUSTER_SETUP_FIELDS.map((field) => field.label));
  assert.ok(inputs.every((input) => input.custom_id !== 'password'));
  assert.doesNotMatch(JSON.stringify(opened.modals[0].toJSON()), /RCON password from GUS/);

  const submitted = chat({
    commandName: 'arkcluster',
    user: { id: 'staff-1' },
    memberPermissions: { has: () => true },
    isChatInputCommand: () => false,
    isModalSubmit: () => true,
    customId: SETUP_MODAL_ID,
    fields: {
      getTextInputValue(id) {
        return {
          id: 'astraeos',
          display_name: 'Khaos Astraeos',
          map_name: 'Astraeos',
          env_prefix: 'ARK_MAP2',
          cluster_id: 'khaos-nexus'
        }[id];
      }
    }
  });
  assert.equal(await handleClusterSetupModal(submitted, context), true);
  assert.equal(refreshes[0].reason, 'registry-setup');
  const reply = submitted.replies[0].content;
  assert.match(reply, /\/arkrcon setup/);
  assert.match(reply, /not stored/);
  assert.match(reply, /Astraeos/);
  assert.doesNotMatch(reply, new RegExp(PASSWORD));
  const button = submitted.replies[0].components[0].toJSON().components[0];
  assert.equal(button.label, 'Set map identifier');
  assert.equal(button.custom_id, `${SETUP_MAP_BUTTON_PREFIX}astraeos`);

  const record = registry.get('astraeos');
  assert.equal(record.name, 'Khaos Astraeos');
  assert.equal(record.mapName, 'Astraeos');
  assert.equal(record.envPrefix, 'ARK_MAP2');
  assert.equal(record.clusterId, 'khaos-nexus');
  assert.equal(record.enabled, true);
  const persisted = fs.readFileSync(registry.file, 'utf8');
  assert.doesNotMatch(persisted, /password|RCON_PASSWORD|vault-secret/i);
  assert.equal(fs.existsSync(path.join(registry.dir, 'ark-rcon-overrides.json')), false);

  const follow = chat({
    user: { id: 'staff-1' },
    memberPermissions: { has: () => true },
    isChatInputCommand: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    customId: button.custom_id
  });
  assert.equal(await handleClusterButton(follow, context), true);
  const mapModal = modalInputs(follow.modals[0]);
  assert.equal(mapModal[0].custom_id, 'map_identifier');
  assert.match(follow.modals[0].toJSON().custom_id, new RegExp(`^${SETUP_MAP_MODAL_PREFIX}astraeos$`));

  const identified = chat({
    user: { id: 'staff-1' },
    memberPermissions: { has: () => true },
    isChatInputCommand: () => false,
    isModalSubmit: () => true,
    customId: `${SETUP_MAP_MODAL_PREFIX}astraeos`,
    fields: { getTextInputValue: () => 'Astraeos_WP' }
  });
  assert.equal(await handleClusterSetupModal(identified, context), true);
  assert.equal(registry.get('astraeos').mapIdentifier, 'Astraeos_WP');
  assert.equal(refreshes.at(-1).poll, false);
  assert.doesNotMatch(fs.readFileSync(registry.file, 'utf8'), /password/i);

  const prefilled = chat({
    commandName: 'arkcluster',
    user: { id: 'owner-1' },
    options: {
      getSubcommand: () => 'setup',
      getString: (name) => (name === 'id' ? 'astraeos' : null),
      getInteger: () => null,
      getBoolean: () => null
    }
  });
  assert.equal(await handleClusterCommand(prefilled, context), true);
  const prefillInputs = modalInputs(prefilled.modals[0]);
  assert.equal(prefillInputs.find((input) => input.custom_id === 'display_name').value, 'Khaos Astraeos');
  assert.equal(prefillInputs.find((input) => input.custom_id === 'env_prefix').value, 'ARK_MAP2');
  assert.equal(prefillInputs.find((input) => input.custom_id === 'map_identifier'), undefined);

  const renamed = chat({
    user: { id: 'owner-1' },
    memberPermissions: { has: () => true },
    isChatInputCommand: () => false,
    isModalSubmit: () => true,
    customId: SETUP_MODAL_ID,
    fields: {
      getTextInputValue(id) {
        return {
          id: 'astraeos',
          display_name: 'Khaos Astraeos Live',
          map_name: 'Astraeos',
          env_prefix: 'ARK_MAP2',
          cluster_id: 'khaos-nexus'
        }[id];
      }
    }
  });
  assert.equal(await handleClusterSetupModal(renamed, context), true);
  assert.equal(registry.get('astraeos').name, 'Khaos Astraeos Live');
  assert.equal(registry.get('astraeos').mapIdentifier, 'Astraeos_WP');
  assert.doesNotMatch(fs.readFileSync(registry.file, 'utf8'), /password/i);

  const blocked = chat({
    user: { id: 'visitor' },
    memberPermissions: { has: () => false },
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `${SETUP_MAP_BUTTON_PREFIX}astraeos`
  });
  assert.equal(await handleClusterButton(blocked, context), true);
  assert.match(blocked.replies[0].content, /Nexus staff/);
  assert.equal(blocked.modals.length, 0);

  const names = arkClusterCommand().toJSON().options.map((option) => option.name);
  assert.ok(names.includes('setup'));
  assert.ok(names.includes('add'));
  assert.ok(names.includes('list'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('health and presence follow registry maps and nexushelp lists both recipes', async () => {
  const empty = tempDir('health-empty');
  assert.deepEqual(resolveHealthPrefixes({ NEXUS_DATA_DIR: empty }), ['ARK_GEN1', 'ARK_MAP2']);
  assert.equal(mapLabel('ARK_MAP2'), 'Map2');

  const root = tempDir('health-registry');
  const registry = openRegistry({ NEXUS_DATA_DIR: root });
  registry.upsert({ id: 'astraeos', name: 'Khaos Astraeos', mapName: 'Astraeos', envPrefix: 'ARK_MAP2', clusterId: 'khaos-nexus', enabled: true });
  registry.upsert({ id: 'retired', name: 'Retired', mapName: 'Retired', envPrefix: 'ARK_OLD1', enabled: false });
  assert.deepEqual(resolveHealthPrefixes({ NEXUS_DATA_DIR: root }), ['ARK_MAP2']);
  assert.equal(mapLabel('ARK_MAP2', registry), 'Astraeos');

  const store = new ArkRconConfigStore(root);
  store.setEndpoint('ARK_MAP2', { host: '192.0.2.20', port: 30101, actorId: 'owner' });
  store.setPassword('ARK_MAP2', PASSWORD, 'owner');
  const posts = [];
  let calls = 0;
  const handle = startAscendedOpsLoop({
    client: {
      isReady: () => true,
      channels: { fetch: async () => ({ send: async (message) => posts.push(message) }) }
    },
    env: {
      NEXUS_DATA_DIR: root,
      NEXUS_RCON_RAILWAY_ENV_FORBIDDEN: 'true',
      ASCENDED_PRESENCE_CHANNEL_ID: '1516602943670059108',
      ASCENDED_RCON_HEALTH_INTERVAL_MS: '1800000'
    },
    store,
    execute: async () => {
      calls += 1;
      return calls === 1 ? `0. Nova, ${EOS}` : '';
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await handle.tick();
  handle.stop();
  assert.equal(posts.length, 1);
  assert.match(posts[0].content, /Nova left Astraeos\./);
  assert.doesNotMatch(posts[0].content, new RegExp(PASSWORD));
  assert.doesNotMatch(posts[0].content, new RegExp(EOS));

  const ascended = helpText('ascended');
  const cephalon = helpText('cephalon');
  assert.match(ascended, /\/arkrcon setup/);
  assert.match(ascended, /\/arkrcon test/);
  assert.match(ascended, /\/arkcluster setup/);
  assert.match(ascended, /No RCON password/);
  assert.ok(ascended.length <= 1900);
  assert.doesNotMatch(cephalon, /\/arkrcon/);
  assert.doesNotMatch(cephalon, /\/arkcluster setup/);

  fs.rmSync(empty, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});
