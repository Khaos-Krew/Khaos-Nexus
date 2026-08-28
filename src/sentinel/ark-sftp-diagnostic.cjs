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
    const pluginsPath = arkApiPath ? `${arkApiPath}/Plugins` : '';

    const framework = win64Path ? {
      asaApiLoader: await exists(client, `${win64Path}/AsaApiLoader.exe`),
      asaApiDll: await exists(client, `${arkApiPath}/AsaApi.dll`),
      apiConfig: await exists(client, `${win64Path}/config.json`),
      versionDll: await exists(client, `${win64Path}/Version.dll`),
      arkApiDirectory: await exists(client, arkApiPath)
    } : {
      asaApiLoader: false,
      asaApiDll: false,
      apiConfig: false,
      versionDll: false,
      arkApiDirectory: false
    };

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

module.exports = { inspectSftpLayout };
