'use strict';

const crypto = require('node:crypto');
const {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits
} = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { normalizedCategoryName } = require('./category-order.cjs');
const {
  configuredOwnerIds,
  isStaff,
  resolveStaffRoleIds,
  staffOnlyOverwrites
} = require('./safety-report-access.cjs');
const { ShieldStore } = require('./shield-store.cjs');
const {
  SECURITY_MODES,
  accountAgeMs,
  assessRisk,
  membershipAgeMs,
  messageSignals,
  recentJoinCounts,
  securityModeForJoinCounts
} = require('./shield-policy.cjs');

const INSTALLED = Symbol.for('khaos.nexus.shield.extension');
const ALERT_CHANNEL = 'shield-alerts';
const QUARANTINE_ROLE = 'Nexus Quarantine';
const AUTOMOD_WINDOW_MS = 10 * 60_000;
const DEFAULT_CONTAINMENT_MS = 60 * 60_000;

function clampContainmentMs(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return DEFAULT_CONTAINMENT_MS;
  return Math.max(10, Math.min(24 * 60, Math.floor(minutes))) * 60_000;
}

function blockedDomains(config = {}) {
  const values = config.discord?.shieldBlockedDomains;
  return Array.isArray(values) ? values.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 500) : [];
}

function privateCategory(channels) {
  const categories = [...channels.values()].filter((channel) => channel?.type === ChannelType.GuildCategory);
  const wanted = [
    ['staff', 'staff operations'],
    ['khaos nexus', 'nexus private', 'khaos nexus private', 'nexus operations'],
    ['private reports', 'safety reports']
  ];
  for (const aliases of wanted) {
    const category = categories.find((item) => aliases.includes(normalizedCategoryName(item.name)));
    if (category) return category;
  }
  return null;
}

async function ensureQuarantineRole(guild) {
  const roles = await guild.roles.fetch();
  let role = [...roles.values()].find((item) => item && !item.managed && ['nexus quarantine', 'quarantined', 'quarantine'].includes(normalizedCategoryName(item.name))) || null;
  if (!role) {
    role = await guild.roles.create({
      name: QUARANTINE_ROLE,
      permissions: [],
      hoist: false,
      mentionable: false,
      reason: 'Nexus Sentinal Shield containment marker'
    });
  } else if (role.editable && role.permissions?.bitfield !== 0n) {
    await role.setPermissions([], 'Nexus Sentinal Shield quarantine role carries no privileges').catch(() => {});
  }
  return role;
}

async function ensureAlertChannel(guild, client, config) {
  const channels = await guild.channels.fetch();
  const category = privateCategory(channels);
  if (!category) return null;
  let channel = [...channels.values()].find((item) => item?.type === ChannelType.GuildText && String(item.name || '').toLowerCase() === ALERT_CHANNEL) || null;
  const staffRoleIds = await resolveStaffRoleIds(guild, config);
  const ownerIds = [...new Set([...configuredOwnerIds(config), String(guild.ownerId || '')].filter(Boolean))];
  const overwrites = staffOnlyOverwrites(guild, client.user.id, staffRoleIds, ownerIds);
  if (!channel) {
    channel = await guild.channels.create({
      name: ALERT_CHANNEL,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Restricted Nexus Sentinal Shield security cases, containment alerts, and raid-state changes.',
      permissionOverwrites: overwrites,
      reason: 'Nexus Sentinal Shield restricted staff alerts'
    });
  } else {
    if (String(channel.parentId || '') !== String(category.id)) {
      await channel.setParent(category.id, { lockPermissions: false, reason: 'Nexus Sentinal Shield move alerts into private staff area' }).catch(() => {});
    }
    await channel.permissionOverwrites.set(overwrites, 'Nexus Sentinal Shield current staff authority').catch(() => {});
  }
  return { channel, category, staffRoleIds, ownerIds };
}

async function ensureInfrastructure(guild, client, config, store) {
  const [role, alerts] = await Promise.all([
    ensureQuarantineRole(guild).catch(() => null),
    ensureAlertChannel(guild, client, config).catch(() => null)
  ]);
  const value = {
    quarantineRoleId: String(role?.id || ''),
    alertChannelId: String(alerts?.channel?.id || ''),
    privateCategoryId: String(alerts?.category?.id || ''),
    staffRoleIds: alerts?.staffRoleIds || [],
    ownerIds: alerts?.ownerIds || []
  };
  store.setInfrastructure(value);
  return { role, alerts: alerts?.channel || null, ...value };
}

function accountContext(member, store, now = Date.now()) {
  const stored = store.getMember(member?.id) || {};
  return {
    accountAgeMs: accountAgeMs(member?.user?.createdTimestamp || stored.createdTimestamp, now),
    membershipAgeMs: membershipAgeMs(member?.joinedTimestamp || stored.joinedTimestamp, now),
    automodActions: store.recentSignalCount(member?.id, 'automod', AUTOMOD_WINDOW_MS, now),
    securityMode: store.getMode().level || SECURITY_MODES.NORMAL
  };
}

function evidenceForExecution(execution = {}) {
  return {
    source: 'discord-automod',
    ruleId: String(execution.ruleId || ''),
    triggerType: String(execution.ruleTriggerType ?? ''),
    actionType: String(execution.action?.type ?? ''),
    channelId: String(execution.channelId || ''),
    messageId: String(execution.messageId || ''),
    alertSystemMessageId: String(execution.alertSystemMessageId || '')
  };
}

function riskSummary(caseRecord, risk, actionText = '') {
  const reasons = (risk.reasons || []).slice(0, 8).map((item) => `\`${item}\``).join(' • ') || 'behavioral review';
  const action = actionText ? `\n**Action:** ${actionText}` : '';
  return `🛡️ **Sentinal Shield • ${caseRecord.caseId}**\nAccount: <@${caseRecord.userId}> (\`${caseRecord.userId}\`)\nRisk: **${risk.state}** • score **${risk.score}/100**\nSignals: ${reasons}${action}\nStaff: do not engage suspicious links/files. Review the evidence before escalating.`;
}

async function sendAlert(channel, content) {
  if (!channel?.isTextBased?.()) return null;
  return channel.send({ content: String(content || '').slice(0, 1950), allowedMentions: { parse: [] } }).catch(() => null);
}

async function memberById(guild, userId) {
  try { return await guild.members.fetch(String(userId)); } catch { return null; }
}

async function containMember(member, infrastructure, config, store, caseRecord) {
  if (!member) return { contained: false, detail: 'member-unavailable' };
  if (await isStaff(member.guild, member.id, config)) {
    store.addCaseAction(caseRecord.caseId, 'containment-skipped', 'sentinal', 'Current staff/owner account; automatic containment is fail-safe disabled.');
    return { contained: false, detail: 'staff-account-review-required' };
  }

  const actions = [];
  const timeoutMs = clampContainmentMs(config.discord?.shieldContainmentMinutes);
  if (member.moderatable && typeof member.timeout === 'function') {
    const currentUntil = Number(member.communicationDisabledUntilTimestamp || 0);
    if (currentUntil < Date.now() + 5 * 60_000) {
      await member.timeout(timeoutMs, `Nexus Sentinal Shield ${caseRecord.caseId}: high-confidence malicious/spam behavior`).then(() => actions.push(`communication timeout ${Math.round(timeoutMs / 60_000)}m`)).catch(() => {});
    } else {
      actions.push('existing timeout retained');
    }
  }

  const roleId = String(infrastructure?.quarantineRoleId || '');
  if (roleId && member.manageable && !member.roles?.cache?.has?.(roleId)) {
    await member.roles.add(roleId, `Nexus Sentinal Shield ${caseRecord.caseId} containment marker`).then(() => actions.push('quarantine marker applied')).catch(() => {});
  }

  const detail = actions.length ? actions.join(' • ') : 'containment unavailable; staff action required';
  store.addCaseAction(caseRecord.caseId, actions.length ? 'automatic-containment' : 'containment-failed', 'sentinal', detail);
  return { contained: actions.length > 0, detail };
}

async function handleRisk({ guild, member, risk, evidence, infrastructure, config, store, sourceMessage = null }) {
  if (!risk || !['review', 'contain'].includes(risk.action)) return null;
  const result = store.upsertCase(member.id, risk, evidence);
  let actionText = risk.action === 'review' ? 'Staff review requested; no automatic punishment.' : 'Automatic containment requested.';

  if (risk.action === 'contain') {
    if (sourceMessage?.deletable) {
      await sourceMessage.delete().then(() => store.addCaseAction(result.record.caseId, 'message-removed', 'sentinal', `Message ${sourceMessage.id} removed before containment.`)).catch(() => {});
    }
    const containment = await containMember(member, infrastructure, config, store, result.record);
    actionText = containment.detail;
    if (sourceMessage?.channel?.isTextBased?.()) {
      await sourceMessage.channel.send({
        content: '🛡️ **Sentinal Shield removed potentially malicious or coordinated-spam content.** Do not follow links, download files, or contact the account about the removed message. Staff have been notified.',
        allowedMentions: { parse: [] }
      }).catch(() => {});
    }
  }

  const refreshed = store.openCaseForUser(member.id) || result.record;
  if (result.created || result.escalated || risk.action === 'contain') {
    await sendAlert(infrastructure.alerts, riskSummary(refreshed, risk, actionText));
  }
  return { ...result, record: refreshed, actionText };
}

function messageFingerprint(content) {
  const normalized = String(content || '').toLowerCase().replace(/https?:\/\/\S+/g, '<url>').replace(/\s+/g, ' ').trim();
  if (normalized.length < 8) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

async function handleMemberJoin(member, store, infrastructure) {
  const now = Date.now();
  store.recordJoin(member.id, { createdTimestamp: member.user?.createdTimestamp, joinedTimestamp: member.joinedTimestamp || now }, now);
  const counts = recentJoinCounts(store.recentJoinTimestamps(now), now);
  const nextMode = securityModeForJoinCounts(counts);
  const mode = store.setMode(nextMode, `${counts.last60Seconds} joins/60s; ${counts.last5Minutes} joins/5m`, now);
  store.addAudit('member-join', { userId: member.id, accountAgeMs: accountAgeMs(member.user?.createdTimestamp, now), mode: nextMode });
  if (mode.changed) {
    await sendAlert(infrastructure.alerts,
      `🛡️ **Sentinal Shield security mode: ${String(nextMode).toUpperCase()}**\nJoin rate: **${counts.last60Seconds}/60s** • **${counts.last5Minutes}/5m**\nNo account is punished for age or join timing alone; behavioral evidence is still required for containment.`);
  }
}

async function handleAutoModExecution(execution, guild, config, store, infrastructure) {
  const userId = String(execution.userId || execution.member?.id || '');
  if (!userId) return;
  store.recordSignal(userId, 'automod', evidenceForExecution(execution));
  const member = execution.member || await memberById(guild, userId);
  if (!member || member.user?.bot) return;
  const risk = assessRisk(accountContext(member, store));
  store.addAudit('automod-execution', { userId, score: risk.score, state: risk.state, ruleId: execution.ruleId || '' });
  await handleRisk({ guild, member, risk, evidence: evidenceForExecution(execution), infrastructure, config, store });
}

async function handleMessage(message, client, config, store, infrastructure) {
  if (!message?.guild || message.author?.bot || String(message.guild.id) !== String(config.discord?.guildId || '')) return;
  if (!client.options?.intents?.has?.(GatewayIntentBits.MessageContent)) return;
  const content = String(message.content || '');
  if (!content && !message.attachments?.size) return;
  const member = message.member || await memberById(message.guild, message.author.id);
  if (!member) return;

  const fp = messageFingerprint(content);
  const repeatedMessageCount = fp ? store.recordMessageFingerprint(member.id, fp) : 0;
  const attachments = [...(message.attachments?.values?.() || [])].map((item) => ({ name: item.name }));
  const mentionCount = Number(message.mentions?.users?.size || 0) + Number(message.mentions?.roles?.size || 0);
  const signals = messageSignals({
    content,
    attachments,
    mentionCount,
    blockedDomains: blockedDomains(config),
    repeatedMessageCount
  });
  const interesting = signals.confirmedMaliciousUrl || signals.scamPattern || signals.executableAttachment || signals.mentionCount >= 8 || signals.repeatedMessageCount >= 4;
  if (!interesting) return;

  if (signals.confirmedMaliciousUrl) store.recordSignal(member.id, 'blocked-domain', { messageId: message.id, channelId: message.channelId });
  if (signals.scamPattern) store.recordSignal(member.id, 'scam-pattern', { messageId: message.id, channelId: message.channelId });
  if (signals.executableAttachment) store.recordSignal(member.id, 'high-risk-attachment', { messageId: message.id, channelId: message.channelId });
  if (signals.mentionCount >= 8) store.recordSignal(member.id, 'mass-mentions', { messageId: message.id, count: signals.mentionCount });
  if (signals.repeatedMessageCount >= 4) store.recordSignal(member.id, 'repeated-message-spam', { messageId: message.id, count: signals.repeatedMessageCount });

  const risk = assessRisk({ ...accountContext(member, store), ...signals });
  const evidence = {
    source: 'message-metadata',
    messageId: String(message.id || ''),
    channelId: String(message.channelId || ''),
    mentionCount: signals.mentionCount,
    repeatedMessageCount: signals.repeatedMessageCount,
    scamPattern: signals.scamPattern,
    executableAttachment: signals.executableAttachment,
    blockedDomainMatch: signals.confirmedMaliciousUrl
  };
  store.addAudit('message-risk', { userId: member.id, score: risk.score, state: risk.state, messageId: message.id });
  await handleRisk({ guild: message.guild, member, risk, evidence, infrastructure, config, store, sourceMessage: message });
}

async function automodRuleCount(guild) {
  try {
    const rules = await guild.autoModerationRules?.fetch?.();
    return Number(rules?.size || 0);
  } catch { return -1; }
}

function installShieldExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const store = new ShieldStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusShieldLogin(...args) {
    let infrastructure = { role: null, alerts: null, quarantineRoleId: '', alertChannelId: '' };

    this.once(Events.ClientReady, async () => {
      if (!guildId) return;
      try {
        const guild = await this.guilds.fetch(guildId);
        infrastructure = await ensureInfrastructure(guild, this, config, store);
        const rules = await automodRuleCount(guild);
        store.addAudit('shield-startup', {
          guildId,
          mode: store.getMode().level,
          autoModRules: rules,
          messageContent: this.options?.intents?.has?.(GatewayIntentBits.MessageContent) ? 'enabled' : 'metadata-only'
        });
        console.log(`[Nexus Sentinal Shield] ready: mode=${store.getMode().level} quarantineRole=${infrastructure.quarantineRoleId || 'unavailable'} alerts=${infrastructure.alertChannelId || 'unavailable'} automodRules=${rules} messageContent=${this.options?.intents?.has?.(GatewayIntentBits.MessageContent) ? 'enabled' : 'metadata-only'}`);
      } catch (error) {
        console.error('[Nexus Sentinal Shield] startup:', error);
      }
    });

    this.on(Events.GuildMemberAdd, async (member) => {
      if (String(member.guild?.id || '') !== guildId || member.user?.bot) return;
      try { await handleMemberJoin(member, store, infrastructure); }
      catch (error) { console.error('[Nexus Sentinal Shield] member join:', error); }
    });

    const autoModEvent = Events.AutoModerationActionExecution || 'autoModerationActionExecution';
    this.on(autoModEvent, async (execution) => {
      const guild = execution.guild || (String(execution.guildId || '') === guildId ? await this.guilds.fetch(guildId).catch(() => null) : null);
      if (!guild || String(guild.id) !== guildId) return;
      try { await handleAutoModExecution(execution, guild, config, store, infrastructure); }
      catch (error) { console.error('[Nexus Sentinal Shield] automod:', error); }
    });

    this.on(Events.MessageCreate, async (message) => {
      try { await handleMessage(message, this, config, store, infrastructure); }
      catch (error) { console.error('[Nexus Sentinal Shield] message analysis:', error); }
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  ALERT_CHANNEL,
  QUARANTINE_ROLE,
  AUTOMOD_WINDOW_MS,
  DEFAULT_CONTAINMENT_MS,
  clampContainmentMs,
  blockedDomains,
  privateCategory,
  ensureQuarantineRole,
  ensureAlertChannel,
  ensureInfrastructure,
  accountContext,
  evidenceForExecution,
  riskSummary,
  containMember,
  handleRisk,
  messageFingerprint,
  handleMemberJoin,
  handleAutoModExecution,
  handleMessage,
  automodRuleCount,
  installShieldExtension
};
