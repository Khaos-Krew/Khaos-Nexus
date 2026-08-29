'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv, remotePath } = require('./ark-sftp-config.cjs');
const { findRemoteFile } = require('./ark-sftp-discovery.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { CONFIG_CANDIDATES, mergeArkShopUiConfig, configsEqual } = require('./arkshop-ui-sync.cjs');
const { productionSafe } = require('./arkshop-ui-config.cjs');

const VERSION = 'nexus-arkshopui-launch-v3-sell';
const DESIRED_PATH = path.resolve(__dirname, '../../config/ark/arkshopui/nexus-exchange.json');

function cleanError(error) {
  return String(error?.message || error || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 400);
}

function dataDir() {
  return path.resolve(process.env.NEXUS_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.resolve(__dirname, '../../data'));
}

function stampFile() {
  return path.join(dataDir(), `${VERSION}.done.json`);
}

function timestampFolder(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function readDesiredConfig() {
  const desired = JSON.parse(fs.readFileSync(DESIRED_PATH, 'utf8'));
  const safety = productionSafe(desired);
  if (!safety.productionSafe) throw new Error(`Nexus ArkShopUI config is not production-safe: ${safety.blockers.join(', ')}`);
  return desired;
}

async function connectSftp(prefix, Client = SftpClient) {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) throw new Error('ARK SFTP variables are incomplete for ArkShopUI deployment.');
  const client = new Client('khaos-nexus-arkshopui-deploy');
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout });
  return { client, settings };
}

async function resolveLiveConfig(client, settings) {
  let lastError;
  for (const candidate of CONFIG_CANDIDATES) {
    try {
      const direct = remotePath(settings.root, candidate);
      const exists = await client.exists(direct);
      if (exists && exists !== 'd') return direct;
      const found = await findRemoteFile(client, {
        configuredRoot: settings.root,
        configuredPath: candidate,
        preferredSuffix: candidate,
        fileName: path.posix.basename(candidate),
        maxDepth: 9
      });
      if (found?.path) return found.path;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`ArkShopUI live config could not be resolved: ${cleanError(lastError)}`);
}

async function readText(client, remoteFile) {
  const value = await client.get(remoteFile);
  return Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
}

async function run({ prefix = 'ARK_GEN1', Client = SftpClient, RconClient = ArkRconClient } = {}) {
  const stamp = stampFile();
  if (fs.existsSync(stamp)) return { skipped: 'already-applied', stamp };

  const desired = readDesiredConfig();
  const server = arkServerFromEnv(prefix);
  if (!server.enabled) throw new Error(`${prefix} is not enabled.`);

  const { client, settings } = await connectSftp(prefix, Client);
  let remoteFile = '';
  let originalText = '';
  let backup = '';
  let changed = false;
  try {
    remoteFile = await resolveLiveConfig(client, settings);
    originalText = await readText(client, remoteFile);
    let live;
    try { live = JSON.parse(originalText); } catch (error) { throw new Error(`Live ArkShopUI config is invalid JSON: ${error.message}`); }
    if (!live || typeof live !== 'object' || Array.isArray(live)) throw new Error('Live ArkShopUI config root is not an object.');

    const merged = mergeArkShopUiConfig(live, desired);
    if (!Object.prototype.hasOwnProperty.call(desired, 'OverrideCurrencyIcon')) delete merged.OverrideCurrencyIcon;
    const nextText = `${JSON.stringify(merged, null, 2)}\n`;
    changed = originalText !== nextText;

    if (changed) {
      const parent = path.posix.dirname(remoteFile);
      const backupDir = path.posix.join(parent, 'NexusBackups', timestampFolder());
      await client.mkdir(backupDir, true);
      backup = path.posix.join(backupDir, path.posix.basename(remoteFile));
      await client.put(Buffer.from(originalText, 'utf8'), backup);
      await client.put(Buffer.from(nextText, 'utf8'), remoteFile);
      const verifyText = await readText(client, remoteFile);
      let verify;
      try { verify = JSON.parse(verifyText); } catch { verify = null; }
      if (!verify || !configsEqual(verify, merged)) {
        await client.put(Buffer.from(originalText, 'utf8'), remoteFile).catch(() => {});
        throw new Error('ArkShopUI write verification failed; previous config restored.');
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  let reloadResponse = '';
  try {
    const rcon = new RconClient(server);
    reloadResponse = await rcon.execute('ArkShop.Reload');
  } catch (error) {
    if (changed && backup && remoteFile && originalText) {
      const rollback = await connectSftp(prefix, Client);
      try { await rollback.client.put(Buffer.from(originalText, 'utf8'), remoteFile); }
      finally { await rollback.client.end().catch(() => {}); }
    }
    throw new Error(`ArkShopUI config ${changed ? 'was rolled back because ' : ''}ArkShop.Reload failed: ${cleanError(error)}`);
  }

  fs.mkdirSync(dataDir(), { recursive: true });
  const result = {
    version: VERSION,
    appliedAt: new Date().toISOString(),
    prefix,
    changed,
    backup: backup ? path.posix.basename(path.posix.dirname(backup)) + '/' + path.posix.basename(backup) : '',
    uiKey: desired.UiKey,
    shopName: desired.ShopName,
    sellDisabled: desired.DisableSellButton === true,
    tradeDisabled: desired.DisableTradeButton === true,
    currencyIconOverride: desired.OverrideCurrencyIcon || '',
    reloadCommand: 'ArkShop.Reload',
    reloadResponded: typeof reloadResponse === 'string'
  };
  fs.writeFileSync(stamp, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

module.exports = {
  VERSION,
  DESIRED_PATH,
  cleanError,
  dataDir,
  stampFile,
  readDesiredConfig,
  resolveLiveConfig,
  run
};
