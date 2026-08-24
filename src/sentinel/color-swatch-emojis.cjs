'use strict';

const zlib = require('node:zlib');
const { normalizedName, normalizeSelfRoleMenu } = require('./self-role-model.cjs');

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function emojiPayload(emoji) {
  if (!emoji?.id) return null;
  return {
    id: String(emoji.id),
    ...(emoji.name ? { name: String(emoji.name).slice(0, 32) } : {}),
    ...(emoji.animated ? { animated: true } : {})
  };
}

function swatchEmojiName(label) {
  const slug = normalizedName(label).replace(/-/g, '_') || 'swatch';
  return `nexus_color_${slug}`.slice(0, 32).replace(/_+$/g, '') || 'nexus_color';
}

function swatchNamePatterns(option = {}) {
  const slug = normalizedName(option.label);
  const hex = String(option.color || '').replace(/^#/, '').toLowerCase();
  return [
    `nexus-color-${slug}`,
    `color-${slug}`,
    `colour-${slug}`,
    `swatch-${slug}`,
    `square-${slug}`,
    `c-${slug}`,
    slug,
    ...(hex ? [`nexus-color-${hex}`, `color-${hex}`, `swatch-${hex}`, hex] : [])
  ].filter(Boolean);
}

function findExistingSwatch(option, emojis = []) {
  const entries = valuesOf(emojis).filter((emoji) => emoji?.id && emoji?.name);
  const byName = new Map();
  for (const emoji of entries) {
    const key = normalizedName(emoji.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(emoji);
  }
  for (const pattern of swatchNamePatterns(option)) {
    const matches = byName.get(pattern) || [];
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function solidColorPng(hex, size = 32) {
  const value = String(hex || '#808080').replace(/^#/, '');
  const safe = /^[0-9a-fA-F]{6}$/.test(value) ? value : '808080';
  const r = Number.parseInt(safe.slice(0, 2), 16);
  const g = Number.parseInt(safe.slice(2, 4), 16);
  const b = Number.parseInt(safe.slice(4, 6), 16);
  const width = Math.max(8, Math.min(64, Number(size) || 32));
  const height = width;
  const row = Buffer.alloc(1 + width * 4);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = 1 + x * 4;
    row[offset] = r;
    row[offset + 1] = g;
    row[offset + 2] = b;
    row[offset + 3] = 255;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function applicationEmojiManager(guild, options = {}) {
  return options.applicationEmojiManager
    || options.client?.application?.emojis
    || guild?.client?.application?.emojis
    || null;
}

function isGeneratedGuildSwatch(option = {}) {
  return Boolean(option.emojiId) && /^nexus[_-]color[_-]/i.test(String(option.emoji || ''));
}

async function removeGeneratedGuildSwatch(option, guild, logger = console) {
  if (!isGeneratedGuildSwatch(option) || !guild?.emojis) return false;
  const id = String(option.emojiId || '');
  try {
    let emoji = guild.emojis.cache?.get?.(id) || null;
    if (!emoji && typeof guild.emojis.fetch === 'function') {
      try { emoji = await guild.emojis.fetch(id); } catch {}
    }
    if (!emoji) return false;
    if (emoji?.delete) await emoji.delete('Replaced by Nexus Sentinal application-owned color swatch');
    else if (typeof guild.emojis.delete === 'function') await guild.emojis.delete(id, 'Replaced by Nexus Sentinal application-owned color swatch');
    else return false;
    return true;
  } catch (error) {
    logger.warn?.(`[Nexus Sentinal] temporary guild swatch ${option.label} could not be removed: ${String(error?.message || error)}`);
    return false;
  }
}

async function ensureColorSwatches(menuInput, guild, options = {}) {
  let menu = normalizeSelfRoleMenu(menuInput);
  if (menu.kind !== 'colors') return { menu, matched: 0, created: 0, cleaned: 0, missing: [] };

  const logger = options.logger || console;
  const manager = applicationEmojiManager(guild, options);
  if (!manager) {
    return { menu, matched: 0, created: 0, cleaned: 0, missing: menu.options.filter((option) => !option.emojiId && !option.emoji).map((option) => option.label) };
  }

  let applicationCollection = null;
  try { applicationCollection = await manager.fetch(); } catch (error) {
    logger.warn?.(`[Nexus Sentinal] application color swatch inventory fetch failed: ${String(error?.message || error)}`);
  }
  const known = valuesOf(applicationCollection || manager.cache || []);
  let matched = 0;
  let created = 0;
  let cleaned = 0;
  const missing = [];
  const enriched = [];

  for (const option of menu.options) {
    const generatedGuildEmoji = isGeneratedGuildSwatch(option);
    if (option.emojiId && option.emoji && !generatedGuildEmoji) {
      enriched.push(option);
      continue;
    }

    let emoji = findExistingSwatch(option, known);
    if (emoji) matched += 1;
    if (!emoji && typeof manager.create === 'function') {
      try {
        emoji = await manager.create({
          attachment: solidColorPng(option.color, 32),
          name: swatchEmojiName(option.label)
        });
        if (emoji) {
          known.push(emoji);
          created += 1;
        }
      } catch (error) {
        logger.warn?.(`[Nexus Sentinal] application color swatch ${option.label} could not be created: ${String(error?.message || error)}`);
      }
    }

    const payload = emojiPayload(emoji);
    if (!payload) {
      if (option.emojiId || option.emoji) enriched.push(option);
      else {
        missing.push(option.label);
        enriched.push(option);
      }
      continue;
    }

    enriched.push({ ...option, emoji: payload });
    if (generatedGuildEmoji && await removeGeneratedGuildSwatch(option, guild, logger)) cleaned += 1;
  }

  menu = normalizeSelfRoleMenu({ ...menu, options: enriched });
  return { menu, matched, created, cleaned, missing };
}

module.exports = {
  valuesOf,
  emojiPayload,
  swatchEmojiName,
  swatchNamePatterns,
  findExistingSwatch,
  crc32,
  pngChunk,
  solidColorPng,
  applicationEmojiManager,
  isGeneratedGuildSwatch,
  removeGeneratedGuildSwatch,
  ensureColorSwatches
};
