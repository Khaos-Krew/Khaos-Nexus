'use strict';

const path = require('node:path');

function normalizeRemote(value) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  if (!text || text === '/') return '.';
  return text.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '.';
}

function joinRemote(base, child) {
  const left = normalizeRemote(base);
  const right = String(child || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return left === '.' ? right : path.posix.join(left, right);
}

function isDirectory(item) {
  return item?.type === 'd' || String(item?.permissions || '').startsWith('d');
}

function shouldSkipDirectory(name) {
  const value = String(name || '').toLowerCase();
  return new Set([
    'nexusbackups', 'logs', 'log', 'savedarks', 'savedarkscloud', 'savedarkslocal',
    'content', 'mods', 'steamapps', 'crashreportclient', 'crashes', 'screenshots'
  ]).has(value);
}

async function existsFile(client, remoteFile) {
  try {
    const result = await client.exists(remoteFile);
    return result && result !== 'd';
  } catch {
    return false;
  }
}

async function findRemoteFile(client, {
  configuredRoot = '',
  configuredPath = '',
  fileName,
  preferredSuffix = '',
  maxDepth = 8,
  maxDirectories = 450,
  maxEntries = 5000
} = {}) {
  const wantedName = String(fileName || path.posix.basename(String(configuredPath || preferredSuffix || ''))).trim();
  if (!wantedName) throw new Error('SFTP discovery requires a target file name.');

  const suffix = normalizeRemote(preferredSuffix || configuredPath).replace(/^\.\//, '').toLowerCase();
  const directCandidates = [];
  const addCandidate = (value) => {
    const normalized = normalizeRemote(value);
    if (normalized !== '.' && !directCandidates.includes(normalized)) directCandidates.push(normalized);
  };

  if (configuredPath) {
    addCandidate(configuredPath);
    if (configuredRoot) addCandidate(joinRemote(configuredRoot, configuredPath));
  }
  if (preferredSuffix) {
    addCandidate(preferredSuffix);
    if (configuredRoot) addCandidate(joinRemote(configuredRoot, preferredSuffix));
  }

  for (const candidate of directCandidates) {
    if (await existsFile(client, candidate)) return { path: candidate, discovered: false };
  }

  const starts = [];
  const addStart = (value) => {
    const normalized = normalizeRemote(value);
    if (!starts.includes(normalized)) starts.push(normalized);
  };
  if (configuredRoot) addStart(configuredRoot);
  addStart('.');

  const queue = starts.map((base) => ({ base, depth: 0 }));
  const visited = new Set();
  const fallbackMatches = [];
  let directories = 0;
  let entriesSeen = 0;

  while (queue.length && directories < maxDirectories && entriesSeen < maxEntries) {
    const { base, depth } = queue.shift();
    const key = normalizeRemote(base);
    if (visited.has(key)) continue;
    visited.add(key);
    directories += 1;

    let entries;
    try {
      entries = await client.list(base);
    } catch {
      continue;
    }
    entriesSeen += entries.length;

    for (const item of entries) {
      const name = String(item?.name || '');
      if (!name || name === '.' || name === '..') continue;
      const remote = joinRemote(base, name);
      if (!isDirectory(item)) {
        if (name.toLowerCase() !== wantedName.toLowerCase()) continue;
        const lowerRemote = remote.toLowerCase();
        if (suffix && lowerRemote.endsWith(suffix)) {
          return { path: remote, discovered: true, directoriesScanned: directories, entriesSeen };
        }
        fallbackMatches.push(remote);
        continue;
      }

      if (depth >= maxDepth || shouldSkipDirectory(name)) continue;
      queue.push({ base: remote, depth: depth + 1 });
    }
  }

  if (fallbackMatches.length === 1) {
    return { path: fallbackMatches[0], discovered: true, directoriesScanned: directories, entriesSeen };
  }
  if (fallbackMatches.length > 1) {
    throw new Error(`SFTP discovery found multiple ${wantedName} files. Set an explicit path variable to select the correct one.`);
  }
  throw new Error(`SFTP discovery could not find ${wantedName} within the permitted server tree.`);
}

module.exports = { normalizeRemote, joinRemote, findRemoteFile };
