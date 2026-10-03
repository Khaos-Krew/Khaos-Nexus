'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MOTTO = 'Many Worlds One Nexus';
const BRAND_DIR = path.join(__dirname, 'brand-assets');
const LEGACY_ASSET_DIR = path.join(__dirname, '../game-bots/assets');
const SOFT_LINE_CAP = 5;
const LIST_LINE_CAP = 8;
const FIELD_CAP = 6;
const INLINE_ROW = 3;

const HEX = Object.freeze({
  sentinal: '#C40018',
  cephalon: '#00B4D8',
  ascended: '#6B8E23',
  sanctuary: '#8F0012',
  vanguard: '#AEB4BD',
  craft: '#3FA34D',
  shop: '#D4A017',
  creator: '#7B2CBF',
  error: '#FF1735'
});

function colorOf(hex) {
  return Number.parseInt(String(hex).replace('#', ''), 16);
}

const BOT_STYLE = Object.freeze({
  sentinal: Object.freeze({ name: 'Nexus Sentinal', color: colorOf(HEX.sentinal), iconFile: null, bannerFile: null }),
  cephalon: Object.freeze({ name: 'Cephalon Nexus', color: colorOf(HEX.cephalon), iconFile: 'icon-cephalon.png', bannerFile: 'cephalon-panel-banner.png' }),
  ascended: Object.freeze({ name: 'Nexus Ascended', color: colorOf(HEX.ascended), iconFile: null, bannerFile: null }),
  sanctuary: Object.freeze({ name: 'Sanctuary Nexus', color: colorOf(HEX.sanctuary), iconFile: null, bannerFile: null }),
  vanguard: Object.freeze({ name: 'Nexus Vanguard', color: colorOf(HEX.vanguard), iconFile: null, bannerFile: null }),
  craft: Object.freeze({ name: 'Nexus Craft', color: colorOf(HEX.craft), iconFile: null, bannerFile: null }),
  shop: Object.freeze({ name: 'Nexus Shop', color: colorOf(HEX.shop), iconFile: null, bannerFile: null }),
  creator: Object.freeze({ name: 'Content Creators', color: colorOf(HEX.creator), iconFile: null, bannerFile: null }),
  error: Object.freeze({ name: 'Error', color: colorOf(HEX.error), iconFile: null, bannerFile: null })
});

// Legacy WebP banners stay until those bots are restyled. Cephalon uses the PNG.
const BANNERS = Object.freeze({
  cephalon: 'cephalon-panel-banner.png',
  ascended: 'ascended-banner.webp',
  sanctuary: 'sanctuary-banner.webp',
  sentinal: 'sentinal-banner.webp'
});

const PANEL_BOTS = Object.freeze({
  fissures: 'cephalon',
  clanApplications: 'cephalon',
  cephalonWelcome: 'cephalon',
  cephalonEvent: 'cephalon',
  warframeEvents: 'cephalon',
  warframeAlerts: 'cephalon',
  warframeSortie: 'cephalon',
  warframeArbitration: 'cephalon',
  warframeNightwave: 'cephalon',
  warframeVoidTrader: 'cephalon',
  warframeSteelPath: 'cephalon',
  warframeCircuit: 'cephalon',
  warframeDescendia: 'cephalon',
  official: 'ascended',
  ascendedWelcome: 'ascended',
  arkCluster: 'ascended',
  sanctuaryRoles: 'sanctuary'
});

function styleFor(bot) {
  return BOT_STYLE[String(bot || '')] || null;
}

function resolveNamedAsset(name) {
  const file = String(name || '');
  if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) return '';
  const brand = path.join(BRAND_DIR, file);
  if (fs.existsSync(brand)) return brand;
  const legacy = path.join(LEGACY_ASSET_DIR, file);
  if (fs.existsSync(legacy)) return legacy;
  return '';
}

function fileEntry(name) {
  const resolved = resolveNamedAsset(name);
  if (!resolved) return null;
  return { attachment: resolved, name };
}

function brandFiles(bot) {
  const style = styleFor(bot);
  if (!style) return [];
  return [style.bannerFile, style.iconFile].map(fileEntry).filter(Boolean);
}

function bannerFor(bot) {
  const key = String(bot || '');
  const name = BANNERS[key];
  if (!name) return null;
  const resolved = resolveNamedAsset(name);
  if (!resolved) return null;
  return { bot: key, name, path: resolved, url: `attachment://${name}` };
}

function bannerBotForPanel(panel) {
  return PANEL_BOTS[String(panel || '')] || '';
}

function footerText(footerKey) {
  const key = String(footerKey || '').trim();
  if (!key || key === MOTTO) return MOTTO;
  const suffix = key.startsWith(`${MOTTO} • `) ? key.slice(MOTTO.length + 3) : key;
  return `${MOTTO} • ${suffix}`.slice(0, 2048);
}

function trimLine(line) {
  const text = String(line || '').replace(/[ \t]+/g, ' ').trim();
  if (text.length <= 60) return text;
  if (text.length <= 90 && /<t:\d+:[tTdDfFR]>/.test(text)) return text;
  let cut = 59;
  const open = text.lastIndexOf('<', cut);
  const close = text.indexOf('>', open);
  if (open >= 0 && close > cut) cut = open;
  const sliced = text.slice(0, Math.max(1, cut)).trimEnd();
  return `${sliced}…`;
}

function trimFieldValue(value) {
  const lines = String(value || '').split('\n').map(trimLine).filter((line) => line.length);
  if (!lines.length) return '';
  if (lines.length <= LIST_LINE_CAP) return lines.join('\n').slice(0, 1024);
  const hidden = lines.length - (SOFT_LINE_CAP - 1);
  return [...lines.slice(0, SOFT_LINE_CAP - 1), `+${hidden} more`].join('\n').slice(0, 1024);
}

function trimDescription(description) {
  const raw = String(description || '').replace(/\r/g, '').trim();
  if (!raw) return '';
  const lines = raw.split('\n');
  const credits = lines.filter((line) => line.startsWith('-#'));
  const body = lines.filter((line) => !line.startsWith('-#'));
  const credit = credits.slice(0, 1);
  const cap = Math.max(1, 4 - credit.length);
  let kept = body;
  if (body.length > cap) {
    const room = Math.max(1, cap - 1);
    const hidden = body.length - room;
    kept = [...body.slice(0, room), `+${hidden} more`];
  }
  return [...kept, ...credit].join('\n').slice(0, 4096);
}

function layoutFields(fields) {
  const usable = (Array.isArray(fields) ? fields : []).filter((field) => field && field.name && field.value);
  let overflow = 0;
  let capped = usable;
  if (usable.length > FIELD_CAP) {
    overflow = usable.length - (FIELD_CAP - 1);
    capped = usable.slice(0, FIELD_CAP - 1);
  }
  let inlineInRow = 0;
  const next = [];
  for (const field of capped) {
    let inline = Boolean(field.inline);
    if (inline) {
      if (inlineInRow >= INLINE_ROW) {
        inline = false;
        inlineInRow = 0;
      } else inlineInRow += 1;
    } else inlineInRow = 0;
    const value = trimFieldValue(field.value);
    if (!value) continue;
    next.push({
      name: String(field.name).slice(0, 256),
      value,
      inline
    });
  }
  if (overflow > 0 && next.length < FIELD_CAP) {
    next.push({ name: 'More', value: `+${overflow} more`, inline: false });
  }
  return next;
}

function brandEmbed(bot, options = {}) {
  const style = styleFor(bot) || { name: String(bot || 'Nexus'), color: colorOf(HEX.error), iconFile: null, bannerFile: null };
  const avatarUrl = String(options.avatarUrl || '').trim();
  const bannerMode = options.banner === 'auto' ? 'auto' : 'none';
  const thumbnailMode = options.thumbnail === undefined || options.thumbnail === null ? 'none' : options.thumbnail;
  const embed = {
    color: style.color,
    timestamp: new Date().toISOString()
  };
  const author = { name: style.name };
  if (avatarUrl) author.icon_url = avatarUrl;
  embed.author = author;
  if (options.title) embed.title = String(options.title).slice(0, 256);
  const description = trimDescription(options.description);
  if (description) embed.description = description;
  const fields = layoutFields(options.fields);
  if (fields.length) embed.fields = fields;
  const footer = { text: footerText(options.footerKey) };
  if (avatarUrl) footer.icon_url = avatarUrl;
  embed.footer = footer;

  const files = [];
  const useBanner = bannerMode === 'auto' && style.bannerFile;
  if (useBanner) {
    const banner = fileEntry(style.bannerFile);
    if (banner) {
      embed.image = { url: `attachment://${banner.name}` };
      files.push(banner);
    }
  }
  if (thumbnailMode === 'icon' && style.iconFile) {
    const icon = fileEntry(style.iconFile);
    if (icon) {
      embed.thumbnail = { url: `attachment://${icon.name}` };
      if (!files.some((file) => file.name === icon.name)) files.push(icon);
    }
  } else if (typeof thumbnailMode === 'string' && thumbnailMode !== 'none' && thumbnailMode !== 'icon') {
    embed.thumbnail = { url: String(thumbnailMode) };
  }
  return { embed, files };
}

function botAvatarUrl(client) {
  const user = client?.user;
  if (!user || typeof user.displayAvatarURL !== 'function') return '';
  try {
    return String(user.displayAvatarURL({ extension: 'png', size: 128 }) || '');
  } catch {
    return '';
  }
}

function attachmentUrls(embed) {
  return [embed?.image?.url, embed?.thumbnail?.url].filter((url) => typeof url === 'string');
}

function attachBrandFiles(payload = {}) {
  const embeds = Array.isArray(payload.embeds) ? payload.embeds : [];
  const files = Array.isArray(payload.files) ? payload.files.slice() : [];
  for (const embed of embeds) {
    for (const url of attachmentUrls(embed)) {
      if (!url.startsWith('attachment://')) continue;
      const name = url.slice('attachment://'.length);
      if (!name || files.some((file) => file?.name === name)) continue;
      const entry = fileEntry(name);
      if (entry) files.push(entry);
    }
  }
  return files.length ? { ...payload, files } : payload;
}

function listAttachments(message) {
  const raw = message?.attachments;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw.values === 'function') return [...raw.values()];
  if (typeof raw[Symbol.iterator] === 'function') return [...raw];
  return [];
}

function attachmentName(item) {
  const direct = String(item?.name || item?.filename || '').trim();
  if (direct) return direct;
  const url = String(item?.url || item?.proxyURL || '');
  const match = /\/([^/?#]+\.(?:png|webp|jpe?g))(?:\?|#|$)/i.exec(url);
  return match ? match[1] : '';
}

function attachmentId(item) {
  return String(item?.id || '').trim();
}

function keepExistingAttachments(message, body) {
  const files = Array.isArray(body?.files) ? body.files : [];
  if (!message || !files.length) return body;
  const existing = listAttachments(message);
  if (!existing.length) return body;
  const kept = [];
  const upload = [];
  const seen = new Set();
  for (const file of files) {
    const name = String(file?.name || '');
    const match = existing.find((item) => attachmentName(item) === name && attachmentId(item));
    if (match && !seen.has(attachmentId(match))) {
      seen.add(attachmentId(match));
      kept.push({ id: attachmentId(match) });
    } else upload.push(file);
  }
  if (!kept.length) return body;
  return { ...body, files: upload, attachments: kept };
}

function attachBanner(bot, payload = {}) {
  const banner = bannerFor(bot);
  if (!banner || !fs.existsSync(banner.path)) return payload;
  const embeds = Array.isArray(payload.embeds)
    ? payload.embeds.map((embed, index) => (index === 0 ? { ...embed, image: { url: banner.url } } : embed))
    : payload.embeds;
  const files = (Array.isArray(payload.files) ? payload.files : []).filter((file) => file?.name !== banner.name);
  files.push({ attachment: banner.path, name: banner.name });
  return { ...payload, embeds, files, attachments: [] };
}

function cloneDelivery(body) {
  const next = { ...body };
  if (Array.isArray(body?.files)) next.files = body.files.slice();
  if (Array.isArray(body?.attachments)) next.attachments = body.attachments.slice();
  if (Array.isArray(body?.embeds)) next.embeds = body.embeds.map((embed) => ({ ...embed }));
  return next;
}

function payloadHasBrandImage(payload) {
  const embed = payload?.embeds?.[0];
  return typeof embed?.image?.url === 'string' && embed.image.url.startsWith('attachment://');
}

module.exports = {
  MOTTO,
  HEX,
  BRAND_DIR,
  LEGACY_ASSET_DIR,
  BOT_STYLE,
  BANNERS,
  PANEL_BOTS,
  styleFor,
  brandEmbed,
  brandFiles,
  botAvatarUrl,
  footerText,
  bannerFor,
  bannerBotForPanel,
  attachBanner,
  attachBrandFiles,
  keepExistingAttachments,
  cloneDelivery,
  payloadHasBrandImage,
  resolveNamedAsset,
  layoutFields,
  trimDescription
};
