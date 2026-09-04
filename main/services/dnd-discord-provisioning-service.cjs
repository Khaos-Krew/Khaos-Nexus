'use strict';

const { DndCampaignService } = require('./dnd-campaign-service.cjs');
const {
  PERMISSIONS,
  DEFAULT_CAMPAIGN_CHANNEL_TEMPLATE,
  categoryName,
  stableHash,
  normalizeTemplate,
  normalizeProvisioningRecord,
  buildPermissionOverwrites,
  computeBasePermissions,
  hasPermission,
  provisioningIdentity
} = require('../../shared/dnd-discord-provisioning.cjs');

const DISCORD_API = 'https://discord.com/api/v10';
const CHANNEL_TYPE = Object.freeze({ text: 0, voice: 2, category: 4 });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestError(status, body, fallback) {
  const error = new Error(body?.message || fallback || `Discord request failed with HTTP ${status}.`);
  error.status = status;
  error.discordCode = body?.code;
  if (status === 401) error.code = 'DISCORD_TOKEN_INVALID';
  else if (status === 403) error.code = 'DISCORD_PERMISSION_MISSING';
  else if (status === 404) error.code = 'DISCORD_RESOURCE_STALE';
  else if (status === 429) error.code = 'DISCORD_RATE_LIMITED';
  else error.code = 'DISCORD_REQUEST_FAILED';
  return error;
}

class DndDiscordProvisioningService {
  constructor({ configStore, logger, fetchImpl = globalThis.fetch, sleep = wait, timeoutMs = 15000 }) {
    this.configStore = configStore;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.timeoutMs = timeoutMs;
    this.panelService = new DndCampaignService({ configStore, logger });
  }

  state() {
    const state = this.configStore.getDndState();
    if (!Array.isArray(state.provisioningRecords)) state.provisioningRecords = [];
    return state;
  }

  token(appId) {
    const token = this.configStore.getDiscordAppToken(appId);
    if (!token) {
      const error = new Error('The selected registered Discord app has no protected bot token.');
      error.code = 'DISCORD_BOT_TOKEN_MISSING';
      throw error;
    }
    return token;
  }

  async discord(appId, path, { method = 'GET', body, attempts = 3 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(`${DISCORD_API}${path}`, {
          method,
          headers: {
            Authorization: `Bot ${this.token(appId)}`,
            'Content-Type': 'application/json',
            'User-Agent': 'KhaosNexus-DnD-Provisioning/1.0'
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
      } catch (error) {
        clearTimeout(timeout);
        if (attempt < attempts && error?.name !== 'AbortError') {
          await this.sleep(250 * attempt);
          continue;
        }
        const wrapped = new Error(error?.name === 'AbortError' ? 'Discord provisioning request timed out.' : error.message || String(error));
        wrapped.code = error?.name === 'AbortError' ? 'DISCORD_REQUEST_TIMEOUT' : 'DISCORD_REQUEST_FAILED';
        throw wrapped;
      }
      clearTimeout(timeout);
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
      if (response.ok) return payload;
      if (response.status === 429 && attempt < attempts) {
        const headerDelay = Number(response.headers?.get?.('retry-after'));
        const bodyDelay = Number(payload?.retry_after);
        const seconds = Number.isFinite(headerDelay) ? headerDelay : Number.isFinite(bodyDelay) ? bodyDelay : 1;
        await this.sleep(Math.max(0, seconds) * 1000);
        continue;
      }
      if (response.status >= 500 && attempt < attempts) {
        await this.sleep(300 * attempt);
        continue;
      }
      throw requestError(response.status, payload, `Discord request to ${path} failed.`);
    }
    throw requestError(500, null, 'Discord request exhausted its retry attempts.');
  }

  campaign(campaignId) {
    const campaign = this.state().campaigns.find((item) => item.id === campaignId);
    if (!campaign) {
      const error = new Error('The selected D&D campaign was not found.');
      error.code = 'DND_CAMPAIGN_NOT_FOUND';
      throw error;
    }
    return campaign;
  }

  app(appId) {
    const app = this.state().registeredApps.find((item) => item.id === appId);
    if (!app) {
      const error = new Error('The selected registered Discord app was not found.');
      error.code = 'DND_DISCORD_APP_NOT_FOUND';
      throw error;
    }
    return app;
  }

  record(campaignId, appId, guildId) {
    return this.state().provisioningRecords.find((item) =>
      item.campaignId === campaignId && item.appId === appId && item.guildId === guildId
    ) || null;
  }

  saveRecord(input) {
    const value = normalizeProvisioningRecord(input);
    return this.configStore.mutateDnd((state) => {
      if (!Array.isArray(state.provisioningRecords)) state.provisioningRecords = [];
      const index = state.provisioningRecords.findIndex((item) => item.id === value.id || (
        item.campaignId === value.campaignId && item.appId === value.appId && item.guildId === value.guildId
      ));
      if (index >= 0) state.provisioningRecords[index] = { ...value, id: state.provisioningRecords[index].id };
      else state.provisioningRecords.push(value);
      return JSON.parse(JSON.stringify(index >= 0 ? state.provisioningRecords[index] : value));
    });
  }

  audit(action, input, outcome = 'success', metadata = {}) {
    return this.configStore.appendDndAudit({
      action,
      outcome,
      actorId: input.createdBy || 'local-owner',
      campaignId: input.campaignId,
      appId: input.appId,
      guildId: input.guildId,
      targetId: input.targetId || '',
      metadata
    });
  }

  async botReadiness(appId, guildId) {
    const app = this.app(appId);
    const identity = app.botUserId ? { id: app.botUserId } : await this.discord(appId, '/users/@me');
    const [member, roles] = await Promise.all([
      this.discord(appId, `/guilds/${guildId}/members/${identity.id}`),
      this.discord(appId, `/guilds/${guildId}/roles`)
    ]);
    const permissions = computeBasePermissions(member, Array.isArray(roles) ? roles : [], guildId);
    return {
      botUserId: String(identity.id),
      permissions: permissions.toString(),
      manageChannels: hasPermission(permissions, PERMISSIONS.MANAGE_CHANNELS),
      manageRoles: hasPermission(permissions, PERMISSIONS.MANAGE_ROLES),
      administrator: hasPermission(permissions, PERMISSIONS.ADMINISTRATOR)
    };
  }

  async preview(input = {}) {
    const campaign = this.campaign(String(input.campaignId || ''));
    const appId = String(input.appId || '');
    const guildId = String(input.guildId || '');
    this.app(appId);
    if (!/^\d{5,25}$/.test(guildId)) {
      const error = new Error('Select a valid Discord guild before provisioning.');
      error.code = 'INVALID_DISCORD_SNOWFLAKE';
      throw error;
    }
    const template = normalizeTemplate(input.template, campaign);
    const members = this.state().members.filter((item) => item.campaignId === campaign.id && item.active !== false);
    const mappedMembers = members.filter((item) => item.discordUserId);
    const managers = mappedMembers.filter((item) => ['admin', 'dm', 'assistant_dm'].includes(item.role));
    const [channels, readiness] = await Promise.all([
      this.discord(appId, `/guilds/${guildId}/channels`),
      this.botReadiness(appId, guildId)
    ]);
    const existing = new Map((Array.isArray(channels) ? channels : []).map((channel) => [String(channel.id), channel]));
    const record = this.record(campaign.id, appId, guildId);
    const warnings = [];
    const blockers = [];
    if (!readiness.manageChannels) blockers.push('The selected bot is missing Manage Channels.');
    if (!readiness.manageRoles) blockers.push('The selected bot is missing Manage Roles, which is required to apply channel permission overwrites.');
    if (!managers.length) blockers.push('Map at least one campaign DM, Assistant DM, or Admin to a Discord user ID.');
    if (mappedMembers.length > 50) blockers.push('More than 50 campaign members are mapped. Configure Discord roles before provisioning individual overwrites.');
    if (members.length !== mappedMembers.length) warnings.push(`${members.length - mappedMembers.length} active campaign member(s) have no Discord user ID and will not receive channel access.`);
    const categoryMissing = Boolean(record?.categoryId && !existing.has(String(record.categoryId)));
    if (categoryMissing) warnings.push('The previously managed category is missing and will be recreated.');

    const category = categoryName(input.categoryName || campaign.name);
    const plan = template.filter((item) => item.enabled).map((item) => {
      const managed = record?.resources?.[item.key] || null;
      const current = managed?.id ? existing.get(String(managed.id)) : null;
      const wrongParent = Boolean(current && record?.categoryId && String(current.parent_id || '') !== String(record.categoryId));
      return {
        ...item,
        action: current ? (categoryMissing || wrongParent ? 'reparent' : 'reuse') : managed ? 'repair' : 'create',
        currentId: current ? String(current.id) : '',
        currentName: current ? String(current.name || item.name) : ''
      };
    });
    const confirmationHash = stableHash({
      campaignId: campaign.id,
      appId,
      guildId,
      categoryName: category,
      template: plan.map(({ key, name, type, purpose, enabled }) => ({ key, name, type, purpose, enabled })),
      recordId: record?.id || '',
      categoryId: record?.categoryId || '',
      botUserId: readiness.botUserId
    });
    return {
      ready: blockers.length === 0,
      confirmationHash,
      campaign: { id: campaign.id, name: campaign.name },
      appId,
      guildId,
      categoryName: category,
      bot: readiness,
      members: { total: members.length, mapped: mappedMembers.length, managers: managers.length },
      blockers,
      warnings,
      plan,
      existingRecord: record ? JSON.parse(JSON.stringify(record)) : null
    };
  }

  channelBody({ guildId, botUserId, members, categoryId, channel }) {
    const body = {
      name: channel.name,
      type: CHANNEL_TYPE[channel.type],
      parent_id: categoryId,
      permission_overwrites: buildPermissionOverwrites({ guildId, botUserId, members, channel })
    };
    if (channel.type === 'text') {
      body.topic = `Khaos Nexus managed D&D campaign channel · ${channel.key}`;
    }
    return body;
  }

  upsertBinding(input, resource, provisioningId) {
    const state = this.state();
    const existing = state.bindings.find((item) =>
      item.active !== false && item.campaignId === input.campaignId && item.appId === input.appId &&
      item.guildId === input.guildId && item.purpose === resource.purpose
    );
    return this.configStore.upsertDndBinding({
      ...existing,
      campaignId: input.campaignId,
      appId: input.appId,
      guildId: input.guildId,
      resourceType: 'channel',
      resourceId: resource.id,
      parentChannelId: resource.categoryId,
      displayName: resource.name,
      purpose: resource.purpose,
      primary: resource.key === 'table-chat',
      active: true,
      createdBy: input.createdBy,
      verifiedAt: new Date().toISOString(),
      lastError: '',
      metadata: { ...(existing?.metadata || {}), managedBy: 'khaos-nexus', provisioningId, key: resource.key }
    });
  }

  async apply(input = {}, onProgress = () => {}) {
    if (!input.confirmed) {
      const error = new Error('Confirm the exact campaign category and channel preview before provisioning.');
      error.code = 'CONFIRMATION_REQUIRED';
      throw error;
    }
    const preview = await this.preview(input);
    if (!preview.ready) {
      const error = new Error(preview.blockers.join(' '));
      error.code = 'DND_PROVISIONING_NOT_READY';
      error.blockers = preview.blockers;
      throw error;
    }
    if (!input.confirmationHash || input.confirmationHash !== preview.confirmationHash) {
      const error = new Error('The provisioning preview changed. Review the latest plan and confirm again.');
      error.code = 'DND_PROVISIONING_PREVIEW_STALE';
      throw error;
    }

    const campaign = this.campaign(preview.campaign.id);
    const members = this.state().members.filter((item) => item.campaignId === campaign.id && item.active !== false);
    const channels = await this.discord(preview.appId, `/guilds/${preview.guildId}/channels`);
    const channelMap = new Map((Array.isArray(channels) ? channels : []).map((channel) => [String(channel.id), channel]));
    let record = normalizeProvisioningRecord({
      ...(preview.existingRecord || {}),
      id: preview.existingRecord?.id || provisioningIdentity(preview),
      campaignId: campaign.id,
      appId: preview.appId,
      guildId: preview.guildId,
      categoryName: preview.categoryName,
      templateHash: preview.confirmationHash,
      createdBy: input.createdBy,
      status: 'partial'
    });
    const results = [];
    let createdCount = 0;

    let category = record.categoryId ? channelMap.get(String(record.categoryId)) : null;
    if (!category) {
      onProgress({ phase: 'category', status: 'creating', name: preview.categoryName });
      const created = await this.discord(preview.appId, `/guilds/${preview.guildId}/channels`, {
        method: 'POST',
        body: {
          name: preview.categoryName,
          type: CHANNEL_TYPE.category,
          permission_overwrites: buildPermissionOverwrites({
            guildId: preview.guildId,
            botUserId: preview.bot.botUserId,
            members,
            channel: { key: 'category', type: 'text', playerMode: 'write' }
          })
        }
      });
      category = created;
      channelMap.set(String(created.id), created);
      record.categoryId = String(created.id);
      record.categoryName = String(created.name || preview.categoryName);
      record = this.saveRecord(record);
      createdCount += 1;
      results.push({ key: 'category', status: 'created', id: String(created.id), name: record.categoryName });
      this.audit('provisioning.category_created', { ...input, campaignId: campaign.id, appId: preview.appId, guildId: preview.guildId, targetId: String(created.id) }, 'success', { name: record.categoryName });
    } else {
      results.push({ key: 'category', status: 'reused', id: String(category.id), name: String(category.name || record.categoryName) });
    }

    for (const channel of preview.plan) {
      const managed = record.resources?.[channel.key] || null;
      const existing = managed?.id ? channelMap.get(String(managed.id)) : null;
      if (existing) {
        const desiredParentId = String(category.id);
        const currentParentId = existing.parent_id === null || existing.parent_id === undefined ? '' : String(existing.parent_id);
        if (currentParentId !== desiredParentId) {
          onProgress({ phase: 'channel', status: 'reparenting', key: channel.key, name: channel.name });
          try {
            const updated = await this.discord(preview.appId, `/channels/${existing.id}`, {
              method: 'PATCH',
              body: { parent_id: desiredParentId }
            });
            const reconciled = { ...existing, ...(updated || {}), parent_id: desiredParentId };
            channelMap.set(String(existing.id), reconciled);
            results.push({
              key: channel.key,
              status: 'reparented',
              id: String(existing.id),
              categoryId: desiredParentId,
              name: String(reconciled.name || channel.name),
              type: channel.type
            });
            this.audit('provisioning.channel_reparented', {
              ...input,
              campaignId: campaign.id,
              appId: preview.appId,
              guildId: preview.guildId,
              targetId: String(existing.id)
            }, 'success', { key: channel.key, categoryId: desiredParentId });
          } catch (error) {
            results.push({ key: channel.key, status: 'failed', id: String(existing.id), name: channel.name, type: channel.type, error: error.code || error.message });
            this.audit('provisioning.channel_reparent_failed', {
              ...input,
              campaignId: campaign.id,
              appId: preview.appId,
              guildId: preview.guildId,
              targetId: String(existing.id)
            }, 'failed', { key: channel.key, categoryId: desiredParentId, error: error.code || error.message });
          }
        } else {
          results.push({ key: channel.key, status: 'reused', id: String(existing.id), name: String(existing.name || channel.name), type: channel.type });
        }
        continue;
      }
      onProgress({ phase: 'channel', status: 'creating', key: channel.key, name: channel.name });
      try {
        const created = await this.discord(preview.appId, `/guilds/${preview.guildId}/channels`, {
          method: 'POST',
          body: this.channelBody({
            guildId: preview.guildId,
            botUserId: preview.bot.botUserId,
            members,
            categoryId: String(category.id),
            channel
          })
        });
        const resource = {
          id: String(created.id),
          categoryId: String(category.id),
          key: channel.key,
          name: String(created.name || channel.name),
          type: channel.type,
          purpose: channel.purpose
        };
        record.resources[channel.key] = { id: resource.id, name: resource.name, type: resource.type, purpose: resource.purpose };
        record = this.saveRecord(record);
        channelMap.set(resource.id, created);
        createdCount += 1;
        results.push({ ...resource, status: managed ? 'repaired' : 'created' });
        this.audit(managed ? 'provisioning.channel_repaired' : 'provisioning.channel_created', {
          ...input,
          campaignId: campaign.id,
          appId: preview.appId,
          guildId: preview.guildId,
          targetId: resource.id
        }, 'success', { key: channel.key, name: resource.name, type: resource.type });
      } catch (error) {
        results.push({ key: channel.key, status: 'failed', name: channel.name, type: channel.type, error: error.code || error.message });
        this.audit('provisioning.channel_failed', {
          ...input,
          campaignId: campaign.id,
          appId: preview.appId,
          guildId: preview.guildId
        }, 'failed', { key: channel.key, error: error.code || error.message });
      }
    }

    const bindings = [];
    for (const channel of preview.plan) {
      const managed = record.resources?.[channel.key];
      if (!managed?.id) continue;
      try {
        bindings.push(this.upsertBinding({ ...input, campaignId: campaign.id, appId: preview.appId, guildId: preview.guildId }, {
          id: managed.id,
          categoryId: record.categoryId,
          key: channel.key,
          name: managed.name,
          purpose: channel.purpose
        }, record.id));
      } catch (error) {
        results.push({ key: channel.key, status: 'binding-failed', id: managed.id, error: error.code || error.message });
      }
    }

    const failed = results.filter((item) => item.status === 'failed' || item.status === 'binding-failed');
    record.status = failed.length ? 'partial' : 'ready';
    record.templateHash = preview.confirmationHash;
    record = this.saveRecord(record);

    const infoBinding = bindings.find((item) => item.purpose === 'announcements');
    let panel = null;
    if (infoBinding) {
      try {
        panel = await this.panelService.refreshPanel(infoBinding.id);
      } catch (error) {
        results.push({ key: 'campaign-panel', status: 'failed', error: error.code || error.message });
      }
    }

    this.audit('provisioning.completed', {
      ...input,
      campaignId: campaign.id,
      appId: preview.appId,
      guildId: preview.guildId,
      targetId: record.id
    }, failed.length ? 'partial' : 'success', { createdCount, failedCount: failed.length, categoryId: record.categoryId });
    onProgress({ phase: 'complete', status: failed.length ? 'partial' : 'success', createdCount, failedCount: failed.length });
    return { preview, record, results, bindings, panel, createdCount, failedCount: failed.length };
  }
}

module.exports = { DndDiscordProvisioningService, DISCORD_API, CHANNEL_TYPE, requestError };
