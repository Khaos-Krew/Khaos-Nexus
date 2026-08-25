'use strict';

const {
  Client,
  Events,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { isStaff } = require('./safety-report-access.cjs');
const { ShieldStore } = require('./shield-store.cjs');
const {
  caseListPayload,
  casePayload,
  confirmationButtons,
  normalizeCaseId,
  parseActionId,
  parseConfirmId
} = require('./shield-review.cjs');

const INSTALLED = Symbol.for('khaos.nexus.shield.review.extension');
const STAFF_QUARANTINE_MS = 60 * 60_000;
const STAFF_TIMEOUT_MS = 24 * 60 * 60_000;
const TIMEOUT_MATCH_TOLERANCE_MS = 2 * 60_000;

function shieldCommand() {
  return new SlashCommandBuilder()
    .setName('shield')
    .setDescription('Review Nexus Sentinal Shield security state and cases')
    .addSubcommand((sub) => sub.setName('status').setDescription('Show current Shield security mode and open-case count'))
    .addSubcommand((sub) => sub.setName('cases').setDescription('List open Shield security cases'))
    .addSubcommand((sub) => sub
      .setName('case')
      .setDescription('Open one Shield security case for staff review')
      .addStringOption((opt) => opt.setName('case_id').setDescription('Security case ID, for example SEC-0001').setRequired(true)));
}

async function registerShieldCommand(guild) {
  const definition = shieldCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition);
  else await guild.commands.create(definition);
  return definition.name;
}

async function memberById(guild, userId) {
  try { return await guild.members.fetch(String(userId || '')); } catch { return null; }
}

async function targetIsProtected(guild, userId, config) {
  if (String(guild.ownerId || '') === String(userId || '')) return true;
  return isStaff(guild, userId, config);
}

function timeoutUntil(ms, now = Date.now()) {
  return new Date(now + ms).toISOString();
}

function memberTimeoutMatchesShield(member, record, now = Date.now()) {
  const expected = Date.parse(String(record?.controls?.shieldTimeoutUntil || ''));
  const actual = Number(member?.communicationDisabledUntilTimestamp || 0);
  if (!Number.isFinite(expected) || expected <= now || !actual) return false;
  return Math.abs(actual - expected) <= TIMEOUT_MATCH_TOLERANCE_MS;
}

async function applyQuarantine(member, infrastructure, store, record, actorId, durationMs = STAFF_QUARANTINE_MS) {
  const actions = [];
  const until = timeoutUntil(durationMs);
  if (member?.moderatable && typeof member.timeout === 'function') {
    await member.timeout(durationMs, `Nexus Sentinal Shield ${record.caseId}: staff quarantine`).then(() => actions.push(`timeout ${Math.round(durationMs / 60_000)}m`));
    store.setCaseControls(record.caseId, { shieldTimeoutUntil: until });
  }
  const roleId = String(infrastructure?.quarantineRoleId || '');
  if (roleId && member?.manageable && !member.roles?.cache?.has?.(roleId)) {
    await member.roles.add(roleId, `Nexus Sentinal Shield ${record.caseId}: staff quarantine marker`);
    actions.push('quarantine marker');
    store.setCaseControls(record.caseId, { quarantineRoleApplied: true });
  } else if (roleId && member?.roles?.cache?.has?.(roleId)) {
    actions.push('quarantine marker retained');
    store.setCaseControls(record.caseId, { quarantineRoleApplied: true });
  }
  if (!actions.length) throw new Error('Discord would not allow Sentinel to quarantine this account. Check role hierarchy and moderation permissions.');
  store.addCaseAction(record.caseId, 'staff-quarantine', actorId, actions.join(' • '));
  return actions.join(' • ');
}

async function applyStaffTimeout(member, store, record, actorId) {
  if (!member?.moderatable || typeof member.timeout !== 'function') {
    throw new Error('Discord would not allow Sentinel to timeout this account. Check role hierarchy and moderation permissions.');
  }
  const until = timeoutUntil(STAFF_TIMEOUT_MS);
  await member.timeout(STAFF_TIMEOUT_MS, `Nexus Sentinal Shield ${record.caseId}: staff 24h timeout`);
  store.setCaseControls(record.caseId, { shieldTimeoutUntil: until });
  store.addCaseAction(record.caseId, 'staff-timeout', actorId, '24h timeout applied');
  return '24h timeout applied';
}

async function markSafe(member, infrastructure, store, record, actorId) {
  const actions = [];
  const roleId = String(infrastructure?.quarantineRoleId || '');
  if (roleId && member?.manageable && member.roles?.cache?.has?.(roleId)) {
    await member.roles.remove(roleId, `Nexus Sentinal Shield ${record.caseId}: marked safe by staff`).catch(() => {});
    if (!member.roles?.cache?.has?.(roleId)) actions.push('quarantine marker removed');
  }
  if (memberTimeoutMatchesShield(member, record) && member?.moderatable && typeof member.timeout === 'function') {
    await member.timeout(null, `Nexus Sentinal Shield ${record.caseId}: Shield timeout released after staff safe review`).then(() => actions.push('Shield-owned timeout released')).catch(() => {});
  }
  store.setCaseControls(record.caseId, { quarantineRoleApplied: false, shieldTimeoutUntil: '', reportRecommended: false });
  store.addCaseAction(record.caseId, 'marked-safe', actorId, actions.join(' • ') || 'Case reviewed as safe; no active Shield containment was changed.');
  return store.closeCase(record.caseId, actorId, 'Marked safe after staff review.');
}

async function confirmedKick(member, store, record, actorId) {
  if (!member?.kickable) throw new Error('Discord would not allow Sentinel to kick this account. Check role hierarchy and bot permissions.');
  await member.kick(`Nexus Sentinal Shield ${record.caseId}: confirmed staff action`);
  store.addCaseAction(record.caseId, 'staff-kick', actorId, 'Confirmed kick executed.');
  return store.closeCase(record.caseId, actorId, 'Account kicked after confirmed staff security review.');
}

async function confirmedBan(guild, userId, store, record, actorId) {
  const member = await memberById(guild, userId);
  if (member && !member.bannable) throw new Error('Discord would not allow Sentinel to ban this account. Check role hierarchy and bot permissions.');
  await guild.members.ban(String(userId), { reason: `Nexus Sentinal Shield ${record.caseId}: confirmed staff action` });
  store.addCaseAction(record.caseId, 'staff-ban', actorId, 'Confirmed ban executed.');
  return store.closeCase(record.caseId, actorId, 'Account banned after confirmed staff security review.');
}

function auditAction(store, action, caseId, actorId, userId, detail = '') {
  return store.addAudit('staff-case-action', { action, caseId, actorId, userId, detail });
}

async function runCaseAction({ guild, action, record, actorId, config, store, infrastructure }) {
  if (!record || record.status !== 'open') throw new Error('This Shield case is already closed or unavailable.');
  const member = await memberById(guild, record.userId);
  const protectedTarget = await targetIsProtected(guild, record.userId, config);
  if (protectedTarget && ['quarantine', 'timeout', 'kick', 'ban'].includes(action)) {
    throw new Error('Automatic/security enforcement is blocked for current staff and owner accounts. Review this account manually.');
  }

  let updated = record;
  let notice = '';
  if (action === 'safe') {
    updated = await markSafe(member, infrastructure, store, record, actorId);
    notice = '✅ Account marked safe. Only containment tracked as Shield-owned was eligible for release.';
  } else if (action === 'quarantine') {
    if (!member) throw new Error('The account is no longer a member of this server.');
    notice = `✅ ${await applyQuarantine(member, infrastructure, store, record, actorId)}`;
    updated = store.getCase(record.caseId);
  } else if (action === 'timeout') {
    if (!member) throw new Error('The account is no longer a member of this server.');
    notice = `✅ ${await applyStaffTimeout(member, store, record, actorId)}`;
    updated = store.getCase(record.caseId);
  } else if (action === 'escalate') {
    store.setCaseControls(record.caseId, { reportRecommended: true, escalated: true });
    store.addCaseAction(record.caseId, 'discord-report-recommended', actorId, 'Staff escalated this case for Discord-native reporting. Sentinel did not submit a Trust & Safety report.');
    updated = store.getCase(record.caseId);
    notice = '⚠️ Marked **Discord report recommended**. Use Discord’s native reporting flow; Sentinel does not submit Trust & Safety reports on your behalf.';
  } else if (action === 'close') {
    store.addCaseAction(record.caseId, 'staff-close', actorId, 'Case closed without changing current Discord moderation state.');
    updated = store.closeCase(record.caseId, actorId, 'Closed by staff after review.');
    notice = '✅ Case closed. Existing Discord moderation state was left unchanged.';
  } else if (action === 'refresh') {
    updated = store.getCase(record.caseId);
    notice = 'Case refreshed from persistent Shield state.';
  } else {
    throw new Error(`Unsupported Shield action: ${action}`);
  }

  auditAction(store, action, record.caseId, actorId, record.userId, notice);
  return { updated, notice };
}

async function handleShieldCommand(interaction, config, store) {
  if (interaction.commandName !== 'shield') return false;
  if (!(await isStaff(interaction.guild, interaction.user.id, config))) {
    await interaction.reply({ content: 'Shield case review is restricted to current authorized staff.', flags: MessageFlags.Ephemeral });
    return true;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'status') {
    const cases = Object.values(store.listCases()).filter((item) => item.status === 'open');
    const infra = store.getInfrastructure() || {};
    const mode = store.getMode();
    await interaction.editReply({
      content: `🛡️ **Sentinal Shield Status**\nMode: **${String(mode.level || 'normal').toUpperCase()}**\nOpen cases: **${cases.length}**\nQuarantine role: ${infra.quarantineRoleId ? `<@&${infra.quarantineRoleId}>` : 'unavailable'}\nSecurity alerts: ${infra.alertChannelId ? `<#${infra.alertChannelId}>` : 'unavailable'}\n\nAccount age and join timing are context only; containment requires behavioral/high-confidence evidence.`,
      allowedMentions: { parse: [] }
    });
    return true;
  }
  if (subcommand === 'cases') {
    await interaction.editReply(caseListPayload(store.listCases()));
    return true;
  }
  if (subcommand === 'case') {
    const caseId = normalizeCaseId(interaction.options.getString('case_id'));
    if (!caseId) {
      await interaction.editReply({ content: 'Use a Shield case ID such as `SEC-0001`.' });
      return true;
    }
    await interaction.editReply(casePayload(store.getCase(caseId)));
    return true;
  }
  await interaction.editReply({ content: 'Unknown Shield command.' });
  return true;
}

async function handleCaseButton(interaction, config, store) {
  const parsed = parseActionId(interaction.customId);
  if (!parsed) return false;
  if (!(await isStaff(interaction.guild, interaction.user.id, config))) {
    await interaction.reply({ content: 'Shield case controls are restricted to current authorized staff.', flags: MessageFlags.Ephemeral });
    return true;
  }
  const record = store.getCase(parsed.caseId);
  if (!record) {
    await interaction.reply({ content: 'That Shield case no longer exists.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (['kick', 'ban'].includes(parsed.action)) {
    if (record.status !== 'open') {
      await interaction.reply({ content: 'That Shield case is already closed.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (await targetIsProtected(interaction.guild, record.userId, config)) {
      await interaction.reply({ content: 'Kick/ban controls are blocked for current staff and owner accounts.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply({
      content: `⚠️ **Confirm ${parsed.action.toUpperCase()}** for ${record.caseId} targeting <@${record.userId}>?\nThis is a destructive Discord moderation action and cannot be triggered by Shield risk scoring alone.`,
      components: confirmationButtons(record.caseId, parsed.action),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
    return true;
  }

  await interaction.deferUpdate();
  try {
    const result = await runCaseAction({
      guild: interaction.guild,
      action: parsed.action,
      record,
      actorId: String(interaction.user.id),
      config,
      store,
      infrastructure: store.getInfrastructure() || {}
    });
    await interaction.editReply(casePayload(result.updated, { notice: result.notice }));
  } catch (error) {
    await interaction.followUp({ content: `⚠️ ${String(error?.message || error).slice(0, 1500)}`, flags: MessageFlags.Ephemeral });
  }
  return true;
}

async function handleConfirmation(interaction, config, store) {
  const parsed = parseConfirmId(interaction.customId);
  if (!parsed) return false;
  if (!(await isStaff(interaction.guild, interaction.user.id, config))) {
    await interaction.reply({ content: 'Shield enforcement confirmation is restricted to current authorized staff.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (parsed.action === 'cancel') {
    await interaction.update({ content: `Cancelled destructive action for ${parsed.caseId}.`, components: [] });
    return true;
  }
  const record = store.getCase(parsed.caseId);
  if (!record || record.status !== 'open') {
    await interaction.update({ content: 'This Shield case is already closed or unavailable.', components: [] });
    return true;
  }
  if (await targetIsProtected(interaction.guild, record.userId, config)) {
    await interaction.update({ content: 'Action blocked: the target is currently an authorized staff/owner account.', components: [] });
    return true;
  }

  await interaction.deferUpdate();
  try {
    let updated;
    if (parsed.action === 'kick') {
      updated = await confirmedKick(await memberById(interaction.guild, record.userId), store, record, String(interaction.user.id));
    } else if (parsed.action === 'ban') {
      updated = await confirmedBan(interaction.guild, record.userId, store, record, String(interaction.user.id));
    }
    auditAction(store, parsed.action, record.caseId, String(interaction.user.id), record.userId, 'confirmed destructive action');
    await interaction.editReply({ content: `✅ ${parsed.action === 'ban' ? 'Ban' : 'Kick'} completed for ${record.caseId}.`, components: [] });
  } catch (error) {
    await interaction.editReply({ content: `⚠️ ${String(error?.message || error).slice(0, 1500)}`, components: [] });
  }
  return true;
}

function installShieldReviewExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const store = new ShieldStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusShieldReviewLogin(...args) {
    this.once(Events.ClientReady, async () => {
      if (!guildId) return;
      try {
        const guild = await this.guilds.fetch(guildId);
        await registerShieldCommand(guild);
        console.log(`[Nexus Sentinal Shield] staff review ready: /shield status|cases|case openCases=${Object.values(store.listCases()).filter((item) => item.status === 'open').length}`);
      } catch (error) {
        console.error('[Nexus Sentinal Shield] staff review startup:', error);
      }
    });

    this.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction?.guild || String(interaction.guild.id) !== guildId) return;
      try {
        if (interaction.isChatInputCommand?.() && interaction.commandName === 'shield') {
          await handleShieldCommand(interaction, config, store);
          return;
        }
        if (!interaction.isButton?.()) return;
        if (await handleCaseButton(interaction, config, store)) return;
        await handleConfirmation(interaction, config, store);
      } catch (error) {
        console.error('[Nexus Sentinal Shield] staff review interaction:', error);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Shield could not complete that review action.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  STAFF_QUARANTINE_MS,
  STAFF_TIMEOUT_MS,
  TIMEOUT_MATCH_TOLERANCE_MS,
  shieldCommand,
  registerShieldCommand,
  memberById,
  targetIsProtected,
  timeoutUntil,
  memberTimeoutMatchesShield,
  applyQuarantine,
  applyStaffTimeout,
  markSafe,
  confirmedKick,
  confirmedBan,
  auditAction,
  runCaseAction,
  handleShieldCommand,
  handleCaseButton,
  handleConfirmation,
  installShieldReviewExtension
};
