'use strict';

const HUB_SCHEMA_VERSION = 1;

function clean(value) {
  return String(value || '').trim();
}

function aliases(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(clean).filter(Boolean))];
}

function normalizeHub(definition = {}) {
  const hubKey = clean(definition.hubKey);
  const guildId = clean(definition.guildId);
  const channelName = clean(definition.channelName);
  if (!hubKey) throw new TypeError('Managed hubs require a stable hubKey.');
  if (!guildId) throw new TypeError(`Managed hub ${hubKey} requires a guildId.`);
  if (!channelName) throw new TypeError(`Managed hub ${hubKey} requires a channelName.`);

  return Object.freeze({
    schemaVersion: HUB_SCHEMA_VERSION,
    hubKey,
    guildId,
    categoryId: clean(definition.categoryId) || null,
    channelId: clean(definition.channelId) || null,
    messageId: clean(definition.messageId) || null,
    channelName,
    aliases: Object.freeze(aliases(definition.aliases)),
    bannerKey: clean(definition.bannerKey) || null,
    moduleKey: clean(definition.moduleKey) || null,
    managed: definition.managed !== false,
  });
}

function normalizeRegistry(definitions = []) {
  const seen = new Set();
  return Object.freeze((definitions || []).map((definition) => {
    const hub = normalizeHub(definition);
    if (seen.has(hub.hubKey)) throw new TypeError(`Duplicate hubKey: ${hub.hubKey}`);
    seen.add(hub.hubKey);
    return hub;
  }));
}

function findChannelCandidate(channels, definition) {
  const hub = normalizeHub(definition);
  const available = Array.isArray(channels) ? channels : [];

  if (hub.channelId) {
    const exact = available.find((channel) => clean(channel?.id) === hub.channelId);
    if (exact) return { state: 'matched', reason: 'id', channel: exact };
  }

  const names = new Set([hub.channelName, ...hub.aliases].map((name) => name.toLocaleLowerCase()));
  const matches = available.filter((channel) => names.has(clean(channel?.name).toLocaleLowerCase()));
  if (matches.length === 1) return { state: 'matched', reason: 'alias', channel: matches[0] };
  if (matches.length > 1) return { state: 'ambiguous', reason: 'multiple-alias-matches', matches };
  return { state: 'missing', reason: 'no-match', channel: null };
}

function planHubSync(channels, definitions) {
  return normalizeRegistry(definitions).map((hub) => {
    const candidate = findChannelCandidate(channels, hub);
    if (candidate.state === 'matched') {
      const channelId = clean(candidate.channel.id);
      return Object.freeze({
        hubKey: hub.hubKey,
        action: hub.channelId === channelId ? 'keep' : 'adopt',
        channelId,
        messageId: hub.messageId,
        reason: candidate.reason,
      });
    }
    if (candidate.state === 'ambiguous') {
      return Object.freeze({
        hubKey: hub.hubKey,
        action: 'review',
        channelId: null,
        messageId: hub.messageId,
        reason: candidate.reason,
        candidates: Object.freeze(candidate.matches.map((channel) => clean(channel.id)).filter(Boolean)),
      });
    }
    return Object.freeze({
      hubKey: hub.hubKey,
      action: hub.managed ? 'create' : 'unbound',
      channelId: null,
      messageId: hub.messageId,
      reason: hub.managed ? 'missing-managed-channel' : 'unmanaged-hub',
    });
  });
}

function withPersistedChannel(hub, channelId) {
  return normalizeHub({ ...hub, channelId });
}

function withPersistedMessage(hub, messageId) {
  return normalizeHub({ ...hub, messageId });
}

function planPersistentMessage({ hub, channelMessages = [] } = {}) {
  const normalized = normalizeHub(hub);
  const messages = Array.isArray(channelMessages) ? channelMessages : [];

  if (normalized.messageId) {
    const match = messages.find((message) => clean(message?.id) === normalized.messageId);
    if (match) return Object.freeze({ action: 'keep', messageId: normalized.messageId, reason: 'id' });
  }

  return Object.freeze({
    action: 'create',
    messageId: null,
    reason: normalized.messageId ? 'persisted-message-missing' : 'message-not-bound',
  });
}

module.exports = {
  HUB_SCHEMA_VERSION,
  normalizeHub,
  normalizeRegistry,
  findChannelCandidate,
  planHubSync,
  withPersistedChannel,
  withPersistedMessage,
  planPersistentMessage,
};
