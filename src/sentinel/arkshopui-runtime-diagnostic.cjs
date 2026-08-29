'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');
const { findRemoteFile } = require('./ark-sftp-discovery.cjs');
const { resolveLiveConfig } = require('./arkshop-ui-live-deploy.cjs');

const ENV_KEY = 'ARK_GEN1_ARKSHOPUI_RUNTIME_DIAGNOSTIC_ONCE';
const LOG_FILE = 'ShooterGame/Saved/Logs/ShooterGame.log';

function token() { return String(process.env[ENV_KEY] || '').trim(); }
function clean(value, max = 300) { return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max); }
function safeToken(value) { return clean(value, 80).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'probe'; }
function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function stampFile(value = token()) { return path.join(dataDir(), `arkshopui-runtime-${safeToken(value)}.done.json`); }

function safeConfig(config = {}) {
  const keys = ['UiKey','ShopName','DisableSellButton','DisableTradeButton','HideBuffIcon','VoteRewards','UseSteamOverlay','OverrideCurrencyIcon','WebsiteUrl','DiscordUrl'];
  return Object.fromEntries(keys.filter((key) => Object.prototype.hasOwnProperty.call(config, key)).map((key) => [key, clean(config[key], 300)]));
}

async function readText(client, file, maxBytes = 8 * 1024 * 1024) {
  const exists = await client.exists(file);
  if (!exists || exists === 'd') return null;
  const stat = await client.stat(file);
  if (Number(stat?.size || 0) > maxBytes) return { tooLarge: true, size: Number(stat?.size || 0) };
  const bytes = await client.get(file);
  return Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes || '');
}

async function runOnce(value = token(), { Client = SftpClient } = {}) {
  if (!value) return { skipped: 'not-requested' };
  const stamp = stampFile(value);
  if (fs.existsSync(stamp)) return { skipped: 'already-applied', stamp };
  const settings = sftpSettingsFromEnv('ARK_GEN1');
  if (!settings.host || !settings.username || !settings.password) throw new Error('ARK SFTP variables are incomplete.');
  const client = new Client('khaos-nexus-arkshopui-runtime-diagnostic');
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout });
  try {
    let resolvedConfigPath = '';
    let resolutionError = '';
    try { resolvedConfigPath = await resolveLiveConfig(client, settings); }
    catch (error) { resolutionError = clean(error?.message || error, 500); }

    const pluginDir = resolvedConfigPath ? path.posix.dirname(resolvedConfigPath) : '';
    let files = [];
    if (pluginDir) {
      files = (await client.list(pluginDir).catch(() => [])).map((entry) => ({ name: clean(entry.name, 160), type: clean(entry.type, 4), size: Number(entry.size || 0) })).filter((entry) => entry.name && !/password|secret|token/i.test(entry.name)).slice(0, 100);
    }

    let config = null;
    if (resolvedConfigPath) {
      const text = await readText(client, resolvedConfigPath, 256 * 1024);
      if (typeof text === 'string') {
        try { config = JSON.parse(text); } catch { config = { invalidJson: true }; }
      }
    }

    let resolvedLogPath = '';
    try {
      const foundLog = await findRemoteFile(client, {
        configuredRoot: settings.root,
        configuredPath: LOG_FILE,
        preferredSuffix: LOG_FILE,
        fileName: 'ShooterGame.log',
        maxDepth: 7
      });
      resolvedLogPath = foundLog?.path || '';
    } catch {}

    const logText = resolvedLogPath ? await readText(client, resolvedLogPath) : null;
    let logMatches = [];
    let logState = 'missing';
    if (typeof logText === 'string') {
      logState = 'read';
      logMatches = logText.split(/\r?\n/).filter((line) => /arkshopui|arkshop|fc_arkshopui|loading plugin|plugin loaded/i.test(line)).slice(-160).map((line) => clean(line, 700));
    } else if (logText?.tooLarge) logState = `too-large:${logText.size}`;

    const names = files.map((entry) => entry.name);
    const result = {
      completedAt: new Date().toISOString(),
      resolvedConfigPath: clean(resolvedConfigPath, 500),
      resolutionError,
      pluginDir: clean(pluginDir, 500),
      files,
      hasDllLikeBinary: names.some((name) => /\.dll$/i.test(name)),
      configFile: resolvedConfigPath ? path.posix.basename(resolvedConfigPath) : '',
      config: config?.invalidJson ? { invalidJson: true } : safeConfig(config || {}),
      resolvedLogPath: clean(resolvedLogPath, 500),
      logState,
      logMatches
    };
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(stamp, JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(`[Nexus Sentinal] ArkShopUI runtime diagnostic COMPLETE: config=${result.resolvedConfigPath || 'missing'} files=${files.length} binary=${result.hasDllLikeBinary} log=${result.logState} logMatches=${logMatches.length}`);
    if (result.resolutionError) console.log(`[Nexus Sentinal] ArkShopUI runtime diagnostic resolution: ${result.resolutionError}`);
    return { ...result, stamp };
  } finally {
    await client.end().catch(() => {});
  }
}

function installArkShopUiRuntimeDiagnostic({ delayMs = 30000 } = {}) {
  const value = token();
  if (!value) return { enabled: false };
  const timer = setTimeout(() => { void runOnce(value).catch((error) => console.error(`[Nexus Sentinal] ArkShopUI runtime diagnostic FAILED CLOSED: ${clean(error?.message || error, 400)}`)); }, Math.max(5000, Number(delayMs) || 30000));
  timer.unref?.();
  console.log(`[Nexus Sentinal] ArkShopUI runtime diagnostic armed via ${ENV_KEY}; read-only resolved-path inspection only.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, LOG_FILE, safeConfig, runOnce, installArkShopUiRuntimeDiagnostic };
