'use strict';

const EMBED_LIMITS = Object.freeze({
  title: 256,
  description: 4096,
  footer: 2048,
  author: 256,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  embedsPerMessage: 10,
  totalCharacters: 6000,
  safeTotalCharacters: 5750
});

function truncateText(value, maxLength) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return text.slice(0, Math.max(0, maxLength));
  return `${text.slice(0, maxLength - 1)}…`;
}

function splitText(value, maxLength = EMBED_LIMITS.fieldValue) {
  const text = String(value ?? '');
  if (!text) return [''];
  if (text.length <= maxLength) return [text];

  const parts = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf('\n', maxLength);
    if (cut < Math.floor(maxLength * 0.45)) cut = remaining.lastIndexOf(' ', maxLength);
    if (cut < Math.floor(maxLength * 0.45)) cut = maxLength;
    const part = remaining.slice(0, cut).trimEnd();
    parts.push(part || remaining.slice(0, maxLength));
    remaining = remaining.slice(cut).replace(/^\s+/, '');
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function embedCharacterCount(embed = {}) {
  let total = 0;
  total += String(embed.title ?? '').length;
  total += String(embed.description ?? '').length;
  total += String(embed.author?.name ?? '').length;
  total += String(embed.footer?.text ?? '').length;
  for (const field of Array.isArray(embed.fields) ? embed.fields : []) {
    total += String(field?.name ?? '').length;
    total += String(field?.value ?? '').length;
  }
  return total;
}

function normalizeField(field = {}) {
  const name = truncateText(field.name || '\u200b', EMBED_LIMITS.fieldName) || '\u200b';
  const values = splitText(field.value || '\u200b', EMBED_LIMITS.fieldValue);
  return values.map((value, index) => ({
    name: values.length > 1
      ? truncateText(`${name} • ${index + 1}/${values.length}`, EMBED_LIMITS.fieldName)
      : name,
    value: value || '\u200b',
    inline: Boolean(field.inline)
  }));
}

function normalizeEmbedBase(embed = {}) {
  const normalized = { ...embed };
  if (embed.title != null) normalized.title = truncateText(embed.title, EMBED_LIMITS.title);
  if (embed.description != null) normalized.description = truncateText(embed.description, EMBED_LIMITS.description);
  if (embed.author) normalized.author = { ...embed.author, name: truncateText(embed.author.name, EMBED_LIMITS.author) };
  if (embed.footer) normalized.footer = { ...embed.footer, text: truncateText(embed.footer.text, EMBED_LIMITS.footer) };
  delete normalized.fields;
  return normalized;
}

function fitBaseToBudget(base, maxCharacters) {
  const fitted = { ...base };
  if (base.author) fitted.author = { ...base.author };
  if (base.footer) fitted.footer = { ...base.footer };

  let overflow = embedCharacterCount(fitted) - maxCharacters;
  if (overflow <= 0) return fitted;

  const shrink = (key, nestedKey = null) => {
    if (overflow <= 0) return;
    const current = nestedKey ? String(fitted[key]?.[nestedKey] ?? '') : String(fitted[key] ?? '');
    if (!current) return;
    const target = Math.max(0, current.length - overflow);
    const next = truncateText(current, target);
    overflow -= current.length - next.length;
    if (nestedKey) fitted[key] = { ...fitted[key], [nestedKey]: next };
    else fitted[key] = next;
  };

  shrink('description');
  shrink('footer', 'text');
  shrink('author', 'name');
  shrink('title');
  return fitted;
}

function paginateEmbed(embed = {}, options = {}) {
  const maxCharacters = Math.min(
    EMBED_LIMITS.totalCharacters,
    Math.max(1024, Number(options.maxCharacters || EMBED_LIMITS.safeTotalCharacters))
  );
  const rawBase = normalizeEmbedBase(embed);
  const normalizedFields = (Array.isArray(embed.fields) ? embed.fields : []).flatMap(normalizeField);
  const fieldReserve = normalizedFields.length ? EMBED_LIMITS.fieldValue + EMBED_LIMITS.fieldName : 0;
  const base = fitBaseToBudget(rawBase, Math.max(0, maxCharacters - fieldReserve));

  if (!normalizedFields.length) return [{ ...fitBaseToBudget(base, maxCharacters), fields: [] }];

  const pages = [];
  let currentFields = [];
  for (const field of normalizedFields) {
    const candidate = { ...base, fields: [...currentFields, field] };
    if (currentFields.length >= EMBED_LIMITS.fields || embedCharacterCount(candidate) > maxCharacters) {
      pages.push({ ...base, fields: currentFields });
      currentFields = [field];
    } else {
      currentFields.push(field);
    }
  }
  if (currentFields.length) pages.push({ ...base, fields: currentFields });

  const totalPages = pages.length;
  return pages.map((page, index) => {
    if (totalPages <= 1) return page;
    const suffix = `Page ${index + 1}/${totalPages}`;
    const existing = String(page.footer?.text || '');
    const footerText = truncateText(existing ? `${existing} • ${suffix}` : suffix, EMBED_LIMITS.footer);
    const withFooter = { ...page, footer: { ...(page.footer || {}), text: footerText } };
    return embedCharacterCount(withFooter) <= EMBED_LIMITS.totalCharacters
      ? withFooter
      : { ...page, footer: { ...(page.footer || {}), text: suffix } };
  });
}

function buildEmbedMessagePages(embeds = [], options = {}) {
  const flattened = (Array.isArray(embeds) ? embeds : []).flatMap((embed) => paginateEmbed(embed, options));
  if (!flattened.length) return [{ embeds: [] }];
  return flattened.map((embed) => ({ embeds: [embed], allowedMentions: { parse: [] } }));
}

module.exports = {
  EMBED_LIMITS,
  truncateText,
  splitText,
  embedCharacterCount,
  paginateEmbed,
  buildEmbedMessagePages
};
