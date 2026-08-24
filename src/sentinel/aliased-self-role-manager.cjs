'use strict';

const { SelfRoleManager: DeepSelfRoleManager, fetchMessageHistory } = require('./deep-self-role-manager.cjs');
const { valuesOf } = require('./self-role-manager.cjs');
const {
  LEGACY_SELF_ROLE_BUTTON_PREFIX,
  messageButtons,
  isCurrentSelfRoleMessage,
  discoverLegacySelfRoleMenu,
  normalizedName
} = require('./self-role-model.cjs');
const { parseReactionRoleMenu } = require('./reaction-self-role-model.cjs');
const { unmatchedCandidateSummary } = require('./legacy-role-diagnostics.cjs');
const {
  messageTitle,
  shouldInspectLegacyRoleMessage,
  augmentedRolesForLegacyMenu
} = require('./legacy-self-role-aliases.cjs');

function exactRoleCandidates(label, roles = []) {
  const wanted = String(label || '').trim().toLowerCase();
  const slug = normalizedName(label);
  return valuesOf(roles).filter((role) => {
    const name = String(role?.name || '').trim();
    return name.toLowerCase() === wanted || normalizedName(name) === slug;
  });
}

function blockedButtonSummary(message, unmatched = [], roles = [], maxLabels = 20) {
  const wanted = new Set((Array.isArray(unmatched) ? unmatched : []).map((label) => String(label)));
  return messageButtons(message)
    .filter((button) => wanted.has(String(button?.label || '')))
    .slice(0, maxLabels)
    .map((button) => {
      const label = String(button?.label || '');
      const customId = String(button?.custom_id || '').slice(0, 100);
      const candidates = exactRoleCandidates(label, roles).slice(0, 5).map((role) => {
        const id = String(role?.id || '');
        const position = Number(role?.position ?? role?.rawPosition ?? -1);
        const editable = role?.editable === false ? 'no' : role?.editable === true ? 'yes' : '?';
        const managed = role?.managed === true ? 'yes' : 'no';
        return `${role.name}#${id}:pos=${position}:editable=${editable}:managed=${managed}`;
      });
      return `${label}{id=${JSON.stringify(customId)}, exact=${candidates.length ? `[${candidates.join(' | ')}]` : '[none]'}}`;
    })
    .join('; ');
}

class SelfRoleManager extends DeepSelfRoleManager {
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
        if (!shouldInspectLegacyRoleMessage(message)) continue;

        const title = messageTitle(message) || 'untitled';
        const labels = messageButtons(message).map((button) => String(button?.label || '').trim()).filter(Boolean);
        const parseRoles = augmentedRolesForLegacyMenu(title, labels, roles);

        const hasLegacyButton = messageButtons(message).some((button) => String(button?.custom_id || '').startsWith(LEGACY_SELF_ROLE_BUTTON_PREFIX));
        if (hasLegacyButton) {
          legacyCandidates += 1;
          const menu = discoverLegacySelfRoleMenu(message, parseRoles);
          if (!menu) {
            warnings.push(`Could not safely map legacy button-role menu ${messageId} in #${channel.name || channel.id}; it was left untouched.`);
            continue;
          }
          if (!menusById.has(menu.id)) menusById.set(menu.id, menu);
          this.legacyLocations.set(messageId, String(channel.id));
          continue;
        }

        const reaction = parseReactionRoleMenu(message, parseRoles);
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
          const near = unmatchedCandidateSummary(reaction.unmatched, roles, 20);
          const blocked = blockedButtonSummary(message, reaction.unmatched, roles, 20);
          reactionDiagnostics.push(`#${channel.name || channel.id} message=${messageId} title=${JSON.stringify(title.replace(/\s+/g, ' ').slice(0, 80))} mapped=${reaction.mapped} unmatched=${reaction.unmatched.join(',') || 'none'} near=${JSON.stringify(near || 'none')} blocked=${JSON.stringify(blocked || 'none')}`);
        }
      }
    }

    return {
      scannedMessages,
      legacyCandidates,
      reactionCandidates,
      reactionMapped,
      reactionAmbiguous,
      reactionDiagnostics
    };
  }
}

module.exports = {
  exactRoleCandidates,
  blockedButtonSummary,
  SelfRoleManager
};
