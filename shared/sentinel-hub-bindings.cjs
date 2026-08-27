'use strict';

function clean(value) {
  return String(value || '').trim();
}

function normalizeAliases(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(clean).filter(Boolean))];
}

function normalizeHubBinding(input = {}) {
  const hubId = clean(input.hubId).toLowerCase();
  if (!hubId) throw new TypeError('Hub bindings require a hubId.');
  return Object.freeze({
    hubId,
    discordCategoryId: clean(input.discordCategoryId) || null,
    discordChannelId: clean(input.discordChannelId) || null,
    discordMessageId: clean(input.discordMessageId) || null,
    aliases: Object.freeze(normalizeAliases(input.aliases)),
  });
}

function channelNamesForHub(hub, binding = {}) {
  const names = [hub?.blueprint?.channelName, hub?.channelId, ...(binding.aliases || [])]
    .map(clean)
    .filter(Boolean)
    .map((name) => name.toLocaleLowerCase());
  return new Set(names);
}

function findHubChannelCandidate(discordChannels, hub, bindingInput = {}) {
  const binding = normalizeHubBinding({ hubId: hub?.id, ...bindingInput });
  const channels = Array.isArray(discordChannels) ? discordChannels : [];

  if (binding.discordChannelId) {
    const exact = channels.find((channel) => clean(channel?.id) === binding.discordChannelId);
    if (exact) return Object.freeze({ state: 'matched', reason: 'id', channel: exact });
  }

  const accepted = channelNamesForHub(hub, binding);
  const matches = channels.filter((channel) => accepted.has(clean(channel?.name).toLocaleLowerCase()));
  if (matches.length === 1) return Object.freeze({ state: 'matched', reason: 'alias', channel: matches[0] });
  if (matches.length > 1) {
    return Object.freeze({
      state: 'ambiguous',
      reason: 'multiple-alias-matches',
      matches: Object.freeze([...matches]),
    });
  }
  return Object.freeze({ state: 'missing', reason: 'no-match', channel: null });
}

function planHubBindingSync({ registry, bindings = {}, discordChannels = [] } = {}) {
  if (!registry || typeof registry.enabled !== 'function') {
    throw new TypeError('A Sentinel hub registry is required.');
  }

  return registry.enabled().map((hub) => {
    const binding = normalizeHubBinding({ hubId: hub.id, ...(bindings[hub.id] || {}) });
    const candidate = findHubChannelCandidate(discordChannels, hub, binding);

    if (candidate.state === 'matched') {
      const channelId = clean(candidate.channel?.id);
      return Object.freeze({
        hubId: hub.id,
        action: binding.discordChannelId === channelId ? 'keep' : 'adopt',
        discordChannelId: channelId,
        discordMessageId: binding.discordMessageId,
        reason: candidate.reason,
      });
    }

    if (candidate.state === 'ambiguous') {
      return Object.freeze({
        hubId: hub.id,
        action: 'review',
        discordChannelId: null,
        discordMessageId: binding.discordMessageId,
        reason: candidate.reason,
        candidates: Object.freeze(candidate.matches.map((channel) => clean(channel?.id)).filter(Boolean)),
      });
    }

    return Object.freeze({
      hubId: hub.id,
      action: 'create',
      discordChannelId: null,
      discordMessageId: binding.discordMessageId,
      reason: 'missing-managed-channel',
    });
  });
}

function planPersistentHubMessage({ hubId, binding: bindingInput = {}, messages = [] } = {}) {
  const binding = normalizeHubBinding({ hubId, ...bindingInput });
  const available = Array.isArray(messages) ? messages : [];

  if (binding.discordMessageId) {
    const exact = available.find((message) => clean(message?.id) === binding.discordMessageId);
    if (exact) {
      return Object.freeze({ action: 'keep', discordMessageId: binding.discordMessageId, reason: 'id' });
    }
  }

  return Object.freeze({
    action: 'create',
    discordMessageId: null,
    reason: binding.discordMessageId ? 'persisted-message-missing' : 'message-not-bound',
  });
}

function withChannelBinding(bindingInput, discordChannelId) {
  const binding = normalizeHubBinding(bindingInput);
  return normalizeHubBinding({ ...binding, discordChannelId });
}

function withMessageBinding(bindingInput, discordMessageId) {
  const binding = normalizeHubBinding(bindingInput);
  return normalizeHubBinding({ ...binding, discordMessageId });
}

module.exports = {
  normalizeHubBinding,
  findHubChannelCandidate,
  planHubBindingSync,
  planPersistentHubMessage,
  withChannelBinding,
  withMessageBinding,
};
