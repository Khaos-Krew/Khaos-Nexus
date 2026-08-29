'use strict';

const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv, remotePath } = require('./ark-sftp-config.cjs');

const PLUGINS = Object.freeze({
  arkshop: 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop/PluginInfo.json',
  arkshopui: 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShopUI/PluginInfo.json'
});

function sanitizePluginInfo(value = {}) {
  const dependencies = Array.isArray(value.Dependencies) ? value.Dependencies.map((entry) => String(entry).slice(0, 80)) : [];
  return {
    fullName: String(value.FullName || '').slice(0, 120),
    version: String(value.Version ?? '').slice(0, 40),
    minApiVersion: String(value.MinApiVersion ?? '').slice(0, 40),
    preventUnloading: typeof value.PreventUnloading === 'boolean' ? value.PreventUnloading : null,
    dependencies
  };
}

async function readJson(client, file) {
  const exists = await client.exists(file);
  if (!exists) return { present: false, info: null };
  const stat = await client.stat(file);
  if (Number(stat?.size || 0) > 64 * 1024) throw new Error(`PluginInfo exceeds safety limit: ${file}`);
  const bytes = await client.get(file);
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes || '');
  const parsed = JSON.parse(text);
  return { present: true, info: sanitizePluginInfo(parsed) };
}

function compatibilitySummary(result = {}) {
  const arkshop = result.arkshop || {};
  const ui = result.arkshopui || {};
  const blockers = [];
  if (!arkshop.present) blockers.push('arkshop-plugininfo-missing');
  if (!ui.present) blockers.push('arkshopui-plugininfo-missing');
  if (arkshop.present && String(arkshop.info?.version || '') !== '1.8') blockers.push('arkshop-version-not-1.8');
  if (ui.present && !String(ui.info?.version || '').startsWith('1.8')) blockers.push('arkshopui-version-not-1.8-family');
  return {
    compatibleWithPlannedShopUi: blockers.length === 0,
    blockers,
    arkshopVersion: String(arkshop.info?.version || ''),
    arkshopUiVersion: String(ui.info?.version || '')
  };
}

async function probeLivePluginCompatibility(prefix = 'ARK_GEN1', { Client = SftpClient } = {}) {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) throw new Error('ARK SFTP variables are incomplete.');
  const client = new Client('khaos-nexus-plugin-compatibility');
  await client.connect({
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    readyTimeout: settings.readyTimeout
  });
  try {
    const result = {};
    for (const [key, relative] of Object.entries(PLUGINS)) {
      result[key] = await readJson(client, remotePath(settings.root, relative));
    }
    return { ...result, compatibility: compatibilitySummary(result) };
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = {
  PLUGINS,
  sanitizePluginInfo,
  compatibilitySummary,
  probeLivePluginCompatibility
};