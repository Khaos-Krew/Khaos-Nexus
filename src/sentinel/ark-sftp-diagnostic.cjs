'use strict';

const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');

function isDirectory(item) {
  return item?.type === 'd' || String(item?.permissions || '').startsWith('d');
}

function safeName(value) {
  return String(value || '').replace(/[\r\n|]/g, '_').slice(0, 140);
}

async function exists(client, remotePath) {
  try { return Boolean(await client.exists(remotePath)); } catch { return false; }
}

async function listDirectoryNames(client, remotePath, limit = 80) {
  try {
    const entries = await client.list(remotePath);
    return entries.map((item) => safeName(item.name)).filter(Boolean).slice(0, limit);
  } catch {
    return [];
  }
}

async function readSmallText(client, remotePath, maxBytes = 256 * 1024) {
  try {
    const stat = await client.stat(remotePath);
    if (!stat || Number(stat.size || 0) > maxBytes) return '';
    const data = await client.get(remotePath);
    return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  } catch {
    return '';
  }
}

function parseCacheKey(value) {
  const text = String(value || '').trim();
  if (!text) return { hash: '', cacheDirectory: '', lastModified: '' };
  try {
    const parsed = JSON.parse(text);
    const hash = String(parsed?.executable_hash || '').trim().toLowerCase();
    return {
      hash: /^[a-f0-9]{64}$/.test(hash) ? hash : '',
      cacheDirectory: safeName(parsed?.cache_directory || ''),
      lastModified: safeName(parsed?.last_modified || '')
    };
  } catch {
    const hash = text.toLowerCase();
    return { hash: /^[a-f0-9]{64}$/.test(hash) ? hash : '', cacheDirectory: '', lastModified: '' };
  }
}

function safeCacheConfig(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    const cfg = parsed?.settings?.AutomaticCacheDownload || {};
    const urls = [cfg.DownloadCacheURL, ...(Array.isArray(cfg.DownloadCacheURLs) ? cfg.DownloadCacheURLs : [])]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item) => {
        try { return new URL(item).origin; } catch { return ''; }
      })
      .filter(Boolean);
    return { enabled: cfg.Enable !== false, urls: [...new Set(urls)].slice(0, 6) };
  } catch {
    return { enabled: null, urls: [] };
  }
}

async function inspectSftpLayout(prefix = 'ARK_GEN1') {
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) {
    throw new Error('ARK SFTP variables are incomplete.');
  }

  const client = new SftpClient('khaos-nexus-ark-layout');
  await client.connect({
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    readyTimeout: settings.readyTimeout
  });

  try {
    const cwd = await client.cwd().catch(() => 'unknown');
    const entries = await client.list('.');
    const directories = entries.filter(isDirectory).map((item) => safeName(item.name)).filter(Boolean).slice(0, 80);
    const files = entries.filter((item) => !isDirectory(item)).map((item) => safeName(item.name)).filter(Boolean).slice(0, 40);
    const children = [];

    for (const directory of directories.slice(0, 30)) {
      let nested;
      try { nested = await client.list(directory); } catch { continue; }
      const nestedDirs = nested.filter(isDirectory).map((item) => safeName(item.name)).filter(Boolean).slice(0, 40);
      if (nestedDirs.some((name) => name.toLowerCase() === 'shootergame')) children.push(`${directory}/ShooterGame`);
    }

    const shooterGameRoot = children[0] || (directories.some((name) => name.toLowerCase() === 'shootergame') ? 'ShooterGame' : '');
    const gusPath = String(process.env[`${prefix}_GUS_PATH`] || '').trim();
    const gamePath = String(process.env[`${prefix}_GAMEINI_PATH`] || '').trim();
    const shopPath = String(process.env[`${prefix}_ARKSHOP_CONFIG_PATH`] || '').trim();
    const win64Path = shooterGameRoot ? `${shooterGameRoot}/Binaries/Win64` : '';
    const arkApiPath = win64Path ? `${win64Path}/ArkApi` : '';
    const cachePath = arkApiPath ? `${arkApiPath}/Cache` : '';
    const pluginsPath = arkApiPath ? `${arkApiPath}/Plugins` : '';

    const cacheKey = cachePath ? parseCacheKey(await readSmallText(client, `${cachePath}/cached_key.cache`, 64 * 1024)) : { hash: '', cacheDirectory: '', lastModified: '' };
    const cacheEntries = cachePath ? await listDirectoryNames(client, cachePath, 100) : [];
    const activeCachePath = cacheKey.cacheDirectory ? `${cachePath}/${cacheKey.cacheDirectory}` : cachePath;
    const activeCacheEntries = activeCachePath ? await listDirectoryNames(client, activeCachePath, 50) : [];
    const apiCacheConfig = win64Path ? safeCacheConfig(await readSmallText(client, `${win64Path}/config.json`, 256 * 1024)) : { enabled: null, urls: [] };

    const framework = win64Path ? {
      asaApiLoader: await exists(client, `${win64Path}/AsaApiLoader.exe`),
      asaApiDll: await exists(client, `${arkApiPath}/AsaApi.dll`),
      apiConfig: await exists(client, `${win64Path}/config.json`),
      versionDll: await exists(client, `${win64Path}/Version.dll`),
      arkApiDirectory: await exists(client, arkApiPath),
      cacheDirectory: await exists(client, cachePath),
      cacheKey,
      cacheEntries,
      activeCacheEntries,
      automaticCacheDownload: apiCacheConfig
    } : {
      asaApiLoader: false,
      asaApiDll: false,
      apiConfig: false,
      versionDll: false,
      arkApiDirectory: false,
      cacheDirectory: false,
      cacheKey: { hash: '', cacheDirectory: '', lastModified: '' },
      cacheEntries: [],
      activeCacheEntries: [],
      automaticCacheDownload: { enabled: null, urls: [] }
    };

    if (arkApiPath) {
      console.log(`[Nexus Sentinal] ASA API cache: cacheDir=${Boolean(framework.cacheDirectory)} keyHash=${framework.cacheKey.hash || 'missing'} generation=${framework.cacheKey.cacheDirectory || 'none'} autoDownload=${String(framework.automaticCacheDownload.enabled)} cacheEntries=${framework.cacheEntries.join(',') || '(none)'} activeEntries=${framework.activeCacheEntries.join(',') || '(none)'} mirrors=${framework.automaticCacheDownload.urls.join(',') || '(none)'}`);
    }

    return {
      cwd: safeName(cwd),
      configuredRoot: safeName(settings.root || '.'),
      directories,
      files,
      shooterGameCandidates: children,
      exact: {
        gus: gusPath ? await exists(client, gusPath) : false,
        game: gamePath ? await exists(client, gamePath) : false,
        arkshop: shopPath ? await exists(client, shopPath) : false
      },
      win64Path,
      win64Entries: win64Path ? await listDirectoryNames(client, win64Path, 100) : [],
      arkApiPath,
      framework,
      pluginsPath,
      plugins: pluginsPath ? await listDirectoryNames(client, pluginsPath, 80) : [],
      arkShopEntries: shooterGameRoot ? await listDirectoryNames(client, `${shooterGameRoot}/Binaries/Win64/ArkApi/Plugins/ArkShop`, 80) : []
    };
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { parseCacheKey, safeCacheConfig, inspectSftpLayout };
