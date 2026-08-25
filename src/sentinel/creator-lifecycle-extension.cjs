'use strict';

const { Client, Events, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');

const INSTALLED = Symbol.for('khaos.nexus.creatorLifecycle.extension');

function normalizeIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter((value) => /^\d{15,24}$/.test(value)))];
}

function ownerIds(guild, config = {}) {
  return normalizeIds([guild?.ownerId, ...(config.discord?.ownerUserIds || [])]);
}

function isCreatorAdmin(interaction, config = {}) {
  const userId = String(interaction.user?.id || '');
  if (ownerIds(interaction.guild, config).includes(userId)) return true;
  const permissions = interaction.memberPermissions || interaction.member?.permissions;
  return Boolean(permissions?.has?.(PermissionFlagsBits.Administrator) || permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function commandDefinition() {
  return new SlashCommandBuilder()
    .setName('creator-admin')
    .setDescription('Manage the Khaos Nexus Content Creator Program.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub
      .setName('request-info')
      .setDescription('Ask a pending creator applicant for more information.')
      .addStringOption((option) => option.setName('application').setDescription('Creator application ID, for example CCR-0001').setRequired(true))
      .addStringOption((option) => option.setName('message').setDescription('Information requested from the applicant').setRequired(true).setMaxLength(1000)))
    .addSubcommand((sub) => sub
      .setName('revoke')
      .setDescription('Revoke an approved creator from the program.')
      .addUserOption((option) => option.setName('user').setDescription('Approved creator to revoke').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for revocation').setRequired(true).setMaxLength(1000)));
}

async function registerCommand(guild) {
  const definition = commandDefinition().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
  return definition.name;
}

function requestMoreInformation(store, applicationId, actorId, message, now = new Date().toISOString()) {
  const id = String(applicationId || '').trim().toUpperCase();
  const application = store.getCreatorApplication(id);
  if (!application) return { ok: false, reason: 'missing' };
  if (String(application.status || '') !== 'pending') return { ok: false, reason: 'not-pending', application };
  const text = String(message || '').trim().slice(0, 1000);
  if (!text) return { ok: false, reason: 'message-required', application };
  const next = {
    ...application,
    informationRequestedAt: now,
    informationRequestedBy: String(actorId || ''),
    informationRequest: text,
    reviewReason: `More information requested: ${text}`
  };
  store.setCreatorApplication(id, next);
  return { ok: true, application: next };
}

function revokeCreatorState(store, userId, actorId, reason, now = new Date().toISOString()) {
  const id = String(userId || '');
  const profile = store.getCreatorProfile(id);
  if (!profile) return { ok: false, reason: 'not-approved' };
  const text = String(reason || '').trim().slice(0, 1000);
  if (!text) return { ok: false, reason: 'reason-required', profile };

  store.removeCreatorProfile(id);
  const applicationId = String(profile.applicationId || '');
  let application = applicationId ? store.getCreatorApplication(applicationId) : null;
  if (application) {
    application = {
      ...application,
      status: 'denied',
      reviewedAt: now,
      reviewedBy: String(actorId || ''),
      reviewReason: `Creator status revoked: ${text}`,
      revokedAt: now,
      revokedBy: String(actorId || ''),
      revocationReason: text
    };
    store.setCreatorApplication(applicationId, application);
  }
  return { ok: true, profile, application, reasonText: text };
}

async function removeCreatorRoles(guild, store, userId) {
  const meta = store.getCreatorMeta();
  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return { memberFound: false, removed: [] };
  const removed = [];
  for (const roleId of [meta.creatorRoleId, meta.nowLiveRoleId].map(String).filter(Boolean)) {
    if (!member.roles?.cache?.has?.(roleId)) continue;
    await member.roles.remove(roleId, 'Khaos Nexus creator program revocation');
    removed.push(roleId);
  }
  return { memberFound: true, removed };
}

async function handleCommand(interaction, { store, config }) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'creator-admin') return false;
  if (!isCreatorAdmin(interaction, config)) {
    await interaction.reply({ content: 'Creator Program administration requires Manage Server or Nexus owner access.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === 'request-info') {
    const applicationId = interaction.options.getString('application', true);
    const message = interaction.options.getString('message', true);
    const result = requestMoreInformation(store, applicationId, interaction.user.id, message);
    if (!result.ok) {
      const text = result.reason === 'missing'
        ? 'That creator application could not be found.'
        : result.reason === 'not-pending'
          ? 'Only pending creator applications can request more information.'
          : 'A request message is required.';
      await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
      return true;
    }

    const applicant = await interaction.client.users.fetch(String(result.application.userId)).catch(() => null);
    let delivered = false;
    if (applicant?.send) {
      delivered = Boolean(await applicant.send({
        content: `🎥 **Khaos Nexus Content Creator Program**\n\nStaff needs a little more information for **${result.application.id}** before a decision can be made:\n\n${result.application.informationRequest}\n\nYour application remains open while you respond to staff.`,
        allowedMentions: { parse: [] }
      }).then(() => true).catch(() => false));
    }
    await interaction.reply({
      content: `✅ ${result.application.id} remains pending and the information request was recorded.${delivered ? ' The applicant was also sent a DM.' : ' Discord could not deliver a DM, so staff should contact the applicant manually.'}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
    return true;
  }

  if (sub === 'revoke') {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason', true);
    const result = revokeCreatorState(store, user.id, interaction.user.id, reason);
    if (!result.ok) {
      await interaction.reply({ content: result.reason === 'not-approved' ? 'That member does not have an approved creator profile.' : 'A revocation reason is required.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const roleResult = await removeCreatorRoles(interaction.guild, store, user.id);
    await interaction.reply({
      content: `✅ Creator access revoked for **${user.username}**. Removed program roles: **${roleResult.removed.length}**. Reason recorded: ${result.reasonText}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
    return true;
  }

  return false;
}

function installCreatorLifecycleExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const store = new StateStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusCreatorLifecycleLogin(...args) {
    this.on(Events.InteractionCreate, (interaction) => {
      void handleCommand(interaction, { store, config }).catch(async (error) => {
        console.warn(`[Nexus Sentinal] creator lifecycle action failed: ${String(error?.message || error).slice(0, 240)}`);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'The creator administration action could not be completed.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      });
    });
    this.once(Events.ClientReady, async () => {
      try {
        const guildId = String(config.discord?.guildId || '');
        if (!guildId) return;
        const guild = await this.guilds.fetch(guildId);
        const command = await registerCommand(guild);
        console.log(`[Nexus Sentinal] creator lifecycle command registered: /${command}`);
      } catch (error) {
        console.warn(`[Nexus Sentinal] creator lifecycle registration failed: ${String(error?.message || error).slice(0, 240)}`);
      }
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  commandDefinition,
  isCreatorAdmin,
  requestMoreInformation,
  revokeCreatorState,
  removeCreatorRoles,
  handleCommand,
  installCreatorLifecycleExtension
};
