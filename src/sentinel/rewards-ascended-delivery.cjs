'use strict';

const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv, remotePath } = require('./ark-sftp-config.cjs');

const DEFAULT_CONFIG_PATH = 'ShooterGame/Binaries/Win64/ArkApi/Plugins/RewardsAscended/config.json';
const DEFAULT_PLUGIN_INFO = 'ShooterGame/Binaries/Win64/ArkApi/Plugins/RewardsAscended/PluginInfo.json';

function backendMode(env = process.env) {
  const value = String(env.NEXUS_DINO_CACHE_DELIVERY_BACKEND || 'rewardsascended').trim().toLowerCase();
  if (!['rewardsascended', 'dinodepot'].includes(value)) throw new Error(`Unsupported Dino Cache delivery backend: ${value}`);
  return value;
}

function fallbackEnabled(env = process.env) {
  return String(env.NEXUS_DINO_CACHE_DINODEPOT_FALLBACK || '').trim().toLowerCase() === 'true';
}

function configRelativePath(prefix, env = process.env) {
  return String(env[`${prefix}_REWARDS_ASCENDED_CONFIG_PATH`] || env.NEXUS_REWARDS_ASCENDED_CONFIG_PATH || DEFAULT_CONFIG_PATH).trim();
}

function pluginInfoRelativePath(prefix, env = process.env) {
  return String(env[`${prefix}_REWARDS_ASCENDED_PLUGIN_INFO_PATH`] || env.NEXUS_REWARDS_ASCENDED_PLUGIN_INFO_PATH || DEFAULT_PLUGIN_INFO).trim();
}

function rewardIdForOrder(row = {}) {
  const raw = String(row.id || row.public_cache_id || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!raw) throw new Error('Dino Cache order is missing a stable reward identity.');
  return `NexusCache_${raw}`.slice(0, 60);
}

function blueprintRef(value, { allowEmpty = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw && allowEmpty) return '';
  if (!/^\/(?:Game|SDinoVariants|RunicWyverns)\/[A-Za-z0-9_./-]{8,230}$/.test(raw)) throw new Error(`RewardsAscended blueprint path is invalid: ${raw.slice(0, 120)}`);
  return `Blueprint'${raw}'`;
}

function buildRewardEntry({ blueprint, level, sex, saddleBlueprint = '' } = {}) {
  const lvl = Number(level);
  if (!Number.isInteger(lvl) || lvl < 1 || lvl > 1000) throw new Error('RewardsAscended dino level must be an integer from 1-1000.');
  const normalizedSex = String(sex || '').trim().toLowerCase();
  if (!['male', 'female'].includes(normalizedSex)) throw new Error('RewardsAscended Dino Cache sex must be male or female.');
  return {
    Dinos: [{
      GiveInCryoPod: true,
      UseCryoPodCustomTimeLimit: false,
      CryoPodCustomTimeLimitInMinutes: 0,
      Blueprint: blueprintRef(blueprint),
      Level: lvl,
      Neutered: false,
      Gender: normalizedSex === 'female' ? 'Female' : 'Male',
      SaddleBlueprint: blueprintRef(saddleBlueprint, { allowEmpty: true }),
      UseRandomLevel: false,
      MinRandomLevel: lvl,
      MaxRandomLevel: lvl
    }]
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function connect(prefix, env = process.env) {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) throw new Error(`${prefix} SFTP variables are incomplete for RewardsAscended delivery.`);
  const client = new SftpClient(`khaos-nexus-rewards-${prefix.toLowerCase()}`);
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout });
  return { client, settings };
}

async function readText(client, file) {
  const data = await client.get(file);
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
}

function parseConfig(text, remoteFile) {
  try {
    const parsed = JSON.parse(String(text || ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root must be an object');
    return parsed;
  } catch (error) {
    throw new Error(`RewardsAscended config is not valid JSON at ${remoteFile}: ${error.message}`);
  }
}

async function inspectRewardsAscended(prefix, env = process.env) {
  const { client, settings } = await connect(prefix, env);
  try {
    const configFile = remotePath(settings.root, configRelativePath(prefix, env));
    const pluginInfoFile = remotePath(settings.root, pluginInfoRelativePath(prefix, env));
    const configExists = await client.exists(configFile);
    if (!configExists) return { found: false, prefix, configFile, pluginInfoFile, reason: 'config-not-found' };
    const config = parseConfig(await readText(client, configFile), configFile);
    let pluginInfo = null;
    if (await client.exists(pluginInfoFile)) {
      try { pluginInfo = JSON.parse(await readText(client, pluginInfoFile)); } catch { pluginInfo = null; }
    }
    return {
      found: true,
      prefix,
      configFile,
      pluginInfoFile,
      version: Number(pluginInfo?.Version || 0) || null,
      fullName: String(pluginInfo?.FullName || 'Rewards Ascended'),
      usesOverride: config?.Config?.UseOverride === true,
      overridePath: String(config?.Config?.OverridePath || '').trim()
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function upsertOrderReward(prefix, row, saddleBlueprint = '', env = process.env) {
  const rewardId = rewardIdForOrder(row);
  const desired = buildRewardEntry({ blueprint: row.blueprint, level: Number(row.rolled_level), sex: row.sex, saddleBlueprint });
  const { client, settings } = await connect(prefix, env);
  try {
    const relative = configRelativePath(prefix, env);
    const configFile = remotePath(settings.root, relative);
    if (!(await client.exists(configFile))) {
      const error = new Error(`RewardsAscended config not found at ${configFile}.`);
      error.code = 'REWARDS_ASCENDED_NOT_FOUND';
      throw error;
    }
    const pluginInfoFile = remotePath(settings.root, pluginInfoRelativePath(prefix, env));
    if (await client.exists(pluginInfoFile)) {
      try {
        const info = JSON.parse(await readText(client, pluginInfoFile));
        const version = Number(info?.Version || 0);
        if (version > 0 && version < 1.02) {
          const error = new Error(`RewardsAscended ${version} does not support Dino Cache cryopod delivery; version 1.02+ is required.`);
          error.code = 'REWARDS_ASCENDED_VERSION_UNSUPPORTED';
          throw error;
        }
      } catch (error) {
        if (error?.code === 'REWARDS_ASCENDED_VERSION_UNSUPPORTED') throw error;
      }
    }
    const currentText = await readText(client, configFile);
    const config = parseConfig(currentText, configFile);
    if (config?.Config?.UseOverride === true) {
      const explicitEffective = String(env[`${prefix}_REWARDS_ASCENDED_EFFECTIVE_CONFIG_PATH`] || env.NEXUS_REWARDS_ASCENDED_EFFECTIVE_CONFIG_PATH || '').trim();
      if (!explicitEffective) {
        const error = new Error(`RewardsAscended uses OverridePath (${String(config?.Config?.OverridePath || 'unspecified')}); set ${prefix}_REWARDS_ASCENDED_EFFECTIVE_CONFIG_PATH to the SFTP-visible effective config before automated delivery.`);
        error.code = 'REWARDS_ASCENDED_OVERRIDE_REQUIRES_PATH';
        throw error;
      }
      return await upsertEffectiveOrderReward({ client, settings, prefix, relative: explicitEffective, rewardId, desired });
    }
    return await upsertEffectiveOrderReward({ client, settings, prefix, relative, rewardId, desired, currentText, currentConfig: config });
  } finally {
    await client.end().catch(() => {});
  }
}

async function upsertEffectiveOrderReward({ client, settings, prefix, relative, rewardId, desired, currentText = null, currentConfig = null }) {
  const configFile = remotePath(settings.root, relative);
  if (!(await client.exists(configFile))) {
    const error = new Error(`RewardsAscended effective config not found at ${configFile}.`);
    error.code = 'REWARDS_ASCENDED_NOT_FOUND';
    throw error;
  }
  const beforeText = currentText === null ? await readText(client, configFile) : currentText;
  const config = currentConfig || parseConfig(beforeText, configFile);
  if (!config.Rewards || typeof config.Rewards !== 'object' || Array.isArray(config.Rewards)) config.Rewards = {};
  if (sameJson(config.Rewards[rewardId], desired)) return { prefix, rewardId, configFile, changed: false, reward: desired, backup: null };

  config.Rewards[rewardId] = desired;
  const nextText = `${JSON.stringify(config, null, 2)}\n`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const parent = path.posix.dirname(configFile.replace(/\\/g, '/'));
  const backupDir = path.posix.join(parent, 'NexusBackups', stamp);
  await client.mkdir(backupDir, true);
  const backup = path.posix.join(backupDir, 'config.json');
  await client.put(Buffer.from(beforeText, 'utf8'), backup);
  await client.put(Buffer.from(nextText, 'utf8'), configFile);
  const verifyText = await readText(client, configFile);
  const verify = parseConfig(verifyText, configFile);
  if (!sameJson(verify?.Rewards?.[rewardId], desired)) throw new Error(`RewardsAscended config verification failed after writing ${configFile}.`);
  return { prefix, rewardId, configFile, changed: true, reward: desired, backup };
}

function classifyReloadResult(result = {}) {
  const response = String(result?.response || '').trim();
  if (/^Reloaded config$/i.test(response)) return { ok: true, response };
  if (/failed to reload config|unknown command|not found|invalid|error/i.test(response)) return { ok: false, response: response || 'RewardsAscended reload rejected.' };
  return { ok: false, response: response || result?.status || 'RewardsAscended reload did not return an acknowledgement.' };
}

function classifyRewardResult(result = {}) {
  const response = String(result?.response || '').trim();
  if (/^Player rewarded!$/i.test(response)) return { state: 'DELIVERED', failureClass: '', details: response };
  if (/failed to give reward to player|unknown command|not found|invalid|error/i.test(response)) return { state: 'DELIVERY_FAILED', failureClass: 'REWARDS_ASCENDED_REJECTED', details: response || 'RewardsAscended rejected the reward command.' };
  if (result?.status === 'sent_no_reply' || result?.status === 'sent_blank_reply' || !response) return { state: 'SENT_UNCONFIRMED', failureClass: 'REWARDS_ASCENDED_UNCONFIRMED', details: response || result?.status || 'RewardsAscended reward command sent without acknowledgement.' };
  return { state: 'SENT_UNCONFIRMED', failureClass: 'REWARDS_ASCENDED_UNCONFIRMED', details: response };
}

async function deliverWithRewardsAscended({ prefix, row, saddleBlueprint = '', client }) {
  const configured = await upsertOrderReward(prefix, row, saddleBlueprint);
  let reloadResult;
  try { reloadResult = await client.executeDetailed('RA.Reload'); }
  catch (error) {
    const wrapped = new Error(`RewardsAscended reload transport failed before reward send: ${String(error?.message || error).slice(0, 400)}`);
    wrapped.code = 'REWARDS_ASCENDED_RELOAD_FAILED';
    wrapped.beforeRewardSend = true;
    wrapped.configured = configured;
    throw wrapped;
  }
  const reload = classifyReloadResult(reloadResult);
  if (!reload.ok) {
    const error = new Error(`RewardsAscended reload was not acknowledged: ${reload.response}`);
    error.code = 'REWARDS_ASCENDED_RELOAD_FAILED';
    error.beforeRewardSend = true;
    error.configured = configured;
    throw error;
  }
  const command = `RA.Reward ${String(row.player_eos_id).trim()} ${configured.rewardId}`;
  let result;
  try {
    result = await client.executeDetailed(command);
  } catch (error) {
    return {
      backend: 'rewardsascended',
      command,
      configured,
      result: null,
      outcome: { state: 'SENT_UNCONFIRMED', failureClass: 'REWARDS_ASCENDED_RCON_AMBIGUOUS', details: `RA.Reward transport became ambiguous after send: ${String(error?.message || error).slice(0, 400)}` }
    };
  }
  return { backend: 'rewardsascended', command, configured, result, outcome: classifyRewardResult(result) };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  DEFAULT_PLUGIN_INFO,
  backendMode,
  fallbackEnabled,
  configRelativePath,
  pluginInfoRelativePath,
  rewardIdForOrder,
  blueprintRef,
  buildRewardEntry,
  inspectRewardsAscended,
  upsertOrderReward,
  classifyReloadResult,
  classifyRewardResult,
  deliverWithRewardsAscended
};
