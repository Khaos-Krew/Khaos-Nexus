'use strict';

const MAX_SELF_ROLE_MENUS = 40;
const MAX_SELF_ROLE_OPTIONS = 25;
const SELF_ROLE_BUTTON_PREFIX = 'nexus:self-role:';
const LEGACY_SELF_ROLE_BUTTON_PREFIX = 'kn-role:';
const SELF_ROLE_MARKER_PREFIX = 'nexus-sentinal:self-role:';
const LEGACY_ROLE_FOOTERS = new Set([
  'Khaos Nexus • One color at a time',
  'Khaos Nexus • Click again to remove a role'
]);
const BUTTON_STYLES = Object.freeze({ primary: 1, secondary: 2, success: 3, danger: 4 });

function cleanText(value, max = 100, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function normalizedName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function safeId(value, prefix = 'item') {
  const raw = String(value || '').trim();
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(raw)) return raw;
  const slug = normalizedName(raw).slice(0, 32);
  return slug || `${prefix}-${Date.now().toString(36)}`;
}

function snowflake(value) {
  const raw = String(value || '').trim();
  return /^\d{5,25}$/.test(raw) ? raw : '';
}

function hexColor(value, fallback = '#e3264f') {
  const raw = String(value || '').trim();
  const normalized = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toLowerCase() : fallback;
}

function normalizeSelfRoleEmoji(option = {}) {
  const source = option?.emoji && typeof option.emoji === 'object' ? option.emoji : null;
  const name = cleanText(source?.name ?? option.emojiName ?? option.emoji, 32);
  const id = snowflake(source?.id ?? option.emojiId ?? option.emoji_id);
  const animated = Boolean(source?.animated ?? option.emojiAnimated ?? option.emoji_animated);
  return {
    emoji: name,
    emojiId: id,
    emojiAnimated: Boolean(id && animated)
  };
}

function renderSelfRoleEmoji(option = {}) {
  const name = cleanText(option.emoji, 32);
  const id = snowflake(option.emojiId || option.emoji_id);
  if (id) {
    return {
      id,
      ...(name ? { name } : {}),
      ...(option.emojiAnimated ? { animated: true } : {})
    };
  }
  return name ? { name } : null;
}

function normalizeSelfRoleOption(option = {}, kind = 'roles') {
  const label = cleanText(option.label || option.name, 80);
  const roleId = snowflake(option.roleId || option.role_id);
  if (!label || !roleId) return null;
  return {
    id: safeId(option.id || label, 'option'),
    label,
    roleId,
    description: cleanText(option.description, 100),
    ...normalizeSelfRoleEmoji(option),
    style: Object.prototype.hasOwnProperty.call(BUTTON_STYLES, option.style) ? option.style : 'secondary',
    ...(kind === 'colors' ? { color: hexColor(option.color || '#808080', '#808080') } : {})
  };
}

function normalizeSelfRoleMenu(menu = {}) {
  const id = safeId(menu.id || menu.name || menu.title, 'menu');
  const kind = menu.kind === 'colors' || /\bcolou?r(s)?\b/i.test(`${menu.id || ''} ${menu.name || ''} ${menu.title || ''}`) ? 'colors' : 'roles';
  const options = [];
  const seen = new Set();
  for (const source of Array.isArray(menu.options) ? menu.options : []) {
    const option = normalizeSelfRoleOption(source, kind);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    options.push(option);
  }
  return {
    id,
    name: cleanText(menu.name, 80, kind === 'colors' ? 'Name Colors' : 'Role Menu'),
    kind,
    mode: kind === 'colors' || menu.mode === 'exclusive' ? 'exclusive' : 'toggle',
    title: cleanText(menu.title, 256, kind === 'colors' ? 'Choose Your Name Color' : 'Choose Your Roles'),
    description: cleanText(menu.description, 4000, 'Use the buttons below to update your roles.'),
    color: hexColor(menu.color),
    guildId: snowflake(menu.guildId),
    channelId: snowflake(menu.channelId),
    messageId: snowflake(menu.messageId),
    enabled: menu.enabled !== false,
    options: options.slice(0, MAX_SELF_ROLE_OPTIONS)
  };
}

function configuredSelfRoleMenus(config = {}) {
  const inputs = [
    ...(Array.isArray(config.discordAutomation?.roleMenus) ? config.discordAutomation.roleMenus : []),
    ...(Array.isArray(config.discord?.selfRoleMenus) ? config.discord.selfRoleMenus : []),
    ...(Array.isArray(config.discord?.roleMenus) ? config.discord.roleMenus : [])
  ];
  const menus = new Map();
  for (const source of inputs) {
    const menu = normalizeSelfRoleMenu(source);
    if (!menu.enabled || !menu.options.length) continue;
    menus.set(menu.id, menu);
  }
  return [...menus.values()].slice(0, MAX_SELF_ROLE_MENUS);
}

function selfRoleButtonId(menuId, optionId) {
  const id = `${SELF_ROLE_BUTTON_PREFIX}${safeId(menuId, 'menu')}:${safeId(optionId, 'option')}`;
  if (id.length > 100) throw new Error('Self-role button identifier is too long.');
  return id;
}

function parseSelfRoleButton(value) {
  const raw = String(value || '');
  let match = /^nexus:self-role:([A-Za-z0-9_-]{1,40}):([A-Za-z0-9_-]{1,40})$/.exec(raw);
  if (match) return { menuId: match[1], optionId: match[2], legacy: false };
  match = /^kn-role:([A-Za-z0-9_-]{1,80}):([A-Za-z0-9_-]{1,80})$/.exec(raw);
  if (match) return { menuId: match[1], optionId: match[2], legacy: true };
  return null;
}

function selfRoleMutation(menuInput, optionId, currentRoles = []) {
  const menu = normalizeSelfRoleMenu(menuInput);
  const option = menu.options.find((item) => item.id === optionId);
  if (!option) throw new Error('That role option is no longer configured.');
  const current = new Set((Array.isArray(currentRoles) ? currentRoles : []).map(String));
  const siblings = menu.options.map((item) => item.roleId).filter((id) => id !== option.roleId);

  if (current.has(option.roleId)) {
    return {
      action: 'removed',
      addRoleId: '',
      removeRoleIds: menu.mode === 'exclusive'
        ? [option.roleId, ...siblings.filter((id) => current.has(id))]
        : [option.roleId],
      option
    };
  }

  const siblingSelected = menu.mode === 'exclusive' && siblings.some((id) => current.has(id));
  return {
    action: siblingSelected ? 'replaced' : 'added',
    addRoleId: option.roleId,
    removeRoleIds: menu.mode === 'exclusive' ? siblings.filter((id) => current.has(id)) : [],
    option
  };
}

function renderSelfRoleMenu(menuInput) {
  const menu = normalizeSelfRoleMenu(menuInput);
  const rows = [];
  for (let offset = 0; offset < menu.options.length; offset += 5) {
    rows.push({
      type: 1,
      components: menu.options.slice(offset, offset + 5).map((option) => {
        const emoji = renderSelfRoleEmoji(option);
        return {
          type: 2,
          style: BUTTON_STYLES[option.style],
          label: option.label,
          custom_id: selfRoleButtonId(menu.id, option.id),
          ...(emoji ? { emoji } : {})
        };
      })
    });
  }
  return {
    embeds: [{
      title: menu.title,
      description: menu.description,
      color: Number.parseInt(menu.color.slice(1), 16),
      footer: { text: `${SELF_ROLE_MARKER_PREFIX}${menu.id}:v1` }
    }],
    components: rows,
    allowedMentions: { parse: [] }
  };
}

function rawComponent(component) {
  return typeof component?.toJSON === 'function' ? component.toJSON() : component;
}

function messageButtons(message) {
  const buttons = [];
  for (const rowSource of message?.components || []) {
    const row = rawComponent(rowSource);
    for (const itemSource of row?.components || []) {
      const item = rawComponent(itemSource);
      if (Number(item?.type) === 2) buttons.push(item);
    }
  }
  return buttons;
}

function messageFooterTexts(message) {
  return (message?.embeds || []).map((embed) => String(embed?.footer?.text || '')).filter(Boolean);
}

function isCurrentSelfRoleMessage(message) {
  return messageFooterTexts(message).some((text) => text.startsWith(SELF_ROLE_MARKER_PREFIX));
}

function isLegacySelfRoleMessage(message, legacyMessageIds = []) {
  if (!message) return false;
  if (isCurrentSelfRoleMessage(message)) return false;
  if (legacyMessageIds.map(String).includes(String(message.id || ''))) return true;
  if (messageButtons(message).some((button) => String(button.custom_id || '').startsWith(LEGACY_SELF_ROLE_BUTTON_PREFIX))) return true;
  return messageFooterTexts(message).some((text) => LEGACY_ROLE_FOOTERS.has(text));
}

function exactRoleForLabel(roles = [], label = '') {
  const wanted = String(label || '').trim().toLowerCase();
  const slug = normalizedName(label);
  const exact = roles.filter((role) => String(role?.name || '').trim().toLowerCase() === wanted);
  if (exact.length === 1) return exact[0];
  const normalized = roles.filter((role) => normalizedName(role?.name) === slug);
  return normalized.length === 1 ? normalized[0] : null;
}

function discoverLegacySelfRoleMenu(message, roles = []) {
  const legacyButtons = messageButtons(message)
    .map((button) => ({ button, parsed: parseSelfRoleButton(button.custom_id) }))
    .filter((item) => item.parsed?.legacy);
  if (!legacyButtons.length) return null;

  const menuIds = [...new Set(legacyButtons.map((item) => item.parsed.menuId))];
  if (menuIds.length !== 1) return null;
  const menuId = menuIds[0];
  const firstEmbed = message?.embeds?.[0] || {};
  const footer = String(firstEmbed?.footer?.text || '');
  const kind = footer === 'Khaos Nexus • One color at a time' || /\bcolou?r(s)?\b/i.test(`${menuId} ${firstEmbed?.title || ''}`) ? 'colors' : 'roles';
  const options = [];

  for (const { button, parsed } of legacyButtons) {
    const label = cleanText(button.label, 80);
    const role = exactRoleForLabel(roles, label);
    if (!label || !role?.id) continue;
    const emoji = button?.emoji
      ? {
          name: String(button.emoji.name || '').slice(0, 32),
          id: String(button.emoji.id || ''),
          animated: Boolean(button.emoji.animated)
        }
      : '';
    options.push({
      id: parsed.optionId,
      label,
      roleId: String(role.id),
      emoji,
      style: 'secondary',
      ...(kind === 'colors' ? { color: role.hexColor || '#808080' } : {})
    });
  }
  if (!options.length) return null;

  return normalizeSelfRoleMenu({
    id: menuId,
    kind,
    mode: kind === 'colors' ? 'exclusive' : 'toggle',
    name: cleanText(firstEmbed?.title, 80, kind === 'colors' ? 'Name Colors' : menuId),
    title: cleanText(firstEmbed?.title, 256, kind === 'colors' ? 'Choose Your Name Color' : 'Choose Your Roles'),
    description: cleanText(firstEmbed?.description, 4000, 'Use the buttons below to update your roles.'),
    channelId: String(message?.channelId || message?.channel?.id || ''),
    messageId: String(message?.id || ''),
    options
  });
}

function planColorRolePositions({ colorRoles = [], ordinaryRoles = [], staffRoles = [], botPosition = 0 } = {}) {
  const colors = [...colorRoles].filter((role) => role?.id).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const botCeiling = Number(botPosition || 0);
  if (!colors.length) return { positions: [], skipped: true, reason: 'no-color-roles' };
  if (botCeiling <= 1) return { positions: [], skipped: true, reason: 'missing-bot-ceiling' };

  const staffBelowBot = staffRoles
    .map((role) => Number(role?.position || 0))
    .filter((position) => position > 0 && position < botCeiling);
  const staffFloor = staffBelowBot.length ? Math.min(...staffBelowBot) : botCeiling;
  const ceiling = Math.min(botCeiling - 1, staffFloor - 1);
  const start = ceiling - colors.length + 1;
  const ordinaryMax = ordinaryRoles.length ? Math.max(...ordinaryRoles.map((role) => Number(role?.position || 0))) : 0;

  if (ceiling < colors.length || start <= 0) return { positions: [], skipped: true, reason: 'insufficient-safe-space' };
  if (start <= ordinaryMax) return { positions: [], skipped: true, reason: 'ordinary-role-overlap' };

  return {
    positions: colors.map((role, index) => ({ role: String(role.id), position: start + index })),
    skipped: false,
    reason: ''
  };
}

module.exports = {
  MAX_SELF_ROLE_MENUS,
  MAX_SELF_ROLE_OPTIONS,
  SELF_ROLE_BUTTON_PREFIX,
  LEGACY_SELF_ROLE_BUTTON_PREFIX,
  SELF_ROLE_MARKER_PREFIX,
  LEGACY_ROLE_FOOTERS,
  BUTTON_STYLES,
  cleanText,
  normalizedName,
  safeId,
  normalizeSelfRoleEmoji,
  renderSelfRoleEmoji,
  normalizeSelfRoleOption,
  normalizeSelfRoleMenu,
  configuredSelfRoleMenus,
  selfRoleButtonId,
  parseSelfRoleButton,
  selfRoleMutation,
  renderSelfRoleMenu,
  messageButtons,
  isCurrentSelfRoleMessage,
  isLegacySelfRoleMessage,
  exactRoleForLabel,
  discoverLegacySelfRoleMenu,
  planColorRolePositions
};
