'use strict';

const DISCORD_MESSAGE_LIMITS = Object.freeze({
  content: 2000,
  embeds: 10,
  embedTitle: 256,
  embedDescription: 4096,
  embedFields: 25,
  embedFieldName: 256,
  embedFieldValue: 1024,
  embedFooter: 2048,
  embedTotal: 6000,
  actionRows: 5,
  rowComponents: 5,
  buttonLabel: 80,
  customId: 100,
  url: 2048,
  emojiName: 32
});

function payloadError(path, message, options = {}) {
  const label = String(options.label || 'Discord message payload');
  const error = new Error(`${label} ${path}: ${message}`);
  error.code = options.code || 'DISCORD_MESSAGE_PAYLOAD_INVALID';
  error.field = path;
  return error;
}

function validateOptionalText(value, path, maximum, options = {}) {
  if (value === undefined || value === null) {
    if (options.required) throw payloadError(path, 'is required.', options);
    return 0;
  }
  if (typeof value !== 'string') throw payloadError(path, 'must be text.', options);
  if (options.required && !value.trim()) throw payloadError(path, 'must not be empty.', options);
  if (value.length > maximum) throw payloadError(path, `must be ${maximum} characters or fewer.`, options);
  return value.length;
}

function validateDiscordUrl(value, path, options = {}) {
  validateOptionalText(value, path, DISCORD_MESSAGE_LIMITS.url, { ...options, required: true });
  let parsed;
  try { parsed = new URL(value); } catch { throw payloadError(path, 'must be a valid URL.', options); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw payloadError(path, 'must use HTTP or HTTPS.', options);
}

function isUnicodeEmojiName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > DISCORD_MESSAGE_LIMITS.emojiName) return false;
  try { return /\p{Extended_Pictographic}/u.test(name); }
  catch { return /[\u{1F000}-\u{1FAFF}]/u.test(name); }
}

function validateDiscordEmoji(emoji, path, options = {}) {
  if (!emoji || typeof emoji !== 'object' || Array.isArray(emoji)) throw payloadError(path, 'must be an emoji object.', options);
  const id = emoji.id === undefined || emoji.id === null ? '' : String(emoji.id).trim();
  const name = emoji.name === undefined || emoji.name === null ? '' : String(emoji.name).trim();
  if (!id && !name) throw payloadError(path, 'must contain an emoji name or ID.', options);
  if (id && !/^\d{5,25}$/.test(id)) throw payloadError(`${path}.id`, 'must be a valid Discord emoji ID.', options);
  if (name) {
    validateOptionalText(name, `${path}.name`, DISCORD_MESSAGE_LIMITS.emojiName, { ...options, required: true });
    if (!id && !isUnicodeEmojiName(name)) throw payloadError(`${path}.name`, 'must be a Unicode emoji rather than a text symbol.', options);
  }
  if (emoji.animated !== undefined && typeof emoji.animated !== 'boolean') throw payloadError(`${path}.animated`, 'must be true or false.', options);
}

function validateDiscordMessagePayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw payloadError('body', 'must be an object.', options);
  validateOptionalText(payload.content, 'content', DISCORD_MESSAGE_LIMITS.content, options);

  const embeds = payload.embeds === undefined ? [] : payload.embeds;
  if (!Array.isArray(embeds)) throw payloadError('embeds', 'must be an array.', options);
  if (embeds.length > DISCORD_MESSAGE_LIMITS.embeds) throw payloadError('embeds', `may contain at most ${DISCORD_MESSAGE_LIMITS.embeds} embeds.`, options);
  let embedCharacters = 0;
  embeds.forEach((embed, embedIndex) => {
    const path = `embeds[${embedIndex}]`;
    if (!embed || typeof embed !== 'object' || Array.isArray(embed)) throw payloadError(path, 'must be an object.', options);
    embedCharacters += validateOptionalText(embed.title, `${path}.title`, DISCORD_MESSAGE_LIMITS.embedTitle, options);
    embedCharacters += validateOptionalText(embed.description, `${path}.description`, DISCORD_MESSAGE_LIMITS.embedDescription, options);
    if (embed.url !== undefined) validateDiscordUrl(embed.url, `${path}.url`, options);
    if (embed.thumbnail?.url !== undefined) validateDiscordUrl(embed.thumbnail.url, `${path}.thumbnail.url`, options);
    if (embed.image?.url !== undefined) validateDiscordUrl(embed.image.url, `${path}.image.url`, options);
    if (embed.footer !== undefined) {
      if (!embed.footer || typeof embed.footer !== 'object' || Array.isArray(embed.footer)) throw payloadError(`${path}.footer`, 'must be an object.', options);
      embedCharacters += validateOptionalText(embed.footer.text, `${path}.footer.text`, DISCORD_MESSAGE_LIMITS.embedFooter, { ...options, required: true });
      if (embed.footer.icon_url !== undefined) validateDiscordUrl(embed.footer.icon_url, `${path}.footer.icon_url`, options);
    }
    const fields = embed.fields === undefined ? [] : embed.fields;
    if (!Array.isArray(fields)) throw payloadError(`${path}.fields`, 'must be an array.', options);
    if (fields.length > DISCORD_MESSAGE_LIMITS.embedFields) throw payloadError(`${path}.fields`, `may contain at most ${DISCORD_MESSAGE_LIMITS.embedFields} fields.`, options);
    fields.forEach((field, fieldIndex) => {
      const fieldPath = `${path}.fields[${fieldIndex}]`;
      if (!field || typeof field !== 'object' || Array.isArray(field)) throw payloadError(fieldPath, 'must be an object.', options);
      embedCharacters += validateOptionalText(field.name, `${fieldPath}.name`, DISCORD_MESSAGE_LIMITS.embedFieldName, { ...options, required: true });
      embedCharacters += validateOptionalText(field.value, `${fieldPath}.value`, DISCORD_MESSAGE_LIMITS.embedFieldValue, { ...options, required: true });
      if (field.inline !== undefined && typeof field.inline !== 'boolean') throw payloadError(`${fieldPath}.inline`, 'must be true or false.', options);
    });
  });
  if (embedCharacters > DISCORD_MESSAGE_LIMITS.embedTotal) throw payloadError('embeds', `combined embed text must be ${DISCORD_MESSAGE_LIMITS.embedTotal} characters or fewer.`, options);

  const rows = payload.components === undefined ? [] : payload.components;
  if (!Array.isArray(rows)) throw payloadError('components', 'must be an array.', options);
  if (rows.length > DISCORD_MESSAGE_LIMITS.actionRows) throw payloadError('components', `may contain at most ${DISCORD_MESSAGE_LIMITS.actionRows} action rows.`, options);
  rows.forEach((row, rowIndex) => {
    const rowPath = `components[${rowIndex}]`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw payloadError(rowPath, 'must be an action-row object.', options);
    if (row.type !== 1) throw payloadError(`${rowPath}.type`, 'must be Discord action-row type 1.', options);
    if (!Array.isArray(row.components) || !row.components.length) throw payloadError(`${rowPath}.components`, 'must contain at least one component.', options);
    if (row.components.length > DISCORD_MESSAGE_LIMITS.rowComponents) throw payloadError(`${rowPath}.components`, `may contain at most ${DISCORD_MESSAGE_LIMITS.rowComponents} components.`, options);
    row.components.forEach((component, componentIndex) => {
      const componentPath = `${rowPath}.components[${componentIndex}]`;
      if (!component || typeof component !== 'object' || Array.isArray(component)) throw payloadError(componentPath, 'must be an object.', options);
      if (component.type !== 2) throw payloadError(`${componentPath}.type`, 'must be Discord button type 2.', options);
      if (![1, 2, 3, 4, 5].includes(component.style)) throw payloadError(`${componentPath}.style`, 'must be a valid Discord button style.', options);
      validateOptionalText(component.label, `${componentPath}.label`, DISCORD_MESSAGE_LIMITS.buttonLabel, { ...options, required: !component.emoji });
      if (component.emoji !== undefined) validateDiscordEmoji(component.emoji, `${componentPath}.emoji`, options);
      if (component.style === 5) {
        if (component.custom_id !== undefined) throw payloadError(`${componentPath}.custom_id`, 'is not allowed on a link button.', options);
        validateDiscordUrl(component.url, `${componentPath}.url`, options);
      } else {
        validateOptionalText(component.custom_id, `${componentPath}.custom_id`, DISCORD_MESSAGE_LIMITS.customId, { ...options, required: true });
        if (component.url !== undefined) throw payloadError(`${componentPath}.url`, 'is only allowed on a link button.', options);
      }
      if (component.disabled !== undefined && typeof component.disabled !== 'boolean') throw payloadError(`${componentPath}.disabled`, 'must be true or false.', options);
    });
  });

  if (!payload.content && !embeds.length && !rows.length) throw payloadError('body', 'must contain content, an embed, or components.', options);
  return payload;
}

function discordValidationDetail(input) {
  const visit = (node, path = '') => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node._errors) && node._errors.length) {
      const message = String(node._errors[0]?.message || node._errors[0]?.code || 'Invalid value.').replace(/\s+/g, ' ').trim().slice(0, 240);
      return { path: path || 'body', message };
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === '_errors') continue;
      const result = visit(value, path ? `${path}.${key}` : key);
      if (result) return result;
    }
    return null;
  };
  return visit(input?.errors || input?.rawError?.errors);
}

module.exports = {
  DISCORD_MESSAGE_LIMITS,
  payloadError,
  isUnicodeEmojiName,
  validateDiscordEmoji,
  validateDiscordMessagePayload,
  discordValidationDetail
};
