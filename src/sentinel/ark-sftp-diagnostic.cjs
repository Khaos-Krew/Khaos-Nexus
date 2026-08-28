'use strict';

const crypto = require('node:crypto');
const { Writable } = require('node:stream');
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

async function sha256RemoteFile(client, remotePath, maxBytes = 2 * 1024 * 1024 * 1024) {
  const stat = await client.stat(remotePath);
  const size = Number(stat?.size || 0);
  if (!size || size > maxBytes) return { hash: '', bytes: size, error: size ? 'file-too-large' : 'file-empty' };

  const hasher = crypto.createHash('sha256');
  let bytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      hasher.update(chunk);
      bytes += chunk.length;
      callback();
    }
  });

  try {
    await client.get(remotePath, sink);
    return { hash: hasher.digest('hex'), bytes, error: '' };
  } catch (error) {
    return { hash: '', bytes, error: String(error?.message || error).slice(0, 160) };
  }
}

async function checkCacheMirrors(hash) {
  if (!/^[a-f0-9]{64}$/.test(String(hash || ''))) return [];
  const bases = [
    'https://cdn.pelayori.com/cache/',
    'https://cdn.shadowhunter.co.za/cache/',
    'https://cdn.shadowhunter-systems.co.za/cache/'
  ];
  const results = [];
  for (const base of bases) {
    const url = `${base}${hash}.zip`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    timer.unref?.();
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal });
      results.push({
        base,
        status: response.status,
        available: response.ok,
        length: Number(response.headers.get('content-length') || 0),
        modified: safeName(response.headers.get('last-modified') || '')
      });
    } catch (error) {
      results.push({ base, status: 0, available: false, length: 0, modified: '', error: safeName(error?.name || error?.message || error) });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
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

    if (win64Path) {
      const exeProbe = await sha256RemoteFile(client, `${win64Path}/ArkAscendedServer.exe`);
      console.log(`[Nexus Sentinal] ARK executable hash: sha256=${exeProbe.hash || 'unavailable'} bytes=${exeProbe.bytes || 0} error=${exeProbe.error || 'none'} cacheMatch=${Boolean(exeProbe.hash && exeProbe.hash === cacheKey.hash)}`);
      if (exeProbe.hash) {
        const mirrors = await checkCacheMirrors(exeProbe.hash);
        console.log(`[Nexus Sentinal] ASA API cache mirrors: ${mirrors.map((item) => `${new URL(item.base).host}=${item.available ? 'available' : `http-${item.status || 'error'}`}${item.length ? `:${item.length}` : ''}`).join(' ') || '(none)'}`);
        framework.executableHash = exeProbe.hash;
        framework.executableBytes = exeProbe.bytes;
        framework.cacheMatchesExecutable = exeProbe.hash === cacheKey.hash;
        framework.cacheMirrors = mirrors;
      }
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

module.exports = { parseCacheKey, safeCacheConfig, sha256RemoteFile, checkCacheMirrors, inspectSftpLayout };
