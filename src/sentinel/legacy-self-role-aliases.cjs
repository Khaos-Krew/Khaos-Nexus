'use strict';

const { normalizedName, exactRoleForLabel } = require('./self-role-model.cjs');

const LEGACY_ROLE_MENU_TITLES = Object.freeze([
  'Game Types & Playstyle',
  'Games',
  'Notification Pings',
  'Name Color — Page 1',
  'Name Color — Page 2',
  'Pronouns',
  'Playstyle',
  'Region / Timezone',
  'Looking For Group',
  'Content Preferences',
  'Platforms'
]);

const LEGACY_ROLE_MENU_TITLE_KEYS = new Set(LEGACY_ROLE_MENU_TITLES.map(normalizedName));

const EXPLICIT_ALIASES = Object.freeze({
  [normalizedName('Content Preferences')]: Object.freeze({
    [normalizedName('Fashion')]: 'Screenshots / Fashion',
    [normalizedName('Lore')]: 'Lore Discussion'
  }),
  [normalizedName('Notification Pings')]: Object.freeze({
    [normalizedName('Events')]: 'Events Ping',
    [normalizedName('Giveaways')]: 'Giveaways Ping',
    [normalizedName('Ko-fi / Supporter Updates')]: 'Supporter Updates'
  }),
  [normalizedName('Games')]: Object.freeze({
    [normalizedName('Ark Survival Ascended')]: 'ARK: Survival Ascended Access',
    [normalizedName('Warframe')]: 'Warframe Access',
    [normalizedName('Minecraft')]: 'Minecraft Access',
    [normalizedName('Dungeons & Dragons')]: 'Nexus D&D Access'
  }),
  [normalizedName('Game Types & Playstyle')]: Object.freeze({
    [normalizedName('MMO / RPG')]: 'MMO / Online RPG',
    [normalizedName('Modded MC')]: 'Modded Minecraft',
    [normalizedName('Grinder')]: 'Endgame Grinder',
    [normalizedName('Helper')]: 'Mentor / Helper'
  })
});

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function isLegacyRoleMenuTitle(title) {
  return LEGACY_ROLE_MENU_TITLE_KEYS.has(normalizedName(title));
}

function messageTitle(message) {
  return String(message?.embeds?.find?.((embed) => embed?.title)?.title || message?.content || '').trim();
}

function messageHasButtons(message) {
  return (message?.components || []).some((rowSource) => {
    const row = typeof rowSource?.toJSON === 'function' ? rowSource.toJSON() : rowSource;
    return (row?.components || []).some((itemSource) => {
      const item = typeof itemSource?.toJSON === 'function' ? itemSource.toJSON() : itemSource;
      return Number(item?.type) === 2;
    });
  });
}

function messageText(message) {
  const parts = [String(message?.content || '')];
  for (const embed of message?.embeds || []) {
    parts.push(String(embed?.title || ''), String(embed?.description || ''), String(embed?.footer?.text || ''));
    for (const field of embed?.fields || []) parts.push(String(field?.name || ''), String(field?.value || ''));
  }
  return parts.join('\n');
}

function shouldInspectLegacyRoleMessage(message) {
  if (messageHasButtons(message)) return isLegacyRoleMenuTitle(messageTitle(message));
  const text = messageText(message);
  if (!text.trim()) return false;
  const hasRoleMention = /<@&\d{5,25}>/.test(text);
  const hasRoleLanguage = /\b(role|roles|self[\s-]?roles?|name\s*(?:color|colour)|colors?|colours?|platforms?|pronouns?|notifications?|game\s*(?:role|roles|access))\b/i.test(text);
  return (Boolean(message?.author?.bot) || hasRoleMention) && (hasRoleMention || hasRoleLanguage);
}

function canonicalLegacyRoleName(menuTitle, label) {
  const titleKey = normalizedName(menuTitle);
  const labelKey = normalizedName(label);
  if (!titleKey || !labelKey || !LEGACY_ROLE_MENU_TITLE_KEYS.has(titleKey)) return '';
  if (titleKey === normalizedName('Name Color — Page 1') || titleKey === normalizedName('Name Color — Page 2')) {
    return `Color: ${String(label || '').trim()}`;
  }
  return EXPLICIT_ALIASES[titleKey]?.[labelKey] || '';
}

function resolveLegacyRole(menuTitle, label, roles = []) {
  const direct = exactRoleForLabel(roles, label);
  if (direct) return { role: direct, source: 'exact', target: String(direct.name || label) };
  const target = canonicalLegacyRoleName(menuTitle, label);
  if (!target) return { role: null, source: 'unresolved', target: '' };
  const aliased = exactRoleForLabel(roles, target);
  return aliased
    ? { role: aliased, source: 'alias', target }
    : { role: null, source: 'alias-unresolved', target };
}

function roleHexColor(role) {
  const direct = String(role?.hexColor || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(direct)) return direct.toLowerCase();
  const numeric = Number(role?.color);
  if (!Number.isFinite(numeric)) return '';
  return `#${(numeric >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}

function augmentedRolesForLegacyMenu(menuTitle, labels = [], roles = []) {
  const original = valuesOf(roles);
  const augmented = [...original];
  const usedIds = new Set();
  for (const label of labels) {
    const resolved = resolveLegacyRole(menuTitle, label, original);
    if (!resolved.role || resolved.source !== 'alias') continue;
    const key = `${resolved.role.id}:${normalizedName(label)}`;
    if (usedIds.has(key)) continue;
    usedIds.add(key);
    const numericColor = Number(resolved.role.color);
    const hexColor = roleHexColor(resolved.role);
    augmented.push({
      ...resolved.role,
      id: String(resolved.role.id),
      name: String(label || '').trim(),
      ...(Number.isFinite(numericColor) ? { color: numericColor } : {}),
      ...(hexColor ? { hexColor } : {}),
      __nexusLegacyAlias: resolved.target
    });
  }
  return augmented;
}

module.exports = {
  LEGACY_ROLE_MENU_TITLES,
  EXPLICIT_ALIASES,
  valuesOf,
  isLegacyRoleMenuTitle,
  messageTitle,
  messageHasButtons,
  messageText,
  shouldInspectLegacyRoleMessage,
  canonicalLegacyRoleName,
  resolveLegacyRole,
  roleHexColor,
  augmentedRolesForLegacyMenu
};
