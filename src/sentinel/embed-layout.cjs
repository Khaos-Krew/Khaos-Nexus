'use strict';

const ZERO_WIDTH = '\u200b';

function clean(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function flatten(values = []) {
  const output = [];
  for (const value of Array.isArray(values) ? values : [values]) {
    if (Array.isArray(value)) output.push(...flatten(value));
    else {
      const text = clean(value);
      if (text) output.push(text);
    }
  }
  return output;
}

function paragraphs(...values) {
  return flatten(values).join('\n\n');
}

function lines(...values) {
  return flatten(values).join('\n');
}

function spacedItems(values = []) {
  return flatten(values).join('\n\n');
}

function labelValue(label, value) {
  const left = clean(label);
  const right = clean(value);
  if (!left) return right;
  if (!right) return `**${left}**`;
  return `**${left}**\n${right}`;
}

function statRows(entries = []) {
  return spacedItems(entries.map((entry) => {
    if (Array.isArray(entry)) return labelValue(entry[0], entry[1]);
    return labelValue(entry?.label, entry?.value);
  }));
}

function readableField(name, value, options = {}) {
  return {
    name: clean(name) || ZERO_WIDTH,
    value: clean(value) || ZERO_WIDTH,
    inline: options.inline === true
  };
}

function spacerField() {
  return { name: ZERO_WIDTH, value: ZERO_WIDTH, inline: false };
}

module.exports = {
  ZERO_WIDTH,
  clean,
  flatten,
  paragraphs,
  lines,
  spacedItems,
  labelValue,
  statRows,
  readableField,
  spacerField
};
