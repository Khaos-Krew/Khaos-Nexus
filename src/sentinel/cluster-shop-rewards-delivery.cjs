'use strict';

const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv, remotePath } = require('./ark-sftp-config.cjs');
const { classifyReloadResult, classifyRewardResult, configRelativePath } = require('./rewards-ascended-delivery.cjs');

function rewardIdForShopOrder(order = {}) {
  const raw = String(order.orderId || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!raw) throw new Error('Cluster Shop order is missing a stable order id.');
  return `NexusShop_${raw}`.slice(0, 60);
}

function blueprintRef(value) {
  const raw = String(value || '').trim();
  if (!/^\/(?:Game|SDinoVariants|RunicWyverns|TG_Stack_10000_90|DinoDepot|CrazysPotions|PotionsHelpers)\/[A-Za-z0-9_./-]{8,230}$/.test(raw)) {
    throw new Error(`RewardsAscended item blueprint path is invalid: ${raw.slice(0, 120)}`);
  }
  return `Blueprint'${raw}'`;
}

function rewardItem({ blueprint, amount, quality = 0, forceBlueprint = false } = {}) {
  const count = Number(amount);
  if (!Number.isSafeInteger(count) || count <= 0 || count > 1000000) throw new Error('Cluster Shop delivery amount is invalid.');
  const itemQuality = Number.isFinite(Number(quality)) ? Math.max(0, Number(quality)) : 0;
  return {
    Blueprint: blueprintRef(blueprint),
    Quality: itemQuality,
    ForceBlueprint: forceBlueprint === true,
    Amount: count,
    Armor: 0,
    Durability: 0,
    Damage: 0,
    UseRandomQuality: false,
    MinRandomQuality: 0,
    MaxRandomQuality: 0,
    UseRandomAmount: false,
    MinRandomAmount: count,
    MaxRandomAmount: count
  };
}

function itemRewardEntry(order = {}) {
  const quote = order.quote || {};
  const metadata = quote.metadata && typeof quote.metadata === 'object' ? quote.metadata : {};
  const bundleCount = Number(quote.bundles || 1);
  if (!Number.isSafeInteger(bundleCount) || bundleCount <= 0 || bundleCount > 10000) throw new Error('Cluster Shop bundle count is invalid.');

  if (Array.isArray(metadata.deliveryItems) && metadata.deliveryItems.length) {
    if (metadata.deliveryItems.length > 100) throw new Error('Cluster Shop kit contains too many delivery items.');
    return {
      Items: metadata.deliveryItems.map((item) => rewardItem({
        blueprint: item?.blueprint,
        amount: Number(item?.amount) * bundleCount,
        quality: item?.quality,
        forceBlueprint: item?.forceBlueprint
      }))
    };
  }

  return {
    Items: [rewardItem({
      blueprint: quote.blueprint,
      amount: Number(quote.totalQuantity),
      quality: metadata.quality,
      forceBlueprint: metadata.forceBlueprint
    })]
  };
}

async function connect(prefix, env = process.env) {
  const settings = sftpSettingsFromEnv(prefix, env);
  if (!settings.host || !settings.username || !settings.password) throw new Error(`${prefix} SFTP variables are incomplete for RewardsAscended delivery.`);
  const client = new SftpClient(`khaos-nexus-shop-rewards-${String(prefix).toLowerCase()}`);
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout });
  return { client, settings };
}

async function readText(client, file) {
  const data = await client.get(file);
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
}

function parseConfig(text, file) {
  try {
    const parsed = JSON.parse(String(text || ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('root must be an object');
    return parsed;
  } catch (error) {
    throw new Error(`RewardsAscended config is not valid JSON at ${file}: ${error.message}`);
  }
}

async function upsertShopReward(prefix, order, env = process.env, connector = connect) {
  const rewardId = rewardIdForShopOrder(order);
  const desired = itemRewardEntry(order);
  const { client, settings } = await connector(prefix, env);
  try {
    const relative = configRelativePath(prefix, env);
    const configFile = remotePath(settings.root, relative);
    if (!(await client.exists(configFile))) {
      const error = new Error(`RewardsAscended config not found at ${configFile}.`);
      error.code = 'REWARDS_ASCENDED_NOT_FOUND';
      throw error;
    }
    const beforeText = await readText(client, configFile);
    const config = parseConfig(beforeText, configFile);
    if (config?.Config?.UseOverride === true) {
      const error = new Error('RewardsAscended override configs are not modified by Cluster Shop delivery until an explicit effective config path is configured.');
      error.code = 'REWARDS_ASCENDED_OVERRIDE_REQUIRES_PATH';
      throw error;
    }
    if (!config.Rewards || typeof config.Rewards !== 'object' || Array.isArray(config.Rewards)) config.Rewards = {};
    if (JSON.stringify(config.Rewards[rewardId]) === JSON.stringify(desired)) return { prefix, rewardId, configFile, changed: false, reward: desired, backup: null };

    config.Rewards[rewardId] = desired;
    const nextText = `${JSON.stringify(config, null, 2)}\n`;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const parent = path.posix.dirname(configFile.replace(/\\/g, '/'));
    const backupDir = path.posix.join(parent, 'NexusBackups', stamp);
    await client.mkdir(backupDir, true);
    const backup = path.posix.join(backupDir, 'config.json');
    await client.put(Buffer.from(beforeText, 'utf8'), backup);
    await client.put(Buffer.from(nextText, 'utf8'), configFile);
    const verify = parseConfig(await readText(client, configFile), configFile);
    if (JSON.stringify(verify?.Rewards?.[rewardId]) !== JSON.stringify(desired)) throw new Error(`RewardsAscended config verification failed after writing ${configFile}.`);
    return { prefix, rewardId, configFile, changed: true, reward: desired, backup };
  } finally {
    await client.end().catch(() => {});
  }
}

async function deliverShopOrderWithRewardsAscended({ prefix, order, client, env = process.env, connector } = {}) {
  if (!client?.executeDetailed) throw new Error('RCON client is required for Cluster Shop delivery.');
  let configured;
  try {
    configured = await upsertShopReward(prefix, order, env, connector || connect);
  } catch (error) {
    error.beforeRewardSend = true;
    throw error;
  }

  let reloadResult;
  try { reloadResult = await client.executeDetailed('RA.Reload'); }
  catch (error) {
    const wrapped = new Error(`RewardsAscended reload transport failed before reward send: ${String(error?.message || error).slice(0, 400)}`);
    wrapped.code = 'REWARDS_ASCENDED_RELOAD_FAILED';
    wrapped.beforeRewardSend = true;
    throw wrapped;
  }
  const reload = classifyReloadResult(reloadResult);
  if (!reload.ok) {
    const error = new Error(`RewardsAscended reload was not acknowledged: ${reload.response}`);
    error.code = 'REWARDS_ASCENDED_RELOAD_FAILED';
    error.beforeRewardSend = true;
    throw error;
  }

  const eosId = String(order.eosId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(eosId)) throw new Error('Cluster Shop order is missing a valid EOS id.');
  const command = `RA.Reward ${eosId} ${configured.rewardId}`;
  let result;
  try { result = await client.executeDetailed(command); }
  catch (error) {
    return { configured, command, result: null, outcome: { state: 'SENT_UNCONFIRMED', failureClass: 'REWARDS_ASCENDED_RCON_AMBIGUOUS', details: `RA.Reward transport became ambiguous after send: ${String(error?.message || error).slice(0, 400)}` } };
  }
  return { configured, command, result, outcome: classifyRewardResult(result) };
}

module.exports = {
  rewardIdForShopOrder,
  blueprintRef,
  rewardItem,
  itemRewardEntry,
  upsertShopReward,
  deliverShopOrderWithRewardsAscended
};
