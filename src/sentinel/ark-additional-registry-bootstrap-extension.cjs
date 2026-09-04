'use strict';

const { Client } = require('discord.js');
const { ArkClusterRegistry, cleanEnvPrefix } = require('./ark-cluster-registry.cjs');
const { registerStartupTask } = require('./startup-coordinator.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.additional.registry.bootstrap.installed');

function boolEnv(name, fallback = false) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function configuredAdditionalPrefixes(env = process.env) {
  const explicit = String(env.ARK_SERVER_PREFIXES || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const candidates = explicit.length ? explicit : ['ARK_MAP2'];
  const out = [];
  for (const raw of candidates) {
    let prefix;
    try { prefix = cleanEnvPrefix(raw); } catch { continue; }
    if (prefix === 'ARK_GEN1' || out.includes(prefix)) continue;
    const enabled = String(env[`${prefix}_ENABLED`] || '').trim().toLowerCase() === 'true';
    const hasEndpoint = Boolean(String(env[`${prefix}_HOST`] || '').trim() || String(env[`${prefix}_SFTP_HOST`] || '').trim());
    if (!enabled && !hasEndpoint) continue;
    out.push(prefix);
  }
  return out;
}

function defaultsForPrefix(prefix, env = process.env) {
  if (prefix === 'ARK_MAP2') {
    return {
      id: 'map2',
      name: env.ARK_MAP2_NAME || 'MAP2',
      mapName: env.ARK_MAP2_MAP_NAME || env.ARK_MAP2_NAME || 'Astraeos',
      mapIdentifier: env.ARK_MAP2_MAP_IDENTIFIER || '',
      configProfile: 'map2-live',
      modProfile: 'map2-live',
      shopProfile: 'arkshop-live',
      restartProfile: 'map2-restarts'
    };
  }
  const suffix = prefix.replace(/^ARK_/, '').toLowerCase();
  return {
    id: suffix,
    name: env[`${prefix}_NAME`] || suffix.toUpperCase(),
    mapName: env[`${prefix}_MAP_NAME`] || env[`${prefix}_NAME`] || suffix.toUpperCase(),
    mapIdentifier: env[`${prefix}_MAP_IDENTIFIER`] || '',
    configProfile: `${suffix}-live`,
    modProfile: `${suffix}-live`,
    shopProfile: 'arkshop-live',
    restartProfile: `${suffix}-restarts`
  };
}

function bootstrapAdditionalArkServers(registry = new ArkClusterRegistry(), env = process.env) {
  const results = [];
  for (const prefix of configuredAdditionalPrefixes(env)) {
    // bootstrapFromEnv intentionally uses process.env because the live registry's
    // connection settings are sourced from Railway. Tests temporarily project the
    // supplied env object into process.env before calling this helper.
    const result = registry.bootstrapFromEnv(prefix, defaultsForPrefix(prefix, env));
    results.push({ prefix, ...result });
  }
  return results;
}

function formatBootstrapResult(item) {
  if (item.created) return `${item.prefix}:created=${item.record.id}:enabled=${item.record.enabled}`;
  if (item.existing) return `${item.prefix}:existing=${item.record.id}:enabled=${item.record.enabled}`;
  return `${item.prefix}:skipped=${item.skipped || 'unknown'}`;
}

function installArkAdditionalRegistryBootstrapExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  registerStartupTask({
    id: 'ark.additional-registry-bootstrap',
    owner: 'ark-additional-registry-bootstrap-extension',
    priority: 40,
    run(client) {
      try {
        const registry = new ArkClusterRegistry();
        const results = bootstrapAdditionalArkServers(registry);
        if (results.length) {
          console.log(`[Nexus Sentinal] ARK additional registry bootstrap: ${results.map(formatBootstrapResult).join(',')}`);
          const timer = setTimeout(() => void client.__nexusArkClusterContext?.runRefresh?.('additional-registry-bootstrap'), 1500);
          timer.unref?.();
        } else {
          console.log('[Nexus Sentinal] ARK additional registry bootstrap: no configured secondary maps');
        }
      } catch (error) {
        console.warn(`[Nexus Sentinal] ARK additional registry bootstrap failed: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 300)}`);
      }
    }
  });
}

module.exports = {
  boolEnv,
  configuredAdditionalPrefixes,
  defaultsForPrefix,
  bootstrapAdditionalArkServers,
  formatBootstrapResult,
  installArkAdditionalRegistryBootstrapExtension
};
