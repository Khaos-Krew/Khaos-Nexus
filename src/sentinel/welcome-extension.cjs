'use strict';

const { ChannelType, Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { findInformationCategory } = require('./nexus-status.cjs');
const { paragraphs, spacedItems } = require('./embed-layout.cjs');

const INSTALLED = Symbol.for('khaos.nexus.welcome.extension');
const BOUND = Symbol.for('khaos.nexus.welcome.bound');
const SHADOW_RECRUIT_RANK_ID = 'shadow-recruit';
const SHADOW_RECRUIT_ROLE_NAME = 'Shadow Recruit';
const BASELINE_STARTUP_DELAY_MS = 20_000;
const BASELINE_REFRESH_MS = 15 * 60_000;

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function normalizeChannelName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeRoleName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isTextChannel(channel) {
  return Boolean(channel?.isTextBased?.()) && channel.type !== ChannelType.GuildCategory;
}

function channelByName(channels, names = [], parentId = '') {
  const expected = new Set(names.map(normalizeChannelName));
  const matches = valuesOf(channels).filter((channel) => isTextChannel(channel) && expected.has(normalizeChannelName(channel.name)));
  if (parentId) return matches.find((channel) => String(channel.parentId || '') === String(parentId)) || matches[0] || null;
  return matches[0] || null;
}

async function configuredTextChannel(guild, channelId = '') {
  const id = String(channelId || '').trim();
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  return isTextChannel(channel) ? channel : null;
}

async function ensureWelcomeChannel(guild, config = {}) {
  const configured = await configuredTextChannel(guild, config?.discord?.welcomeChannelId);
  const channels = await guild.channels.fetch();
  const information = findInformationCategory(channels);

  if (configured) {
    if (information && String(configured.parentId || '') !== String(information.id) && typeof configured.setParent === 'function') {
      await configured.setParent(information.id, { lockPermissions: false, reason: 'Keep Welcome under the INFORMATION category' });
      return { channel: configured, category: information, created: false, moved: true };
    }
    return { channel: configured, category: information || configured.parent || null, created: false, moved: false };
  }

  if (!information) return { channel: null, category: null, created: false, moved: false };
  let channel = channelByName(channels, ['welcome'], information.id);
  if (channel) {
    if (String(channel.parentId || '') !== String(information.id) && typeof channel.setParent === 'function') {
      await channel.setParent(information.id, { lockPermissions: false, reason: 'Keep Welcome under the INFORMATION category' });
      return { channel, category: information, created: false, moved: true };
    }
    return { channel, category: information, created: false, moved: false };
  }

  if (typeof guild.channels.create !== 'function') return { channel: null, category: information, created: false, moved: false };
  channel = await guild.channels.create({
    name: 'welcome',
    type: ChannelType.GuildText,
    parent: information.id,
    topic: 'Welcome messages and onboarding directions for new Khaos Nexus members.',
    reason: 'Nexus Sentinal managed welcome channel'
  });
  return { channel, category: information, created: true, moved: false };
}

async function onboardingChannels(guild, config = {}) {
  const channels = await guild.channels.fetch();
  const rules = await configuredTextChannel(guild, config?.discord?.rulesChannelId)
    || channelByName(channels, ['rules', 'community-rules']);
  const roles = await configuredTextChannel(guild, config?.discord?.rolesChannelId)
    || channelByName(channels, ['roles', 'self-roles', 'role-select', 'role-selection']);
  const gameServers = channelByName(channels, ['game-servers', 'gameservers', 'server-status', 'servers']);
  return { rules, roles, gameServers };
}

function channelMention(channel, fallback) {
  return channel?.id ? `<#${channel.id}>` : fallback;
}

function welcomePayload(member, channels = {}) {
  const memberId = String(member?.id || member?.user?.id || '');
  const mention = memberId ? `<@${memberId}>` : 'New member';
  const rules = channelMention(channels.rules, '#rules');
  const roles = channelMention(channels.roles, '#roles');
  const gameServers = channelMention(channels.gameServers, '#game-servers');
  return {
    content: mention,
    embeds: [{
      title: 'WELCOME TO KHAOS NEXUS',
      description: paragraphs(
        `Welcome ${mention}! You are now part of the Nexus.`,
        '🛡️ **Khaos Nexus is a safe-space community.** Treat people with respect, use the private reporting tools when something needs staff attention, and have fun.'
      ),
      fields: [
        {
          name: '🧭 Start Here',
          value: spacedItems([
            `**1. Read the community rules**\n${rules}`,
            `**2. Pick your roles**\nChoose game access, platform, pronoun, and name-color roles in ${roles}.`,
            `**3. Find community servers**\nCheck ${gameServers} for currently tracked game servers.`
          ]),
          inline: false
        },
        {
          name: '❓ Need Help?',
          value: paragraphs(
            'Ask the community or a staff member whenever you need a hand.',
            'Nexus Sentinal keeps your game access and community tools synchronized automatically.'
          ),
          inline: false
        }
      ],
      footer: { text: 'Nexus Sentinal • Automated Welcome' },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [], users: memberId ? [memberId] : [] }
  };
}

async function welcomeMember(member, config = {}, options = {}) {
  if (!member?.guild) return { skipped: 'missing-guild' };
  if (member.user?.bot) return { skipped: 'bot-member' };
  const logger = options.logger || console;
  const result = await ensureWelcomeChannel(member.guild, config);
  if (!result.channel) return { skipped: 'welcome-channel-unavailable' };
  const channels = await onboardingChannels(member.guild, config);
  const message = await result.channel.send(welcomePayload(member, channels));
  logger.log?.(`[Nexus Sentinal] welcomed member ${member.id} in #${result.channel.name}`);
  return {
    message,
    channelId: String(result.channel.id || ''),
    channelCreated: result.created,
    channelMoved: result.moved
  };
}

function roleCollectionHas(collection, roleId) {
  const id = String(roleId || '');
  if (!id || !collection) return false;
  if (typeof collection.has === 'function') return collection.has(id);
  return valuesOf(collection).some((role) => String(role?.id || role) === id);
}

async function resolveShadowRecruitRole(guild, config = {}) {
  if (!guild?.roles) return null;
  const configuredId = String(config?.discord?.rankRoles?.[SHADOW_RECRUIT_RANK_ID] || '').trim();
  let roles = guild.roles.cache;
  if ((!roles || !valuesOf(roles).length) && typeof guild.roles.fetch === 'function') {
    roles = await guild.roles.fetch().catch(() => roles);
  }

  if (configuredId) {
    const configured = roles?.get?.(configuredId)
      || valuesOf(roles).find((role) => String(role?.id || '') === configuredId)
      || (typeof guild.roles.fetch === 'function' ? await guild.roles.fetch(configuredId).catch(() => null) : null);
    if (configured) return configured;
  }

  const expected = normalizeRoleName(SHADOW_RECRUIT_ROLE_NAME);
  return valuesOf(roles).find((role) => normalizeRoleName(role?.name) === expected) || null;
}

async function ensureShadowRecruitRole(member, config = {}, options = {}) {
  if (!member?.guild) return { changed: false, skipped: 'missing-guild' };
  if (member.user?.bot) return { changed: false, skipped: 'bot-member' };
  const role = options.role || await resolveShadowRecruitRole(member.guild, config);
  if (!role) return { changed: false, skipped: 'shadow-recruit-role-missing' };
  if (role.editable === false) return { changed: false, skipped: 'shadow-recruit-role-uneditable', roleId: String(role.id || '') };
  if (roleCollectionHas(member.roles?.cache, role.id)) {
    return { changed: false, already: true, roleId: String(role.id || '') };
  }
  if (typeof member.roles?.add !== 'function') return { changed: false, skipped: 'member-role-manager-unavailable', roleId: String(role.id || '') };
  await member.roles.add(role, 'Nexus Sentinal baseline community rank');
  return { changed: true, already: false, roleId: String(role.id || '') };
}

async function reconcileShadowRecruitBaseline(guild, config = {}, options = {}) {
  const logger = options.logger || console;
  const role = await resolveShadowRecruitRole(guild, config);
  if (!role) return { ok: false, skipped: 'shadow-recruit-role-missing', roleId: '', scanned: 0, added: 0, already: 0, botsSkipped: 0, failed: 0 };
  if (role.editable === false) return { ok: false, skipped: 'shadow-recruit-role-uneditable', roleId: String(role.id || ''), scanned: 0, added: 0, already: 0, botsSkipped: 0, failed: 0 };

  let members = guild?.members?.cache;
  if (typeof guild?.members?.fetch === 'function') {
    members = await guild.members.fetch().catch((error) => {
      logger.warn?.(`[Nexus Sentinal] Shadow Recruit member fetch failed: ${String(error?.message || error).slice(0, 240)}`);
      return members;
    });
  }

  const summary = { ok: true, skipped: '', roleId: String(role.id || ''), scanned: 0, added: 0, already: 0, botsSkipped: 0, failed: 0 };
  for (const member of valuesOf(members)) {
    if (!member) continue;
    if (member.user?.bot) {
      summary.botsSkipped += 1;
      continue;
    }
    summary.scanned += 1;
    try {
      const result = await ensureShadowRecruitRole(member, config, { role });
      if (result.changed) summary.added += 1;
      else if (result.already) summary.already += 1;
      else if (result.skipped) summary.failed += 1;
    } catch (error) {
      summary.failed += 1;
      logger.warn?.(`[Nexus Sentinal] Shadow Recruit assignment failed for ${member.id || 'unknown'}: ${String(error?.message || error).slice(0, 240)}`);
    }
  }
  return summary;
}

function installWelcomeExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusWelcomeLogin(...args) {
    if (!this[BOUND]) {
      this[BOUND] = true;
      this.on(Events.GuildMemberAdd, (member) => {
        const guildId = String(config?.discord?.guildId || '');
        if (guildId && String(member?.guild?.id || '') !== guildId) return;
        void ensureShadowRecruitRole(member, config).then((result) => {
          if (result.changed) console.log(`[Nexus Sentinal] Shadow Recruit baseline (join): member=${member.id} role=${result.roleId} added=true`);
          else if (result.skipped && !['bot-member'].includes(result.skipped)) console.warn(`[Nexus Sentinal] Shadow Recruit baseline (join) skipped for ${member?.id || 'unknown'}: ${result.skipped}`);
        }).catch((error) => {
          console.warn(`[Nexus Sentinal] Shadow Recruit baseline (join) failed for ${member?.id || 'unknown'}: ${String(error?.message || error).slice(0, 240)}`);
        });
        void welcomeMember(member, config).catch((error) => {
          console.warn(`[Nexus Sentinal] welcome automation failed for ${member?.id || 'unknown'}: ${String(error?.message || error).slice(0, 240)}`);
        });
      });

      this.once(Events.ClientReady, () => {
        let running = false;
        const runBaseline = async (reason) => {
          if (running) return;
          running = true;
          try {
            const guildId = String(config?.discord?.guildId || '').trim();
            if (!guildId) return;
            const guild = await this.guilds.fetch(guildId);
            const result = await reconcileShadowRecruitBaseline(guild, config);
            if (!result.ok) {
              console.warn(`[Nexus Sentinal] Shadow Recruit baseline (${reason}) skipped: ${result.skipped}`);
              return;
            }
            console.log(`[Nexus Sentinal] Shadow Recruit baseline (${reason}): role=${result.roleId} scanned=${result.scanned} added=${result.added} already=${result.already} bots=${result.botsSkipped} failed=${result.failed}`);
          } catch (error) {
            console.warn(`[Nexus Sentinal] Shadow Recruit baseline (${reason}) unavailable: ${String(error?.message || error).slice(0, 300)}`);
          } finally {
            running = false;
          }
        };
        const initial = setTimeout(() => void runBaseline('startup'), BASELINE_STARTUP_DELAY_MS);
        initial.unref?.();
        const periodic = setInterval(() => void runBaseline('periodic'), BASELINE_REFRESH_MS);
        periodic.unref?.();
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  SHADOW_RECRUIT_RANK_ID,
  SHADOW_RECRUIT_ROLE_NAME,
  BASELINE_STARTUP_DELAY_MS,
  BASELINE_REFRESH_MS,
  normalizeChannelName,
  normalizeRoleName,
  channelByName,
  configuredTextChannel,
  ensureWelcomeChannel,
  onboardingChannels,
  welcomePayload,
  welcomeMember,
  roleCollectionHas,
  resolveShadowRecruitRole,
  ensureShadowRecruitRole,
  reconcileShadowRecruitBaseline,
  installWelcomeExtension
};
