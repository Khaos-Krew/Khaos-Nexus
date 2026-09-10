'use strict';

function buildDiscordReconciliationPlan(desired = {}, actual = {}) {
  const operations = [];
  const desiredChannels = Array.isArray(desired.channels) ? desired.channels : [];
  const desiredRoles = Array.isArray(desired.roles) ? desired.roles : [];
  const actualChannels = Array.isArray(actual.channels) ? actual.channels : [];
  const actualRoles = Array.isArray(actual.roles) ? actual.roles : [];

  for (const channel of desiredChannels) {
    const match = matchEntity(channel, actualChannels, { typeAware: true });
    if (!match) {
      operations.push(operation('discord.channel.create', channelKey(channel), {
        name: clean(channel.name),
        type: normalizeNumber(channel.type),
        parentId: nullableString(channel.parentId),
      }));
      continue;
    }

    if (clean(channel.name) && clean(channel.name) !== clean(match.name)) {
      operations.push(operation('discord.channel.rename', String(match.id), {
        from: clean(match.name),
        to: clean(channel.name),
      }));
    }
    if (channel.parentId !== undefined && nullableString(channel.parentId) !== nullableString(match.parentId)) {
      operations.push(operation('discord.channel.reparent', String(match.id), {
        from: nullableString(match.parentId),
        to: nullableString(channel.parentId),
      }));
    }
  }

  for (const role of desiredRoles) {
    const match = matchEntity(role, actualRoles);
    if (!match) {
      operations.push(operation('discord.role.create', roleKey(role), {
        name: clean(role.name),
      }));
      continue;
    }

    if (clean(role.name) && clean(role.name) !== clean(match.name)) {
      operations.push(operation('discord.role.rename', String(match.id), {
        from: clean(match.name),
        to: clean(role.name),
      }));
    }
  }

  return Object.freeze({
    mode: 'plan-only',
    changed: operations.length > 0,
    operationCount: operations.length,
    operations: Object.freeze(operations),
    summary: Object.freeze(summarizeOperations(operations)),
  });
}

function matchEntity(desired, actualItems, { typeAware = false } = {}) {
  const desiredId = nullableString(desired?.id);
  if (desiredId) return actualItems.find((item) => String(item?.id) === desiredId) || null;

  const name = clean(desired?.name);
  if (!name) return null;
  return actualItems.find((item) => {
    if (clean(item?.name) !== name) return false;
    if (!typeAware || desired?.type === undefined) return true;
    return normalizeNumber(item?.type) === normalizeNumber(desired.type);
  }) || null;
}

function summarizeOperations(operations) {
  const summary = {};
  for (const item of operations) summary[item.capability] = (summary[item.capability] || 0) + 1;
  return summary;
}

function operation(capability, subject, details) {
  return Object.freeze({
    capability,
    subject: String(subject || ''),
    destructive: false,
    details: Object.freeze({ ...details }),
  });
}

function channelKey(channel) {
  return nullableString(channel?.id) || clean(channel?.key) || clean(channel?.name) || 'unnamed-channel';
}

function roleKey(role) {
  return nullableString(role?.id) || clean(role?.key) || clean(role?.name) || 'unnamed-role';
}

function clean(value) {
  return String(value ?? '').trim();
}

function nullableString(value) {
  const normalized = clean(value);
  return normalized || null;
}

function normalizeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = {
  buildDiscordReconciliationPlan,
  matchEntity,
  summarizeOperations,
};
