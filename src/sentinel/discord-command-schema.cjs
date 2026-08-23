'use strict';

function normalizeRequiredOptions(value) {
  if (Array.isArray(value)) return value.map(normalizeRequiredOptions);
  if (!value || typeof value !== 'object') return value;

  const result = { ...value };
  if (Array.isArray(value.options)) {
    const normalized = value.options.map(normalizeRequiredOptions);
    const hasRequired = normalized.some((option) => option && option.required === true);
    if (hasRequired) {
      const required = normalized.filter((option) => option?.required === true);
      const optional = normalized.filter((option) => option?.required !== true);
      result.options = [...required, ...optional];
    } else {
      result.options = normalized;
    }
  }
  return result;
}

function validateRequiredOptionOrdering(command) {
  const problems = [];
  function walk(node, path = []) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.options)) {
      let optionalSeen = false;
      for (let index = 0; index < node.options.length; index += 1) {
        const option = node.options[index];
        if (option?.required === true && optionalSeen) problems.push([...path, `options[${index}]`].join('.'));
        if (option?.required !== true && option?.type !== 1 && option?.type !== 2) optionalSeen = true;
        walk(option, [...path, `options[${index}]`]);
      }
    }
  }
  walk(command, [command?.name || 'command']);
  return problems;
}

module.exports = { normalizeRequiredOptions, validateRequiredOptionOrdering };
