'use strict';

const { upsertEmbed, embedFooter } = require('../panel-message.cjs');
const { VANGUARD_STYLE, assetPath } = require('./style.cjs');

const BRAND = 'Many Worlds One Nexus';
const DISCLAIMER = 'Not affiliated with or endorsed by Bungie';
const DISCLAIMER_LINE = `-# ${DISCLAIMER}`;
const PANEL_VERSION = 'v1';

function footerKey(panelId) {
  const id = String(panelId || '');
  if (id === 'weekly-reset') return 'reset';
  if (id === 'lfg-board') return 'lfg';
  if (id === 'clan' || id.startsWith('clan:')) return 'clan';
  if (id === 'xur' || id === 'status') return id;
  const stripped = id.replace(/-/g, '');
  return stripped || 'panel';
}

function panelFooter(panelId) {
  return `${BRAND} • ${footerKey(panelId)}`;
}

function legacyFooter(panelId) {
  return `${BRAND} • Nexus Vanguard • ${panelId} • ${PANEL_VERSION} • ${DISCLAIMER}`;
}

function postFooter() {
  return BRAND;
}

function visualMode(panelId) {
  return footerKey(panelId) === 'reset' ? 'banner' : 'icon';
}

function appendDisclaimer(description, { maxLines = 0 } = {}) {
  const rows = String(description || '').split('\n').filter((row) => row !== DISCLAIMER_LINE);
  while (rows.length && rows[rows.length - 1] === '') rows.pop();
  const cap = maxLines > 0 ? Math.max(0, maxLines - 1) : rows.length;
  const body = rows.slice(0, cap);
  body.push(DISCLAIMER_LINE);
  return body.join('\n').slice(0, 4000);
}

function messageBlob(message) {
  const embed = message?.embeds?.[0] || {};
  const data = embed.data || embed;
  const fields = Array.isArray(data.fields) ? data.fields : [];
  return [data.title, data.description, ...fields.map((field) => `${field?.name || ''}\n${field?.value || ''}`)].join('\n');
}

function ownsFooter(message, botId, panelId) {
  const author = String(message?.author?.id || '');
  if (!botId || author !== String(botId)) return false;
  const text = embedFooter(message);
  const id = String(panelId || '');
  if (!text) return false;
  if (text === legacyFooter(id)) return true;
  if (text === id && id.startsWith(`${BRAND} •`)) return true;
  if (text !== panelFooter(id)) return false;
  if (id.startsWith('clan:')) {
    const groupId = id.slice('clan:'.length);
    if (!groupId) return true;
    return new RegExp(`(^|\\D)${groupId}(\\D|$)`).test(messageBlob(message));
  }
  return true;
}

function authorObject(client) {
  const user = client?.user;
  const name = user?.displayName || user?.globalName || user?.username || VANGUARD_STYLE.name;
  const author = { name: String(name).slice(0, 256) };
  const iconURL = avatarUrl(user);
  if (iconURL) author.icon_url = iconURL;
  return author;
}

function avatarUrl(user) {
  if (typeof user?.displayAvatarURL !== 'function') return '';
  try {
    return String(user.displayAvatarURL({ extension: 'png', size: 128 }) || '');
  } catch {
    return '';
  }
}

function footerObject(client, text) {
  const footer = { text: String(text || BRAND).slice(0, 2048) };
  const iconURL = avatarUrl(client?.user);
  if (iconURL) footer.icon_url = iconURL;
  return footer;
}

function applyChrome(embed, { client, footerText, mode } = {}) {
  const next = {
    ...(embed || {}),
    color: VANGUARD_STYLE.color,
    timestamp: new Date().toISOString(),
    author: authorObject(client),
    footer: footerObject(client, footerText || embed?.footer?.text || postFooter())
  };
  if (Array.isArray(next.fields) && !next.fields.length) delete next.fields;
  if (mode === 'banner') {
    next.image = { url: `attachment://${VANGUARD_STYLE.bannerFile}` };
    delete next.thumbnail;
  } else if (mode === 'icon') {
    next.thumbnail = { url: `attachment://${VANGUARD_STYLE.iconFile}` };
    if (String(next.image?.url || '').includes(VANGUARD_STYLE.bannerFile)) delete next.image;
  }
  return next;
}

function attachmentList(message) {
  const raw = message?.attachments;
  if (!raw) return [];
  if (typeof raw.values === 'function') return [...raw.values()];
  if (Array.isArray(raw)) return raw;
  return [];
}

function fileNames(mode) {
  if (mode === 'banner') return [VANGUARD_STYLE.bannerFile];
  if (mode === 'icon') return [VANGUARD_STYLE.iconFile];
  return [];
}

function withAssets(payload, message, mode) {
  const names = fileNames(mode);
  if (!names.length) return payload;
  const keep = [];
  const files = [];
  for (const name of names) {
    const found = attachmentList(message).find((file) => (file?.name || file?.filename) === name);
    if (found?.id) keep.push({ id: found.id });
    else files.push({ attachment: assetPath(name), name });
  }
  const next = { ...(payload || {}) };
  if (message) {
    next.attachments = keep;
    if (files.length) next.files = files;
    else delete next.files;
  } else if (files.length) {
    next.files = files;
  }
  return next;
}

const CLAN_LABEL = 'Khaos Nexus clan';

function clanJoinLine(groupId) {
  return `Join: https://www.bungie.net/en/ClanV2/Index?groupId=${groupId}`;
}

function ensureClanMarker(panelId, description) {
  const id = String(panelId || '');
  if (!id.startsWith('clan:')) return description;
  const groupId = id.slice('clan:'.length);
  if (!groupId) return description;
  const stripped = String(description || '')
    .split('\n')
    .filter((line) => line.trim() !== `Group ${groupId}`)
    .join('\n')
    .trim();
  if (stripped.includes(groupId)) return stripped.slice(0, 4000);
  let text = stripped;
  if (!text.includes(CLAN_LABEL)) text = text ? `${CLAN_LABEL}\n${text}` : CLAN_LABEL;
  const join = clanJoinLine(groupId);
  if (/^Join:/m.test(text)) text = text.replace(/^Join:.*$/m, join);
  else text = text ? `${text}\n${join}` : join;
  return text.slice(0, 4000);
}

async function upsertOwnedPanel(client, { channelId, messageId, panelId, embed, botId } = {}) {
  const footer = panelFooter(panelId);
  const ownerId = String(botId || client?.user?.id || '');
  const mode = visualMode(panelId);
  const body = {
    embeds: [{
      ...(embed || {}),
      description: appendDisclaimer(ensureClanMarker(panelId, embed?.description)),
      footer: { text: footer }
    }],
    allowedMentions: { parse: [] }
  };
  return upsertEmbed(client, channelId, messageId, body, {
    botId: ownerId,
    matches: (message) => ownsFooter(message, ownerId, panelId),
    banner: false,
    prepare: (message, payload) => withAssets({
      ...payload,
      embeds: (payload?.embeds || []).map((row) => applyChrome(row, {
        client,
        footerText: footer,
        mode
      }))
    }, message, mode)
  });
}

function degradedEmbed({ title, detail, asOf } = {}) {
  const when = String(asOf || 'unknown');
  const extra = String(detail || 'Last good content is not available yet.');
  return {
    title: title || 'Status',
    description: `Bungie data unavailable (as of ${when}).\n${extra}`.slice(0, 4000)
  };
}

module.exports = {
  BRAND,
  DISCLAIMER,
  DISCLAIMER_LINE,
  PANEL_VERSION,
  VANGUARD_STYLE,
  footerKey,
  panelFooter,
  legacyFooter,
  postFooter,
  visualMode,
  appendDisclaimer,
  ownsFooter,
  applyChrome,
  withAssets,
  upsertOwnedPanel,
  degradedEmbed,
  ensureClanMarker,
  CLAN_LABEL
};
