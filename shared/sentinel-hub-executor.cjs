'use strict';

const { normalizeAuditEntry } = require('./discord-automation.cjs');

function requireFunction(target, name) {
  if (!target || typeof target[name] !== 'function') throw new TypeError(`Sentinel hub executor requires ${name}().`);
  return target[name].bind(target);
}

function auditEntry({ action, hubId, targetType, targetId, summary, details, actor = {} }) {
  return normalizeAuditEntry({
    category: 'sentinel-hubs',
    action,
    outcome: 'success',
    actorId: actor.id,
    actorName: actor.name || 'Nexus Sentinel',
    actorRole: actor.role || 'local-admin',
    targetType,
    targetId,
    targetName: hubId,
    summary,
    details: { hubId, ...(details || {}) },
  });
}

async function emit(audit, entry) {
  if (typeof audit === 'function') await audit(entry);
}

async function executeHubBindingPlan({
  registry,
  plan = [],
  gateway,
  persistChannelBinding,
  audit,
  actor,
  dryRun = true,
} = {}) {
  if (!registry || typeof registry.get !== 'function') throw new TypeError('A Sentinel hub registry is required.');
  const results = [];

  for (const item of plan || []) {
    const hub = registry.get(item.hubId);
    if (!hub) throw new TypeError(`Unknown Sentinel hub: ${item.hubId}`);

    if (item.action === 'keep') {
      results.push({ hubId: item.hubId, status: 'kept', discordChannelId: item.discordChannelId });
      continue;
    }
    if (item.action === 'review') {
      results.push({
        hubId: item.hubId,
        status: 'review-required',
        discordChannelId: null,
        reason: item.reason,
        candidates: [...(item.candidates || [])],
      });
      continue;
    }
    if (item.action === 'adopt') {
      if (dryRun) {
        results.push({ hubId: item.hubId, status: 'would-adopt', discordChannelId: item.discordChannelId });
        continue;
      }
      if (typeof persistChannelBinding !== 'function') throw new TypeError('persistChannelBinding() is required for hub adoption.');
      await persistChannelBinding(item.hubId, item.discordChannelId);
      await emit(audit, auditEntry({
        action: 'channel-adopted',
        hubId: item.hubId,
        targetType: 'discord-channel',
        targetId: item.discordChannelId,
        summary: `Adopted existing Discord channel for Sentinel hub ${item.hubId}.`,
        actor,
      }));
      results.push({ hubId: item.hubId, status: 'adopted', discordChannelId: item.discordChannelId });
      continue;
    }
    if (item.action === 'create') {
      if (dryRun) {
        results.push({ hubId: item.hubId, status: 'would-create', discordChannelId: null });
        continue;
      }
      const createHubChannel = requireFunction(gateway, 'createHubChannel');
      if (typeof persistChannelBinding !== 'function') throw new TypeError('persistChannelBinding() is required for hub creation.');
      const created = await createHubChannel({
        hubId: hub.id,
        categoryBlueprintId: hub.categoryId,
        channelBlueprintId: hub.channelId,
        channelName: hub.blueprint.channelName,
        channelType: hub.blueprint.channelType,
      });
      const discordChannelId = String(created?.id || '').trim();
      if (!discordChannelId) throw new Error(`Discord channel creation returned no ID for hub ${hub.id}.`);
      await persistChannelBinding(hub.id, discordChannelId);
      await emit(audit, auditEntry({
        action: 'channel-created',
        hubId: hub.id,
        targetType: 'discord-channel',
        targetId: discordChannelId,
        summary: `Created managed Discord channel for Sentinel hub ${hub.id}.`,
        details: { categoryBlueprintId: hub.categoryId, channelBlueprintId: hub.channelId },
        actor,
      }));
      results.push({ hubId: hub.id, status: 'created', discordChannelId });
      continue;
    }

    throw new TypeError(`Unsupported hub action: ${item.action}`);
  }

  return results;
}

async function executePersistentHubMessagePlan({
  hub,
  plan,
  gateway,
  persistMessageBinding,
  render,
  audit,
  actor,
  dryRun = true,
} = {}) {
  if (!hub?.id) throw new TypeError('A managed hub is required.');
  if (!plan?.action) throw new TypeError('A persistent hub message plan is required.');

  if (plan.action === 'keep') {
    return { hubId: hub.id, status: 'kept', discordMessageId: plan.discordMessageId };
  }
  if (plan.action !== 'create') throw new TypeError(`Unsupported hub message action: ${plan.action}`);
  if (dryRun) return { hubId: hub.id, status: 'would-create', discordMessageId: null };

  const createPersistentMessage = requireFunction(gateway, 'createPersistentMessage');
  if (typeof persistMessageBinding !== 'function') throw new TypeError('persistMessageBinding() is required for persistent hub messages.');
  if (typeof render !== 'function') throw new TypeError('render() is required for persistent hub messages.');

  const payload = await render(hub);
  const created = await createPersistentMessage({ hubId: hub.id, payload });
  const discordMessageId = String(created?.id || '').trim();
  if (!discordMessageId) throw new Error(`Persistent message creation returned no ID for hub ${hub.id}.`);
  await persistMessageBinding(hub.id, discordMessageId);
  await emit(audit, auditEntry({
    action: 'persistent-message-created',
    hubId: hub.id,
    targetType: 'discord-message',
    targetId: discordMessageId,
    summary: `Created persistent Sentinel message for hub ${hub.id}.`,
    details: { persistentMessageKey: hub.persistentMessageKey, bannerKey: hub.bannerKey || null },
    actor,
  }));

  return { hubId: hub.id, status: 'created', discordMessageId };
}

module.exports = {
  executeHubBindingPlan,
  executePersistentHubMessagePlan,
};
