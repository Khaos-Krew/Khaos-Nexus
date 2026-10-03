'use strict';

// Discord counts title, description, field names, field values, footer text, and
// author name across every embed in one message. 1024 is per field value.
const DISCORD = Object.freeze({
  fieldValue: 1024,
  fieldName: 256,
  fields: 25,
  message: 6000,
  embeds: 2
});

// Room for the author name and footer added when the panel is sent.
const CHROME_PER_EMBED = 64;
const DISCLAIMER = '-# Not affiliated with or endorsed by Bungie';

function includesDisclaimer(text) {
  return String(text || '').includes(DISCLAIMER);
}

function descriptionCost(text) {
  const body = String(text || '');
  if (includesDisclaimer(body)) return body.length;
  if (!body) return DISCLAIMER.length;
  return body.length + 1 + DISCLAIMER.length;
}

function embedCharacterCount(embed) {
  let total = CHROME_PER_EMBED;
  total += String(embed?.title || '').length;
  total += descriptionCost(embed?.description);
  for (const field of embed?.fields || []) {
    total += String(field?.name || '').length;
    total += String(field?.value || '').length;
  }
  return total;
}

function messageCharacterCount(embeds) {
  return (Array.isArray(embeds) ? embeds : []).reduce((sum, embed) => sum + embedCharacterCount(embed), 0);
}

function continuedTitle(title) {
  const base = String(title || 'Details').replace(/\s+\(continued\)$/, '');
  return `${base} (continued)`.slice(0, 256);
}

function continuedName(name) {
  const base = String(name || 'More').replace(/\s+\(cont\.\)$/, '');
  return `${base} (cont.)`.slice(0, DISCORD.fieldName);
}

function visibleLines(lines) {
  const cleaned = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const text = String(line ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
    if (!text) {
      if (cleaned.length && cleaned[cleaned.length - 1] !== '') cleaned.push('');
      continue;
    }
    if (text.length <= DISCORD.fieldValue) {
      cleaned.push(text);
      continue;
    }
    let rest = text;
    while (rest.length > DISCORD.fieldValue) {
      cleaned.push(rest.slice(0, DISCORD.fieldValue));
      rest = rest.slice(DISCORD.fieldValue).trim();
    }
    if (rest) cleaned.push(rest);
  }
  while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop();
  return cleaned;
}

function replaceLast(embeds, embed) {
  return embeds.slice(0, -1).concat(embed);
}

function placeField(embeds, name, line) {
  if (!line || line.length > DISCORD.fieldValue) return false;
  const field = { name: String(name).slice(0, DISCORD.fieldName), value: line, inline: false };
  const current = embeds[embeds.length - 1];
  if (current.fields.length < DISCORD.fields) {
    const trial = replaceLast(embeds, { ...current, fields: current.fields.concat(field) });
    if (messageCharacterCount(trial) <= DISCORD.message) {
      current.fields.push(field);
      return true;
    }
  }
  if (embeds.length >= DISCORD.embeds || !current.fields.length) return false;
  const next = { title: continuedTitle(embeds[0].title), description: '', fields: [field] };
  if (messageCharacterCount(embeds.concat(next)) > DISCORD.message) return false;
  embeds.push(next);
  return true;
}

function appendToOpenField(embeds, line) {
  const current = embeds[embeds.length - 1];
  const last = current.fields[current.fields.length - 1];
  if (!last) return false;
  const value = last.value ? `${last.value}\n${line}` : String(line);
  if (value.length > DISCORD.fieldValue) return false;
  const fields = current.fields.slice(0, -1).concat({ ...last, value });
  const trial = replaceLast(embeds, { ...current, fields });
  if (messageCharacterCount(trial) > DISCORD.message) return false;
  current.fields[current.fields.length - 1] = { ...last, value };
  return true;
}

function isSectionHeader(line) {
  return /^\*\*[^*]+\*\*$/.test(String(line || '').trim());
}

function countsAsItem(line) {
  const text = String(line || '').trim();
  return Boolean(text) && !isSectionHeader(text);
}

function hiddenLines(queue, start) {
  return queue.slice(start).filter((item) => item.item).length;
}

function withHeader(header, line) {
  if (!header || isSectionHeader(line)) return line;
  const combined = `${header}\n${line}`;
  return combined.length <= DISCORD.fieldValue ? combined : line;
}

function appendOverflow(embeds, omitted) {
  let hidden = omitted;
  const current = embeds[embeds.length - 1];
  if (!current?.fields?.length) {
    placeField(embeds, 'More', `+${hidden} more`);
    return;
  }
  const last = current.fields[current.fields.length - 1];
  const lines = String(last.value || '').split('\n');
  while (lines.length >= 0) {
    const note = `+${hidden} more`;
    const value = lines.length ? `${lines.join('\n')}\n${note}` : note;
    if (value.length <= DISCORD.fieldValue) {
      const updated = { ...last, value };
      const fields = current.fields.slice(0, -1).concat(updated);
      const trial = replaceLast(embeds, { ...current, fields });
      if (messageCharacterCount(trial) <= DISCORD.message) {
        current.fields[current.fields.length - 1] = updated;
        return;
      }
    }
    if (!lines.length) return;
    const dropped = lines.pop();
    if (countsAsItem(dropped)) hidden += 1;
  }
}

function packSections({ title, description = '', sections = [] } = {}) {
  const mainTitle = String(title || '').slice(0, 256);
  const embeds = [{ title: mainTitle, description: String(description || ''), fields: [] }];
  const queue = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const lines = visibleLines(section?.lines);
    if (!lines.some((line) => line.trim())) continue;
    const name = String(section?.name || 'Details').slice(0, DISCORD.fieldName);
    lines.forEach((line, index) => queue.push({
      name,
      line,
      start: index === 0,
      item: countsAsItem(line)
    }));
  }

  let open = false;
  let omitted = 0;
  let header = '';
  const rememberHeader = (line) => {
    if (isSectionHeader(line)) header = String(line).trim();
  };
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (!item.line.trim()) {
      if (open) appendToOpenField(embeds, item.line);
      continue;
    }
    if (item.start) {
      open = false;
      header = '';
    }
    if (!open) {
      const name = item.start ? item.name : continuedName(item.name);
      const value = item.start ? item.line : withHeader(header, item.line);
      if (!placeField(embeds, name, value)) {
        omitted = hiddenLines(queue, index);
        break;
      }
      rememberHeader(item.line);
      open = true;
      continue;
    }
    if (appendToOpenField(embeds, item.line)) {
      rememberHeader(item.line);
      continue;
    }
    open = false;
    if (!placeField(embeds, continuedName(item.name), withHeader(header, item.line))) {
      omitted = hiddenLines(queue, index);
      break;
    }
    rememberHeader(item.line);
    open = true;
  }
  if (omitted > 0) appendOverflow(embeds, omitted);

  const first = embeds[0];
  return {
    title: first.title,
    description: first.description,
    fields: first.fields,
    embeds
  };
}

module.exports = {
  DISCORD,
  CHROME_PER_EMBED,
  DISCLAIMER,
  embedCharacterCount,
  messageCharacterCount,
  packSections
};
