'use strict';

const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');

function isDirectory(item) {
  return item?.type === 'd' || String(item?.permissions || '').startsWith('d');
}

function safeName(value) {
  return String(value || '').replace(/[\r\n|]/g, '_').slice(0, 100);
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

    // One shallow level is enough to spot common Citadel wrappers such as a
    // server-id/home directory containing ShooterGame without crawling data.
    for (const directory of directories.slice(0, 30)) {
      let nested;
      try {
        nested = await client.list(directory);
      } catch {
        continue;
      }
      const nestedDirs = nested.filter(isDirectory).map((item) => safeName(item.name)).filter(Boolean).slice(0, 40);
      if (nestedDirs.some((name) => name.toLowerCase() === 'shootergame')) {
        children.push(`${directory}/ShooterGame`);
      }
    }

    return {
      cwd: safeName(cwd),
      configuredRoot: safeName(settings.root || '.'),
      directories,
      files,
      shooterGameCandidates: children
    };
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { inspectSftpLayout };
