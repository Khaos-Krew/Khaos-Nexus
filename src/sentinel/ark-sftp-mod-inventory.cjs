'use strict';

const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');
const { findDirectoryNamed, joinRemote } = require('./ark-sftp-discovery.cjs');

const MOD_PLATFORM_ID = '83374';
const MAX_MOD_ENTRIES = 500;
const MOD_DIRECTORY_SUFFIXES = Object.freeze([
  `Mods/${MOD_PLATFORM_ID}`,
  `Content/Mods/${MOD_PLATFORM_ID}`
]);

function parseInstalledModEntries(entries = []) {
  const byProject = new Map();
  for (const entry of Array.isArray(entries) ? entries.slice(0, MAX_MOD_ENTRIES) : []) {
    const name = String(entry?.name || '').trim();
    const match = name.match(/^(\d{5,10})(?:[_\-.](\d{1,14}))?(?:[_\-.]|$)/);
    if (!match) continue;
    const projectId = match[1];
    const fileId = match[2] || '';
    const current = byProject.get(projectId);
    if (!current || (!current.fileId && fileId)) {
      byProject.set(projectId, { projectId, fileId });
    }
  }
  return [...byProject.values()].sort((left, right) => Number(left.projectId) - Number(right.projectId)).slice(0, 60);
}

async function inspectInstalledArkMods(prefix = 'ARK_GEN1', dependencies = {}) {
  const settings = dependencies.settings || sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) throw new Error('ARK SFTP variables are incomplete.');
  const client = dependencies.client || new SftpClient('khaos-nexus-ark-mod-inventory');
  const ownsClient = !dependencies.client;
  if (ownsClient) {
    await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout });
  }
  try {
    const shooterGame = dependencies.shooterGameRoot
      ? { path: dependencies.shooterGameRoot }
      : await findDirectoryNamed(client, {
          starts: [settings.root || '.', '.'], directoryName: 'ShooterGame',
          maxDepth: 4, maxDirectories: 100, maxEntries: 1500
        });
    if (!shooterGame) return { accessible: false, reason: 'ShooterGame directory not found', mods: [], modIds: [] };

    for (const suffix of MOD_DIRECTORY_SUFFIXES) {
      const directory = joinRemote(shooterGame.path, suffix);
      try {
        const entries = await client.list(directory);
        const mods = parseInstalledModEntries(entries);
        return { accessible: true, directory, mods, modIds: mods.map((mod) => mod.projectId) };
      } catch {}
    }
    return { accessible: false, reason: 'ASA CurseForge mod directory is not exposed in the SFTP view', mods: [], modIds: [] };
  } finally {
    if (ownsClient) await client.end().catch(() => {});
  }
}

module.exports = {
  MOD_PLATFORM_ID,
  MAX_MOD_ENTRIES,
  MOD_DIRECTORY_SUFFIXES,
  parseInstalledModEntries,
  inspectInstalledArkMods
};
