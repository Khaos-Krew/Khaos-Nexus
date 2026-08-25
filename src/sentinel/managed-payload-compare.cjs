'use strict';

function jsonOf(value) {
  if (value?.toJSON) return value.toJSON();
  if (value && typeof value === 'object') return value;
  return value ?? null;
}

function cleanObject(value) {
  if (Array.isArray(value)) return value.map(cleanObject);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    result[key] = cleanObject(raw);
  }
  return result;
}

function canonicalEmbed(value) {
  const embed = cleanObject(jsonOf(value) || {});
  const result = {};
  for (const key of ['title', 'description', 'url', 'color']) {
    if (embed[key] !== undefined) result[key] = embed[key];
  }
  if (Array.isArray(embed.fields)) {
    result.fields = embed.fields.map((field) => ({
      name: String(field?.name || ''),
      value: String(field?.value || ''),
      inline: field?.inline === true
    }));
  }
  if (embed.footer) {
    result.footer = { text: String(embed.footer.text || '') };
    if (embed.footer.icon_url) result.footer.icon_url = String(embed.footer.icon_url);
  }
  if (embed.author) {
    result.author = { name: String(embed.author.name || '') };
    if (embed.author.url) result.author.url = String(embed.author.url);
    if (embed.author.icon_url) result.author.icon_url = String(embed.author.icon_url);
  }
  if (embed.thumbnail?.url) result.thumbnail = { url: String(embed.thumbnail.url) };
  if (embed.image?.url) result.image = { url: String(embed.image.url) };
  if (embed.timestamp) result.timestamp = String(embed.timestamp);
  return result;
}

function canonicalEmoji(value) {
  const emoji = cleanObject(value || {});
  const result = {};
  if (emoji.id) result.id = String(emoji.id);
  if (emoji.name) result.name = String(emoji.name);
  if (emoji.animated === true) result.animated = true;
  return result;
}

function canonicalComponent(value) {
  const component = cleanObject(jsonOf(value) || {});
  const result = {};
  for (const key of ['type', 'style', 'label', 'url', 'placeholder', 'min_values', 'max_values']) {
    if (component[key] !== undefined) result[key] = component[key];
  }
  const customId = component.custom_id ?? component.customId;
  if (customId !== undefined) result.custom_id = String(customId);
  if (component.disabled === true) result.disabled = true;
  if (component.emoji) result.emoji = canonicalEmoji(component.emoji);
  if (Array.isArray(component.options)) {
    result.options = component.options.map((option) => {
      const normalized = {
        label: String(option?.label || ''),
        value: String(option?.value || '')
      };
      if (option?.description) normalized.description = String(option.description);
      if (option?.emoji) normalized.emoji = canonicalEmoji(option.emoji);
      if (option?.default === true) normalized.default = true;
      return normalized;
    });
  }
  if (Array.isArray(component.components)) result.components = component.components.map(canonicalComponent);
  return result;
}

function canonicalManagedPayload(value = {}) {
  return {
    content: String(value?.content || ''),
    embeds: (value?.embeds || []).map(canonicalEmbed),
    components: (value?.components || []).map(canonicalComponent)
  };
}

function managedPayloadMatches(message, payload) {
  return JSON.stringify(canonicalManagedPayload(message)) === JSON.stringify(canonicalManagedPayload(payload));
}

module.exports = {
  canonicalComponent,
  canonicalEmbed,
  canonicalEmoji,
  canonicalManagedPayload,
  cleanObject,
  jsonOf,
  managedPayloadMatches
};
