'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { envSecret } = require('../shared/config.cjs');
const { MODULES, getModule } = require('../backend/modules/catalog.cjs');
const { NEXUS_RANKS, highestRankForEntitlements, rankRoleIds } = require('../shared/ranks.cjs');
const { inspectModuleLayout } = require('./module-inspector.cjs');

const REQUIRED_PERMISSIONS = Object.freeze([
  ['administrator', 'Administrator', PermissionFlagsBits.Administrator],
  ['manageRoles', 'Manage Roles', PermissionFlagsBits.ManageRoles],
  ['manageChannels', 'Manage Channels', PermissionFlagsBits.ManageChannels],
  ['manageMessages', 'Manage Messages', PermissionFlagsBits.ManageMessages],
  ['viewAuditLog', 'View Audit Log', PermissionFlagsBits.ViewAuditLog]
]);

function clean(value, max = 180) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function enabledModuleIds(config = {}) {
  return MODULES.filter((module) => config.modules?.[module.id]?.enabled !== false).map((module) => module.id);
}

function safeError(error) {
  return clean(error?.message || error || 'Unknown error', 240);
}

class SentinalAdminOps {
  constructor(options = {}) {
    this.client = options.client;
    this.guild = options.guild;
    this.config = options.config || {};
    this.state = options.state;
    this.provisioner = options.provisioner;
    this.backend = options.backend;
    this.ensureConsole = options.ensureConsole;
    this.registerCommands = options.registerCommands;
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.startedAt = Date.now();
  }

  async status() {
    const backend = await this.backend?.health?.().catch((error) => ({ ok: false, message: safeError(error) })) || { ok: false };
    const guild = this.guild;
    return {
      ok: Boolean(this.client?.isReady?.() && guild),
      service: 'nexus-sentinal',
      discordReady: Boolean(this.client?.isReady?.()),
      user: this.client?.user ? { id: String(this.client.user.id), tag: clean(this.client.user.tag, 100) } : null,
      guild: guild ? { id: String(guild.id), name: clean(guild.name, 120), memberCount: Number(guild.memberCount || 0) } : null,
      websocketPingMs: Number.isFinite(this.client?.ws?.ping) ? Math.round(this.client.ws.ping) : null,
      uptimeSeconds: Math.max(0, Math.round((Date.now() - this.startedAt) / 1000)),
      backend: { ok: Boolean(backend?.ok), message: clean(backend?.message || '', 180) },
      moduleSetups: Object.keys(this.state?.listModuleSetups?.() || {}).length,
      consoles: Object.keys(this.state?.read?.().consoles || {}).length,
      enabledModules: enabledModuleIds(this.config)
    };
  }

  async permissions() {
    const guild = this.guild;
    if (!guild) return { ok: false, code: 'GUILD_UNAVAILABLE', permissions: [] };
    const me = guild.members.me || await guild.members.fetchMe();
    const administrator = me.permissions.has(PermissionFlagsBits.Administrator);
    const permissions = REQUIRED_PERMISSIONS.map(([id, label, bit]) => ({
      id,
      label,
      granted: administrator || me.permissions.has(bit)
    }));
    const roles = await guild.roles.fetch();
    const highest = me.roles.highest;
    const configured = [];
    for (const rank of NEXUS_RANKS) {
      const roleId = String(this.config.discord?.rankRoles?.[rank.id] || '');
      if (!roleId) {
        configured.push({ rankId: rank.id, rank: rank.name, roleId: '', exists: false, manageable: false, reason: 'not-configured' });
        continue;
      }
      const role = roles.get(roleId) || null;
      configured.push({
        rankId: rank.id,
        rank: rank.name,
        roleId,
        roleName: role?.name || '',
        exists: Boolean(role),
        manageable: Boolean(role && role.id !== guild.id && highest && highest.position > role.position),
        reason: !role ? 'missing-role' : highest.position <= role.position ? 'role-above-sentinal' : ''
      });
    }
    return {
      ok: permissions.every((item) => item.granted),
      administrator,
      botHighestRole: highest ? { id: String(highest.id), name: clean(highest.name, 100), position: highest.position } : null,
      permissions,
      rankRoles: configured
    };
  }

  async commands() {
    const commands = await this.guild.commands.fetch();
    const desired = ['nexus', 'market'];
    const existing = desired.map((name) => {
      const command = commands.find((item) => item.name === name);
      return { name, registered: Boolean(command), id: command ? String(command.id) : '' };
    });
    return {
      ok: existing.every((item) => item.registered),
      desired,
      commands: existing,
      unrelatedCommandsPreserved: true
    };
  }

  async syncCommands() {
    await this.registerCommands(this.guild);
    return this.commands();
  }

  async inspectChannels(moduleId = '') {
    const ids = moduleId ? [moduleId] : enabledModuleIds(this.config);
    const modules = [];
    for (const id of ids) {
      const module = getModule(id);
      if (!module) continue;
      try {
        modules.push(await inspectModuleLayout(this.guild, id));
      } catch (error) {
        modules.push({ moduleId: id, name: module.name, ok: false, complete: false, error: safeError(error) });
      }
    }
    return { ok: modules.every((item) => item.ok !== false && item.complete !== false), modules };
  }

  async reconcileChannels(moduleId = '') {
    const ids = moduleId ? [moduleId] : enabledModuleIds(this.config);
    const modules = [];
    for (const id of ids) {
      const module = getModule(id);
      if (!module) continue;
      try {
        const setup = await this.provisioner.provision(this.guild, id);
        modules.push({
          moduleId: id,
          name: module.name,
          ok: true,
          categoryId: setup.categoryId,
          categoryName: setup.categoryName,
          categoryCreated: Boolean(setup.categoryCreated),
          createdChannels: [...(setup.createdChannels || [])],
          consoleChannelId: setup.consoleChannelId
        });
      } catch (error) {
        modules.push({ moduleId: id, name: module.name, ok: false, error: safeError(error) });
      }
    }
    return { ok: modules.every((item) => item.ok), modules };
  }

  async refreshConsoles(moduleId = '') {
    const ids = moduleId ? [moduleId] : enabledModuleIds(this.config);
    const modules = [];
    for (const id of ids) {
      const module = getModule(id);
      if (!module || module.console === false) continue;
      try {
        const message = await this.ensureConsole(id);
        modules.push({ moduleId: id, name: module.name, ok: Boolean(message), messageId: message ? String(message.id) : '', channelId: message ? String(message.channelId || message.channel?.id || '') : '' });
      } catch (error) {
        modules.push({ moduleId: id, name: module.name, ok: false, error: safeError(error) });
      }
    }
    return { ok: modules.every((item) => item.ok), modules };
  }

  async fetchEntitlements() {
    const token = envSecret(this.config.discord?.tokenEnv);
    const applicationId = String(this.client?.application?.id || '');
    const guildId = String(this.guild?.id || '');
    if (!token || !applicationId || !guildId) throw new Error('Sentinal cannot read Discord entitlements until its application, guild, and bot token are available.');
    const all = [];
    let after = '';
    for (let page = 0; page < 20; page += 1) {
      const url = new URL(`https://discord.com/api/v10/applications/${applicationId}/entitlements`);
      url.searchParams.set('guild_id', guildId);
      url.searchParams.set('limit', '100');
      url.searchParams.set('exclude_ended', 'true');
      if (after) url.searchParams.set('after', after);
      const response = await this.fetchImpl(url, {
        headers: { authorization: `Bot ${token}`, accept: 'application/json', 'user-agent': 'Khaos-Nexus-Sentinal/0.1' }
      });
      if (!response.ok) throw new Error(`Discord entitlement API returned HTTP ${response.status}.`);
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error('Discord entitlement API returned an unexpected response.');
      all.push(...items);
      if (items.length < 100) break;
      after = String(items.at(-1)?.id || '');
      if (!after) break;
    }
    return all;
  }

  async rolePlan() {
    const roles = await this.guild.roles.fetch();
    const me = this.guild.members.me || await this.guild.members.fetchMe();
    const linked = await this.backend.accounts().catch(() => ({ ok: false, accounts: [] }));
    const entitlements = await this.fetchEntitlements();
    const entitlementsByUser = new Map();
    for (const entitlement of entitlements) {
      const userId = String(entitlement?.user_id || entitlement?.userId || '');
      if (!userId) continue;
      if (!entitlementsByUser.has(userId)) entitlementsByUser.set(userId, []);
      entitlementsByUser.get(userId).push(entitlement);
    }
    const linkedIds = new Set((linked.accounts || []).map((account) => String(account.discord?.id || '')).filter(Boolean));
    const userIds = new Set([...entitlementsByUser.keys(), ...linkedIds]);
    const mappedRoleIds = new Set(rankRoleIds(this.config));
    const items = [];
    for (const userId of userIds) {
      const premiumRank = highestRankForEntitlements(entitlementsByUser.get(userId) || [], this.config);
      const rank = premiumRank || (linkedIds.has(userId) ? NEXUS_RANKS[0] : null);
      if (!rank) continue;
      const desiredRoleId = String(this.config.discord?.rankRoles?.[rank.id] || '');
      if (!desiredRoleId) {
        items.push({ userId, rankId: rank.id, rank: rank.name, ok: false, action: 'configure-role', reason: 'No Discord role ID is mapped for this rank.' });
        continue;
      }
      let member = null;
      try { member = await this.guild.members.fetch(userId); } catch {}
      if (!member) {
        items.push({ userId, rankId: rank.id, rank: rank.name, roleId: desiredRoleId, ok: false, action: 'skip', reason: 'User is not currently a member of this Discord server.' });
        continue;
      }
      const desiredRole = roles.get(desiredRoleId) || null;
      if (!desiredRole) {
        items.push({ userId, displayName: clean(member.displayName || member.user?.username, 80), rankId: rank.id, rank: rank.name, roleId: desiredRoleId, ok: false, action: 'configure-role', reason: 'Mapped Discord role does not exist.' });
        continue;
      }
      const currentRankRoles = [...member.roles.cache.keys()].filter((roleId) => mappedRoleIds.has(String(roleId)));
      const add = member.roles.cache.has(desiredRoleId) ? [] : [desiredRoleId];
      const remove = currentRankRoles.filter((roleId) => roleId !== desiredRoleId);
      const rolesToChange = [...new Set([...add, ...remove])].map((roleId) => roles.get(String(roleId))).filter(Boolean);
      const blockedRole = rolesToChange.find((role) => role.id === this.guild.id || me.roles.highest.position <= role.position);
      if (blockedRole) {
        items.push({
          userId,
          displayName: clean(member.displayName || member.user?.username, 80),
          rankId: rank.id,
          rank: rank.name,
          roleId: desiredRoleId,
          roleName: desiredRole.name,
          ok: false,
          action: 'blocked',
          reason: `Sentinal's highest role must be above ${blockedRole.name}.`
        });
        continue;
      }
      items.push({
        userId,
        displayName: clean(member.displayName || member.user?.username, 80),
        rankId: rank.id,
        rank: rank.name,
        roleId: desiredRoleId,
        roleName: desiredRole.name,
        ok: true,
        action: add.length || remove.length ? 'reconcile' : 'none',
        add,
        remove
      });
    }
    return { ok: items.every((item) => item.ok), entitlementCount: entitlements.length, linkedAccountCount: linkedIds.size, items };
  }

  async reconcileRoles({ dryRun = false } = {}) {
    const plan = await this.rolePlan();
    if (dryRun) return { ...plan, dryRun: true, changed: 0 };
    const permissions = await this.permissions();
    if (!permissions.permissions.find((item) => item.id === 'manageRoles')?.granted) throw new Error('Nexus Sentinal does not have permission to manage roles.');
    let changed = 0;
    for (const item of plan.items) {
      if (!item.ok || item.action !== 'reconcile') continue;
      const member = await this.guild.members.fetch(item.userId);
      if (item.add?.length) { await member.roles.add(item.add, `Khaos Nexus entitlement sync: ${item.rank}`); changed += item.add.length; }
      if (item.remove?.length) { await member.roles.remove(item.remove, `Khaos Nexus entitlement rank reconciliation: ${item.rank}`); changed += item.remove.length; }
    }
    return { ...(await this.rolePlan()), dryRun: false, changed };
  }

  async scan() {
    const [status, permissions, commands, channels, roles] = await Promise.all([
      this.status(),
      this.permissions(),
      this.commands(),
      this.inspectChannels(),
      this.rolePlan().catch((error) => ({ ok: false, entitlementCount: 0, linkedAccountCount: 0, items: [], error: safeError(error) }))
    ]);
    const sections = { status, permissions, commands, channels, roles };
    return { ok: Object.values(sections).every((section) => section?.ok !== false), sections };
  }

  async repair() {
    const permissions = await this.permissions();
    if (!permissions.permissions.find((item) => item.id === 'administrator')?.granted) {
      return { ok: false, code: 'ADMINISTRATOR_REQUIRED', message: 'Sentinal needs Administrator before Nexus can safely reconcile the Discord installation.', sections: { permissions } };
    }
    const sections = { permissions };
    sections.commands = await this.syncCommands().catch((error) => ({ ok: false, error: safeError(error) }));
    sections.channels = await this.reconcileChannels().catch((error) => ({ ok: false, error: safeError(error) }));
    sections.consoles = await this.refreshConsoles().catch((error) => ({ ok: false, error: safeError(error) }));
    sections.roles = await this.reconcileRoles({ dryRun: false }).catch((error) => ({ ok: false, changed: 0, error: safeError(error) }));
    sections.status = await this.status();
    return { ok: Object.values(sections).every((section) => section?.ok !== false), sections };
  }
}

module.exports = { REQUIRED_PERMISSIONS, SentinalAdminOps, enabledModuleIds };
