'use strict';

function clean(value, max = 120) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function unique(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => clean(value, 100)).filter(Boolean))];
}

function primaryBotRecord(existing = {}, publicConfig = {}) {
  const discord = publicConfig.discord && typeof publicConfig.discord === 'object' ? publicConfig.discord : {};
  return {
    ...existing,
    id: 'nexus-bot',
    applicationId: clean(existing.applicationId || discord.oauthClientId, 25),
    botUserId: clean(existing.botUserId, 25),
    name: clean(existing.name || 'Nexus Bot', 120) || 'Nexus Bot',
    enabled: existing.enabled !== false,
    modules: unique([...(existing.modules || []), 'dnd-workspace']),
    guildIds: unique([...(existing.guildIds || []), discord.guildId]),
    legacyNexusBot: true,
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function mergeProvisioningApps(apps, publicConfig = {}) {
  const list = Array.isArray(apps) ? apps.map((item) => ({ ...item })) : [];
  const index = list.findIndex((item) => item.id === 'nexus-bot' || item.legacyNexusBot);
  const existing = index >= 0 ? list[index] : {};
  const primary = primaryBotRecord(existing, publicConfig);
  if (index >= 0) list[index] = primary;
  else list.unshift(primary);
  return list;
}

function publicProvisioningApps(apps, tokenLookup = () => '') {
  return (Array.isArray(apps) ? apps : []).map((record) => ({
    ...record,
    hasToken: Boolean(tokenLookup(record.id))
  }));
}

module.exports = {
  clean,
  unique,
  primaryBotRecord,
  mergeProvisioningApps,
  publicProvisioningApps
};
