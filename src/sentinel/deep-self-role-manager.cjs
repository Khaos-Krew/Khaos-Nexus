'use strict';

const {
  SelfRoleManager: BaseSelfRoleManager,
  valuesOf,
  legacyComponentsRemoved
} = require('./self-role-manager.cjs');
const {
  LEGACY_SELF_ROLE_BUTTON_PREFIX,
  messageButtons,
  isCurrentSelfRoleMessage,
  isLegacySelfRoleMessage,
  discoverLegacySelfRoleMenu,
  normalizedName
} = require('./self-role-model.cjs');
const { parseReactionRoleMenu } = require('./reaction-self-role-model.cjs');

const DEEP_HISTORY_LIMIT = 500;
const FALLBACK_HISTORY_LIMIT = 100;
const ROLE_DISCOVERY_TERMS = ['role', 'roles', 'self-role', 'self-roles', 'reaction', 'reactions', 'notification', 'notifications', 'color', 'colors', 'colour', 'colours', 'assign', 'assignment'];

function isRoleDiscoveryChannelName(name) {
  const normalized = normalizedName(name);
  if (!normalized) return false;
  const parts = new Set(normalized.split('-').filter(Boolean));
  return ROLE_DISCOVERY_TERMS.some((term) => normalized === term || normalized.includes(`${term}-`) || normalized.includes(`-${term}`) || parts.has(term));
}

async function fetchMessageHistory(channel, limit = DEEP_HISTORY_LIMIT) {
  const messages = [];
  let before = '';
  const maximum = Math.max(1, Number(limit) || DEEP_HISTORY_LIMIT);

  while (messages.length < maximum) {
    const size = Math.min(100, maximum - messages.length);
    const options = before ? { limit: size, before } : { limit: size };
    const batch = await channel.messages.fetch(options).catch(() => null);
    if (!batch) break;
    const items = valuesOf(batch);
    if (!items.length) break;
    messages.push(...items);
    before = String(items[items.length - 1]?.id || '');
    if (!before || items.length < size) break;
  }
  return messages;
}

function candidateDiscoveryChannels(channels, configuredId = '') {
  const configured = String(configuredId || '');
  return valuesOf(channels)
    .filter((channel) => channel?.isTextBased?.())
    .filter((channel) => String(channel.id) === configured || isRoleDiscoveryChannelName(channel.name));
}

class SelfRoleManager extends BaseSelfRoleManager {
  constructor(options) {
    super(options);
    this.discoveredMenusCache = [];
    this.legacyLocations = new Map();
    this.lastDiscoveryStats = null;
  }

  async scanChannels(channels, roles, limit, seenMessages, menusById, warnings) {
    let scannedMessages = 0;
    let legacyCandidates = 0;
    let reactionCandidates = 0;
    let reactionMapped = 0;
    let reactionAmbiguous = 0;
    const reactionDiagnostics = [];

    for (const channel of channels) {
      const history = await fetchMessageHistory(channel, limit);
      scannedMessages += history.length;
      for (const message of history) {
        const messageId = String(message?.id || '');
        if (!messageId || seenMessages.has(messageId)) continue;
        seenMessages.add(messageId);
        if (isCurrentSelfRoleMessage(message)) continue;

        const hasLegacyButton = messageButtons(message).some((button) => String(button?.custom_id || '').startsWith(LEGACY_SELF_ROLE_BUTTON_PREFIX));
        if (hasLegacyButton) {
          legacyCandidates += 1;
          const menu = discoverLegacySelfRoleMenu(message, roles);
          if (!menu) {
            warnings.push(`Could not safely map legacy button-role menu ${messageId} in #${channel.name || channel.id}; it was left untouched.`);
            continue;
          }
          if (!menusById.has(menu.id)) menusById.set(menu.id, menu);
          this.legacyLocations.set(messageId, String(channel.id));
          continue;
        }

        const reaction = parseReactionRoleMenu(message, roles);
        if (!reaction.candidate) continue;
        reactionCandidates += 1;
        if (reaction.menu) {
          reactionMapped += 1;
          if (!menusById.has(reaction.menu.id)) menusById.set(reaction.menu.id, reaction.menu);
          this.legacyLocations.set(messageId, String(channel.id));
          continue;
        }

        reactionAmbiguous += 1;
        if (reactionDiagnostics.length < 12) {
          const title = String(message?.embeds?.[0]?.title || message?.content || 'untitled').replace(/\s+/g, ' ').slice(0, 80);
          reactionDiagnostics.push(`#${channel.name || channel.id} message=${messageId} title=${JSON.stringify(title)} mapped=${reaction.mapped} unmatched=${reaction.unmatched.join(',') || 'none'}`);
        }
      }
    }
    return { scannedMessages, legacyCandidates, reactionCandidates, reactionMapped, reactionAmbiguous, reactionDiagnostics };
  }

  async discoverLegacyMenus(guild) {
    if (this.discoveredMenusCache.length) {
      return { menus: this.discoveredMenusCache, warnings: [], ...(this.lastDiscoveryStats || {}) };
    }

    const warnings = [];
    const roles = valuesOf(await guild.roles.fetch());
    const channelCollection = await guild.channels.fetch();
    const allText = valuesOf(channelCollection).filter((channel) => channel?.isTextBased?.());
    const primary = candidateDiscoveryChannels(allText, this.config.discord?.rolesChannelId || '');
    const primaryIds = new Set(primary.map((channel) => String(channel.id)));
    const fallback = allText.filter((channel) => !primaryIds.has(String(channel.id)));
    const seenMessages = new Set();
    const menusById = new Map();

    const primaryStats = await this.scanChannels(primary, roles, DEEP_HISTORY_LIMIT, seenMessages, menusById, warnings);
    let fallbackStats = { scannedMessages: 0, legacyCandidates: 0, reactionCandidates: 0, reactionMapped: 0, reactionAmbiguous: 0, reactionDiagnostics: [] };
    if (!menusById.size && fallback.length) {
      fallbackStats = await this.scanChannels(fallback, roles, FALLBACK_HISTORY_LIMIT, seenMessages, menusById, warnings);
    }

    const stats = {
      scannedChannels: primary.length + (!menusById.size ? fallback.length : 0),
      scannedMessages: primaryStats.scannedMessages + fallbackStats.scannedMessages,
      legacyCandidates: primaryStats.legacyCandidates + fallbackStats.legacyCandidates,
      reactionCandidates: primaryStats.reactionCandidates + fallbackStats.reactionCandidates,
      reactionMapped: primaryStats.reactionMapped + fallbackStats.reactionMapped,
      reactionAmbiguous: primaryStats.reactionAmbiguous + fallbackStats.reactionAmbiguous
    };
    this.lastDiscoveryStats = stats;
    this.discoveredMenusCache = [...menusById.values()];

    console.log(`[Nexus Sentinal] legacy self-role discovery: roleChannels=${primary.length} fallbackChannels=${fallback.length} scannedMessages=${stats.scannedMessages} buttonCandidates=${stats.legacyCandidates} reactionCandidates=${stats.reactionCandidates} reactionMapped=${stats.reactionMapped} reactionAmbiguous=${stats.reactionAmbiguous} menus=${this.discoveredMenusCache.length}`);
    for (const diagnostic of [...primaryStats.reactionDiagnostics, ...fallbackStats.reactionDiagnostics].slice(0, 12)) {
      console.warn(`[Nexus Sentinal] reaction-role diagnostic: ${diagnostic}`);
    }
    if (!this.discoveredMenusCache.length) {
      warnings.push(`Legacy self-role discovery scanned ${stats.scannedChannels} text channels / ${stats.scannedMessages} messages; button candidates=${stats.legacyCandidates}, reaction candidates=${stats.reactionCandidates}, safely mapped reaction menus=${stats.reactionMapped}.`);
    }

    return { menus: this.discoveredMenusCache, warnings, ...stats };
  }

  async retireOneLegacyMessage(message, activeMessageIds, legacyMessageIds, warnings) {
    if (!message || activeMessageIds.has(String(message.id))) return { reactionsCleared: 0, buttonsRetired: 0 };
    if (!isLegacySelfRoleMessage(message, legacyMessageIds)) return { reactionsCleared: 0, buttonsRetired: 0 };

    let reactionsCleared = 0;
    let buttonsRetired = 0;
    try {
      if (message.reactions?.removeAll) {
        await message.reactions.removeAll();
        reactionsCleared = 1;
      }
      if (message.author?.id === this.client.user?.id) {
        const cleaned = legacyComponentsRemoved(message.components || []);
        const before = JSON.stringify((message.components || []).map((row) => typeof row?.toJSON === 'function' ? row.toJSON() : row));
        if (JSON.stringify(cleaned) !== before) {
          await message.edit({ components: cleaned, allowedMentions: { parse: [] } });
          buttonsRetired = 1;
        }
      }
    } catch (error) {
      warnings.push(`Legacy role menu ${message.id} could not be fully retired: ${String(error?.message || error)}`);
    }
    return { reactionsCleared, buttonsRetired };
  }

  async retireLegacyMenus(channels, activeMessageIds, legacyMessageIds, warnings) {
    const processed = new Set();
    let reactionsCleared = 0;
    let buttonsRetired = 0;

    for (const messageId of legacyMessageIds.map(String).filter(Boolean)) {
      const preferredChannelId = this.legacyLocations.get(messageId);
      const orderedChannels = [
        ...(preferredChannelId && channels.get(preferredChannelId) ? [channels.get(preferredChannelId)] : []),
        ...[...channels.values()].filter((channel) => String(channel.id) !== preferredChannelId)
      ];
      for (const channel of orderedChannels) {
        try {
          const message = await channel.messages.fetch(messageId);
          const retired = await this.retireOneLegacyMessage(message, activeMessageIds, legacyMessageIds, warnings);
          reactionsCleared += retired.reactionsCleared;
          buttonsRetired += retired.buttonsRetired;
          processed.add(messageId);
          break;
        } catch {}
      }
    }

    for (const channel of channels.values()) {
      const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!recent) continue;
      for (const message of valuesOf(recent)) {
        const messageId = String(message?.id || '');
        if (!messageId || processed.has(messageId)) continue;
        const retired = await this.retireOneLegacyMessage(message, activeMessageIds, legacyMessageIds, warnings);
        reactionsCleared += retired.reactionsCleared;
        buttonsRetired += retired.buttonsRetired;
        if (retired.reactionsCleared || retired.buttonsRetired) processed.add(messageId);
      }
    }

    return { reactionsCleared, buttonsRetired };
  }
}

module.exports = {
  DEEP_HISTORY_LIMIT,
  FALLBACK_HISTORY_LIMIT,
  ROLE_DISCOVERY_TERMS,
  isRoleDiscoveryChannelName,
  fetchMessageHistory,
  candidateDiscoveryChannels,
  SelfRoleManager
};
