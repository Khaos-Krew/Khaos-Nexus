'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { isStaff } = require('./ark-ops-extension.cjs');
const { inspectArkApiLog } = require('./ark-api-log-diagnostic.cjs');
const { ArkDynamicEventEngine, EVENT_PRESETS, outputPath } = require('./ark-dynamic-events.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.dynamic.events.extension');
const BOUND = Symbol.for('khaos.nexus.ark.dynamic.events.bound');

function command() {
  const presetChoices = Object.entries(EVENT_PRESETS).map(([value, preset]) => ({ name: preset.label, value }));
  return new SlashCommandBuilder()
    .setName('arkevent')
    .setDescription('Manage ARK DynamicConfig events and notifications.')
    .addSubcommand((sub) => sub.setName('status').setDescription('Show DynamicConfig/event runtime status.'))
    .addSubcommand((sub) => sub.setName('list').setDescription('List scheduled, active, or recent ARK events.'))
    .addSubcommand((sub) => sub.setName('create').setDescription('Schedule an ARK event preset.')
      .addStringOption((o) => o.setName('preset').setDescription('Event preset').setRequired(true).addChoices(...presetChoices))
      .addStringOption((o) => o.setName('start_at').setDescription('ISO time including timezone, e.g. 2026-09-04T18:00-05:00').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('end_at').setDescription('ISO end time including timezone').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('name').setDescription('Optional event display name').setMaxLength(160))
      .addStringOption((o) => o.setName('description').setDescription('Optional player-facing description').setMaxLength(1000))
      .addStringOption((o) => o.setName('maps').setDescription('Comma-separated env prefixes, default ARK_GEN1').setMaxLength(300))
      .addStringOption((o) => o.setName('recurrence').setDescription('Optional recurrence').addChoices(
        { name: 'None', value: 'none' }, { name: 'Daily', value: 'daily' }, { name: 'Weekly', value: 'weekly' }
      )))
    .addSubcommand((sub) => sub.setName('cancel').setDescription('Cancel a scheduled ARK event.')
      .addStringOption((o) => o.setName('id').setDescription('ARK event ID').setRequired(true).setMaxLength(80)))
    .addSubcommand((sub) => sub.setName('refresh').setDescription('Render the current DynamicConfig and request a live refresh.'));
}

async function upsertGuildCommand(guild, builder) {
  const definition = builder.toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
}

function clean(value, max = 700) {
  return String(value ?? '').replace(/`/g, '\\`').slice(0, max);
}

function renderEvent(event) {
  const start = Math.floor(Date.parse(event.startAt) / 1000);
  const end = Math.floor(Date.parse(event.endAt) / 1000);
  return [
    `**${event.id} — ${event.name}**`,
    `Status: **${String(event.status || 'scheduled').toUpperCase()}**`,
    `Preset: \`${event.preset}\``,
    `Maps: ${(event.maps || []).map((map) => `\`${map}\``).join(', ') || '`ARK_GEN1`'}`,
    `Starts: <t:${start}:F> (<t:${start}:R>)`,
    `Ends: <t:${end}:F>`,
    `Recurrence: ${event.recurrence || 'none'}`,
    event.experimental ? '⚠️ Contains an experimental DynamicConfig key and will remain fail-closed unless explicitly enabled.' : null,
    event.notificationOnly ? 'ℹ️ Notification-only preset; its dedicated mod/plugin adapter owns the actual event configuration.' : null
  ].filter(Boolean).join('\n');
}

async function apiUtilsStatus(prefix = 'ARK_GEN1') {
  try {
    const result = await inspectArkApiLog(prefix);
    const modIds = Array.isArray(result?.newest?.modIds) ? result.newest.modIds.map(String) : [];
    return { detected: modIds.includes('955333'), modIds, source: result?.newest?.name || result?.path || '' };
  } catch (error) {
    return { detected: false, error: String(error?.message || error).slice(0, 240), modIds: [] };
  }
}

async function handle(interaction, context) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'arkevent') return false;
  if (!isStaff(interaction, context.config)) throw new Error('ARK event controls require Nexus staff authorization.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    const [apiUtils, tick] = await Promise.all([apiUtilsStatus('ARK_GEN1'), context.engine.tick()]);
    const rendered = tick?.renders?.find((item) => String(item.file || '').endsWith('ark_gen1.ini')) || tick?.renders?.[0];
    const publicUrl = String(process.env.NEXUS_ARK_DYNAMIC_CONFIG_PUBLIC_URL || '').trim();
    await interaction.editReply({ content: [
      '⚙️ **ARK DynamicConfig / Event Runtime**',
      `API Utils (955333): ${apiUtils.detected ? '🟢 Detected in latest server startup log' : '🟡 Not detected yet'}`,
      `Experimental keys: ${String(process.env.NEXUS_ARK_DYNAMIC_ALLOW_EXPERIMENTAL || 'false').toLowerCase() === 'true' ? 'Enabled' : 'Fail-closed'}`,
      `ForceUpdateDynamicConfig after changes: ${String(process.env.NEXUS_ARK_DYNAMIC_FORCE_RCON_REFRESH || 'true').toLowerCase() !== 'false' ? 'Enabled' : 'Disabled'}`,
      `Rendered file: \`${clean(rendered?.file || outputPath('ARK_GEN1'))}\``,
      `Public URL: ${publicUrl ? `\`${clean(publicUrl)}\`` : '⚠️ Not configured'}`,
      `Active events: **${rendered?.activeEvents?.length || 0}**`,
      rendered?.rejected?.length ? `Blocked keys: \`${clean(rendered.rejected.join(', '))}\`` : 'Blocked keys: none',
      !publicUrl ? 'DynamicConfig will not be considered production-ready until the ARK server has an HTTP-accessible CustomDynamicConfigUrl and `-UseDynamicConfig` configured.' : null
    ].filter(Boolean).join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'list') {
    const events = context.engine.list().slice(0, 12);
    await interaction.editReply({ content: events.length ? events.map(renderEvent).join('\n\n').slice(0, 1900) : 'No ARK DynamicConfig events are scheduled.', allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'create') {
    const maps = String(interaction.options.getString('maps') || 'ARK_GEN1').split(',').map((item) => item.trim()).filter(Boolean);
    const event = context.engine.create({
      preset: interaction.options.getString('preset', true),
      startAt: interaction.options.getString('start_at', true),
      endAt: interaction.options.getString('end_at', true),
      name: interaction.options.getString('name') || '',
      description: interaction.options.getString('description') || '',
      maps,
      recurrence: interaction.options.getString('recurrence') || 'none'
    }, interaction.user.id);
    await context.engine.tick();
    await interaction.editReply({ content: `✅ Scheduled ARK event.\n\n${renderEvent(event)}`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'cancel') {
    const id = String(interaction.options.getString('id', true)).trim().toUpperCase();
    const event = context.engine.cancel(id, interaction.user.id);
    if (!event) throw new Error(`${id} does not exist.`);
    await context.engine.tick();
    await interaction.editReply({ content: `✅ Cancelled **${event.id} — ${event.name}**. Baseline/remaining event layers were re-rendered.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'refresh') {
    const result = await context.engine.tick();
    const lines = result.renders.map((rendered) => `• ${rendered.file}: active=${rendered.activeEvents.length} blocked=${rendered.rejected.length} refresh=${rendered.refresh?.ok ? 'ok' : rendered.refresh?.skipped || rendered.refresh?.error || 'not-requested'}`);
    await interaction.editReply({ content: ['✅ DynamicConfig rendered and refresh reconciliation completed.', ...lines].join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  return false;
}

function installArkDynamicEventsExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkDynamicEventsLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      const engine = new ArkDynamicEventEngine({ client });
      client.on(Events.InteractionCreate, (interaction) => {
        if (String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void handle(interaction, { config, engine }).catch(async (error) => {
          const payload = { content: `⚠️ ${String(error?.message || error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
      client.once(Events.ClientReady, () => {
        void (async () => {
          const guildId = String(config.discord?.guildId || process.env.NEXUS_DISCORD_GUILD_ID || '').trim();
          if (!guildId) throw new Error('Discord guild ID is not configured.');
          const guild = await client.guilds.fetch(guildId);
          await upsertGuildCommand(guild, command());
          engine.start();
          console.log('[Nexus Sentinal] ARK DynamicConfig event engine started.');
        })().catch((error) => console.warn(`[Nexus Sentinal] ARK DynamicConfig event engine unavailable: ${String(error?.message || error).slice(0, 300)}`));
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = { command, apiUtilsStatus, renderEvent, handle, installArkDynamicEventsExtension };