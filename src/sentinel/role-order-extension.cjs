'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const { createCoalescingRunner } = require('./coalescing-runner.cjs');
const { isStaff } = require('./safety-report-access.cjs');
const {
  emptyBands,
  roleOrderEnabled,
  accessRoleNamesFromCatalog,
  formatRoleOrderLog,
  formatRoleOrderPreview,
  reconcileRoleOrder
} = require('./role-order.cjs');

const INSTALLED = Symbol.for('khaos.nexus.roleOrder.extension');
const ROLE_ORDER_DEBOUNCE_MS = 30_000;
const ROLE_ORDER_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ROLE_MENU_STARTUP_WAIT_MS = 120_000;

let resolveRoleMenuStartup = () => {};
let roleMenuStartupSettled = false;
const roleMenuStartup = new Promise((resolve) => {
  resolveRoleMenuStartup = resolve;
});

function notifyRoleMenuStartupComplete() {
  if (roleMenuStartupSettled) return;
  roleMenuStartupSettled = true;
  resolveRoleMenuStartup();
}

function waitForRoleMenuStartup(timeoutMs = ROLE_MENU_STARTUP_WAIT_MS) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref?.();
  });
  return Promise.race([
    roleMenuStartup.then(() => 'ready'),
    timeout
  ]).finally(() => clearTimeout(timer));
}

function oneLine(value, max = 240) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
}

function roleOrderCommand() {
  return new SlashCommandBuilder()
    .setName('roleorder')
    .setDescription('Preview or apply the Nexus role ladder.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('preview').setDescription('Show current roles against the planned ladder.'))
    .addSubcommand((sub) => sub.setName('apply').setDescription('Apply the role ladder now.'));
}

async function registerRoleOrderCommand(guild) {
  const definition = roleOrderCommand();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  const body = definition.toJSON();
  if (existing) await guild.commands.edit(existing, body);
  else await guild.commands.create(body);
  return body;
}

function accessRoleIdsFromState(state) {
  const listed = state?.listAccessRoles?.() || {};
  return Object.values(listed).map((item) => String(item?.roleId || '')).filter(Boolean);
}

function logPlan(reason, result) {
  console.log(formatRoleOrderLog({
    reason,
    moved: result?.moved || 0,
    bands: result?.bands || emptyBands(),
    warnings: result?.warnings || []
  }));
}

function bindRoleOrder(client, { config, guildId, state }) {
  let debounceTimer = null;
  let lastResult = null;
  const runner = createCoalescingRunner(async (reason) => {
    try {
      const guild = client.guilds?.cache?.get?.(guildId) || await client.guilds.fetch(guildId);
      lastResult = await reconcileRoleOrder(guild, {
        config,
        state,
        client,
        guildId,
        accessRoleIds: accessRoleIdsFromState(state),
        accessRoleNames: accessRoleNamesFromCatalog(config),
        apply: true
      });
    } catch (error) {
      lastResult = {
        ok: false,
        skipped: true,
        moved: 0,
        bands: emptyBands(),
        warnings: [`Role order failed: ${oneLine(error?.message || error, 180)}`],
        updates: [],
        ladder: [],
        reason: 'error'
      };
    }
    logPlan(reason, lastResult);
  }, {
    onError: (error, reason) => console.error(`[Nexus Sentinal] role order (${reason}): ${oneLine(error?.message || error)}`)
  });

  async function requestReconcile(reason) {
    await runner.request(reason);
    return lastResult;
  }

  function schedule(reason) {
    if (!roleOrderEnabled()) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void requestReconcile(reason);
    }, ROLE_ORDER_DEBOUNCE_MS);
    debounceTimer.unref?.();
  }

  client.once(Events.ClientReady, async () => {
    if (!guildId) {
      logPlan('startup', {
        moved: 0,
        bands: emptyBands(),
        warnings: ['Discord guild is not configured.']
      });
      return;
    }
    try {
      const guild = client.guilds?.cache?.get?.(guildId) || await client.guilds.fetch(guildId);
      await registerRoleOrderCommand(guild);
      console.log(`[Nexus Sentinal] registered /roleorder in guild ${guild.id}`);
    } catch (error) {
      console.error(`[Nexus Sentinal] /roleorder registration failed: ${oneLine(error?.message || error)}`);
    }
    if (!roleOrderEnabled()) {
      logPlan('startup', {
        moved: 0,
        bands: emptyBands(),
        warnings: ['Role order is disabled (SENTINAL_ROLE_ORDER_ENABLED).']
      });
    } else {
      await waitForRoleMenuStartup();
      await requestReconcile('startup');
    }
    const timer = setInterval(() => {
      if (!roleOrderEnabled()) return;
      void requestReconcile('periodic');
    }, ROLE_ORDER_INTERVAL_MS);
    timer.unref?.();
  });

  client.on(Events.GuildRoleCreate, (role) => {
    if (String(role?.guild?.id || '') !== guildId) return;
    schedule('role-create');
  });
  client.on(Events.GuildRoleUpdate, (_previous, role) => {
    if (String(role?.guild?.id || '') !== guildId) return;
    schedule('role-update');
  });
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'roleorder') return;
    try {
      if (!interaction.guild || String(interaction.guild.id) !== guildId) {
        await interaction.reply({ content: '⚠️ /roleorder can only be used in the configured Nexus server.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (!(await isStaff(interaction.guild, interaction.user.id, config))) {
        await interaction.reply({ content: '⚠️ /roleorder is restricted to Nexus staff.', flags: MessageFlags.Ephemeral });
        return;
      }
      const sub = interaction.options.getSubcommand(false);
      if (sub === 'preview') {
        const guild = client.guilds?.cache?.get?.(guildId) || interaction.guild;
        const plan = await reconcileRoleOrder(guild, {
          config,
          state,
          client,
          guildId,
          accessRoleIds: accessRoleIdsFromState(state),
          accessRoleNames: accessRoleNamesFromCatalog(config),
          apply: false
        });
        await interaction.reply({ content: formatRoleOrderPreview(plan), flags: MessageFlags.Ephemeral });
        return;
      }
      if (sub === 'apply') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = await requestReconcile('command');
        await interaction.editReply({ content: formatRoleOrderPreview(result || {}) });
        return;
      }
      await interaction.reply({ content: '⚠️ Use `/roleorder preview` or `/roleorder apply`.', flags: MessageFlags.Ephemeral });
    } catch (error) {
      const content = `⚠️ ${oneLine(error?.message || error, 400)}`;
      try {
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
        else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      } catch (replyError) {
        console.error('[Nexus Sentinal] /roleorder response error:', replyError);
      }
    }
  });

  return { requestReconcile, schedule };
}

function installRoleOrderExtension() {
  if (Client.prototype[INSTALLED]) return false;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusRoleOrderLogin(...args) {
    const state = new StateStore();
    bindRoleOrder(this, { config, guildId, state });
    return originalLogin.apply(this, args);
  };
  return true;
}

module.exports = {
  ROLE_ORDER_DEBOUNCE_MS,
  ROLE_ORDER_INTERVAL_MS,
  ROLE_MENU_STARTUP_WAIT_MS,
  roleOrderCommand,
  registerRoleOrderCommand,
  notifyRoleMenuStartupComplete,
  waitForRoleMenuStartup,
  bindRoleOrder,
  installRoleOrderExtension
};
