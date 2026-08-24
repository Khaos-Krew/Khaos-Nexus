'use strict';

const {
  normalizeSelfRoleMenu,
  normalizedName,
  exactRoleForLabel,
  messageButtons
} = require('./self-role-model.cjs');

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function messageTextParts(message) {
  const parts = [];
  if (message?.content) parts.push(String(message.content));
  for (const embed of message?.embeds || []) {
    if (embed?.title) parts.push(String(embed.title));
    if (embed?.description) parts.push(String(embed.description));
    for (const field of embed?.fields || []) {
      if (field?.name) parts.push(String(field.name));
      if (field?.value) parts.push(String(field.value));
    }
    if (embed?.footer?.text) parts.push(String(embed.footer.text));
  }
  return parts;
}

function messageLines(message) {
  return messageTextParts(message)
    .flatMap((part) => String(part).split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function fullMessageText(message) {
  return messageTextParts(message).join('\n');
}

function messageReactions(message) {
  return valuesOf(message?.reactions?.cache || message?.reactions).filter((reaction) => reaction?.emoji);
}

function emojiTokens(reaction) {
  const name = String(reaction?.emoji?.name || '').trim();
  const id = String(reaction?.emoji?.id || '').trim();
  const animated = Boolean(reaction?.emoji?.animated);
  const tokens = new Set();
  if (name) tokens.add(name);
  if (id && name) {
    tokens.add(`<:${name}:${id}>`);
    if (animated) tokens.add(`<a:${name}:${id}>`);
    tokens.add(`:${name}:`);
  }
  return [...tokens].filter(Boolean);
}

function reactionLabel(reaction) {
  const name = String(reaction?.emoji?.name || '').trim();
  const id = String(reaction?.emoji?.id || '').trim();
  return id ? `:${name}:` : name;
}

function roleMentionId(line) {
  const match = /<@&(\d{5,25})>/.exec(String(line || ''));
  return match?.[1] || '';
}

function cleanReactionLabel(line, tokens = []) {
  let text = String(line || '');
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) text = text.split(token).join(' ');
  text = text.replace(/<@&\d{5,25}>/g, ' ');
  text = text.replace(/^[\s\-–—:|•·►▶→=]+|[\s\-–—:|•·►▶→=]+$/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function roleById(roles, id) {
  return valuesOf(roles).find((role) => String(role?.id || '') === String(id || '')) || null;
}

function roleForReactionLine(line, reaction, roles) {
  const mentionId = roleMentionId(line);
  if (mentionId) return roleById(roles, mentionId);
  const label = cleanReactionLabel(line, emojiTokens(reaction));
  if (!label) return null;

  const direct = exactRoleForLabel(valuesOf(roles), label);
  if (direct) return direct;

  const simplified = label
    .replace(/^react\s+(with|using)\s+/i, '')
    .replace(/^(choose|select|get|remove)\s+/i, '')
    .replace(/\s+(role|roles)$/i, '')
    .trim();
  if (simplified && simplified !== label) return exactRoleForLabel(valuesOf(roles), simplified);
  return null;
}

function lineForReaction(lines, reaction) {
  const tokens = emojiTokens(reaction);
  if (!tokens.length) return '';
  return lines.find((line) => tokens.some((token) => String(line).includes(token))) || '';
}

function nexusFooter(message) {
  return (message?.embeds || [])
    .map((embed) => String(embed?.footer?.text || '').trim())
    .find((text) => /^Khaos Nexus\s*•/i.test(text)) || '';
}

function legacyButtonMenuLooksRelevant(message) {
  if (!message?.author?.bot || !nexusFooter(message) || messageButtons(message).length < 1) return false;
  const text = fullMessageText(message);
  return /\b(game\s*types?|playstyle|games?|notification\s*pings?|name\s*(?:color|colour)|pronouns?|region|timezone|looking\s+for\s+group|content\s+preferences?|platforms?|self[\s-]?roles?|role\s*selection)\b/i.test(text);
}

function serializedEmoji(emoji) {
  if (!emoji) return '';
  const name = String(emoji?.name || '').trim().slice(0, 32);
  const id = String(emoji?.id || '').trim();
  if (id) return { id, ...(name ? { name } : {}), animated: Boolean(emoji?.animated) };
  return name;
}

function buttonEmoji(button) {
  return serializedEmoji(button?.emoji);
}

function colorMenuHint(message, mappedRoles = []) {
  const text = fullMessageText(message);
  if (/\b(name\s*)?(color|colour)s?\b/i.test(text)) return true;
  if (!mappedRoles.length) return false;
  const colored = mappedRoles.filter((role) => Number(role?.color || 0) !== 0).length;
  return colored === mappedRoles.length && /\bname\b/i.test(text);
}

function menuTitle(message, fallback) {
  const title = message?.embeds?.find?.((embed) => embed?.title)?.title;
  return String(title || fallback || 'Choose Your Roles').trim().slice(0, 256);
}

function uniqueMenuId(message, title, prefix) {
  const suffix = String(message?.id || '').slice(-8) || 'legacy';
  const base = normalizedName(title).slice(0, 26) || prefix;
  return `${base}-${suffix}`.slice(0, 40);
}

function exactRoleCandidates(roles, label) {
  const target = normalizedName(label);
  if (!target) return [];
  return valuesOf(roles).filter((role) => normalizedName(role?.name) === target);
}

function logLegacyButtonAmbiguity(message, buttons, roles, unmatched) {
  const unmatchedSet = new Set((unmatched || []).map(String));
  for (const button of buttons) {
    const label = String(button?.label || '').trim();
    if (!unmatchedSet.has(label)) continue;
    const exact = exactRoleCandidates(roles, label).map((role) => ({
      id: String(role.id),
      name: String(role.name),
      position: Number(role.position || 0),
      editable: role.editable !== false,
      managed: Boolean(role.managed)
    }));
    console.warn(`[Nexus Sentinal] legacy-button detail: message=${String(message?.id || '')} label=${JSON.stringify(label)} customId=${JSON.stringify(String(button?.custom_id || ''))} exact=${JSON.stringify(exact)}`);
  }
}

function parseLegacyButtonRoleMenu(message, roles = []) {
  if (!legacyButtonMenuLooksRelevant(message)) return { menu: null, candidate: false, mapped: 0, unmatched: [], source: 'button' };

  const buttons = messageButtons(message);
  const mapped = [];
  const unmatched = [];
  const seenRoles = new Set();

  for (const button of buttons) {
    const label = String(button?.label || '').trim();
    const role = exactRoleForLabel(valuesOf(roles), label);
    if (!label || !role?.id || seenRoles.has(String(role.id))) {
      unmatched.push(label || String(button?.custom_id || 'unlabeled-button'));
      continue;
    }
    seenRoles.add(String(role.id));
    mapped.push({ button, role, label });
  }

  if (!mapped.length) {
    logLegacyButtonAmbiguity(message, buttons, roles, unmatched);
    return { menu: null, candidate: true, mapped: 0, unmatched, source: 'button' };
  }
  if (mapped.length !== buttons.length) {
    logLegacyButtonAmbiguity(message, buttons, roles, unmatched);
    return { menu: null, candidate: true, mapped: mapped.length, unmatched, source: 'button' };
  }

  const kind = colorMenuHint(message, mapped.map((item) => item.role)) ? 'colors' : 'roles';
  const title = menuTitle(message, kind === 'colors' ? 'Choose Your Name Color' : 'Choose Your Roles');
  const description = String(message?.embeds?.[0]?.description || message?.content || 'Use the buttons below to update your roles.').slice(0, 4000);

  const menu = normalizeSelfRoleMenu({
    id: uniqueMenuId(message, title, 'button-role'),
    name: title,
    title,
    description,
    kind,
    mode: kind === 'colors' ? 'exclusive' : 'toggle',
    channelId: String(message?.channelId || message?.channel?.id || ''),
    messageId: String(message?.id || ''),
    options: mapped.map(({ button, role, label }) => ({
      id: normalizedName(role.name).slice(0, 32) || String(role.id),
      label: label.slice(0, 80),
      roleId: String(role.id),
      emoji: buttonEmoji(button),
      ...(kind === 'colors' ? { color: role.hexColor || '#808080' } : {})
    }))
  });

  return { menu, candidate: true, mapped: mapped.length, unmatched: [], source: 'button' };
}

function reactionMenuLooksRelevant(message) {
  const reactions = messageReactions(message);
  if (reactions.length < 1) return false;
  const text = fullMessageText(message);
  if (!text.trim()) return false;

  const hasRoleMention = /<@&\d{5,25}>/.test(text);
  const hasRoleLanguage = /\b(role|roles|self[\s-]?roles?|name\s*(?:color|colour)|colors?|colours?|platforms?|pronouns?|notifications?|game\s*(?:role|roles|access))\b/i.test(text);
  const likelyRoleAuthor = Boolean(message?.author?.bot) || hasRoleMention;
  return likelyRoleAuthor && (hasRoleMention || hasRoleLanguage);
}

function parseReactionRoleMenu(message, roles = []) {
  const legacyButtons = parseLegacyButtonRoleMenu(message, roles);
  if (legacyButtons.candidate) return legacyButtons;
  if (!reactionMenuLooksRelevant(message)) return { menu: null, candidate: false, mapped: 0, unmatched: [], source: 'reaction' };

  const reactions = messageReactions(message);
  const lines = messageLines(message);
  const mapped = [];
  const unmatched = [];
  const seenRoles = new Set();

  for (const reaction of reactions) {
    const line = lineForReaction(lines, reaction);
    if (!line) {
      unmatched.push(reactionLabel(reaction));
      continue;
    }
    const role = roleForReactionLine(line, reaction, roles);
    if (!role?.id || seenRoles.has(String(role.id))) {
      unmatched.push(reactionLabel(reaction));
      continue;
    }
    seenRoles.add(String(role.id));
    mapped.push({ reaction, role });
  }

  if (!mapped.length) return { menu: null, candidate: true, mapped: 0, unmatched, source: 'reaction' };
  if (mapped.length !== reactions.length) return { menu: null, candidate: true, mapped: mapped.length, unmatched, source: 'reaction' };

  const kind = colorMenuHint(message, mapped.map((item) => item.role)) ? 'colors' : 'roles';
  const title = menuTitle(message, kind === 'colors' ? 'Choose Your Name Color' : 'Choose Your Roles');
  const description = String(message?.embeds?.[0]?.description || message?.content || 'Use the buttons below to update your roles.').slice(0, 4000);

  const menu = normalizeSelfRoleMenu({
    id: uniqueMenuId(message, title, 'reaction'),
    name: title,
    title,
    description,
    kind,
    mode: kind === 'colors' ? 'exclusive' : 'toggle',
    channelId: String(message?.channelId || message?.channel?.id || ''),
    messageId: String(message?.id || ''),
    options: mapped.map(({ reaction, role }) => ({
      id: normalizedName(role.name).slice(0, 32) || String(role.id),
      label: String(role.name || 'Role').slice(0, 80),
      roleId: String(role.id),
      emoji: serializedEmoji(reaction?.emoji),
      ...(kind === 'colors' ? { color: role.hexColor || '#808080' } : {})
    }))
  });

  return { menu, candidate: true, mapped: mapped.length, unmatched: [], source: 'reaction' };
}

module.exports = {
  valuesOf,
  messageTextParts,
  messageLines,
  fullMessageText,
  messageReactions,
  emojiTokens,
  reactionLabel,
  roleMentionId,
  cleanReactionLabel,
  roleForReactionLine,
  lineForReaction,
  nexusFooter,
  legacyButtonMenuLooksRelevant,
  serializedEmoji,
  buttonEmoji,
  colorMenuHint,
  menuTitle,
  uniqueMenuId,
  exactRoleCandidates,
  parseLegacyButtonRoleMenu,
  reactionMenuLooksRelevant,
  parseReactionRoleMenu
};
