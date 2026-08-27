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
    return Boolean(result) && result !== 'd';
  } catch {
    return false;
  }
}

async function findDirectoryNamed(client, {
  starts = ['.'],
  directoryName,
  maxDepth = 4,
  maxDirectories = 100,
  maxEntries = 1500
} = {}) {
  const wanted = String(directoryName || '').trim().toLowerCase();
  if (!wanted) throw new Error('Directory discovery requires a directory name.');

  const queue = [];
  const queued = new Set();
  for (const start of starts) {
    const normalized = normalizeRemote(start);
    if (queued.has(normalized)) continue;
    queued.add(normalized);
    queue.push({ base: normalized, depth: 0 });
  }

  const visited = new Set();
  let directories = 0;
  let entriesSeen = 0;

  while (queue.length && directories < maxDirectories && entriesSeen < maxEntries) {
    const { base, depth } = queue.shift();
    const normalized = normalizeRemote(base);
    if (visited.has(normalized)) continue;
    visited.add(normalized);
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
      if (!name || name === '.' || name === '..' || !isDirectory(item)) continue;
      const remote = joinRemote(base, name);
      if (name.toLowerCase() === wanted) {
        return { path: remote, directoriesScanned: directories, entriesSeen };
      }
      if (depth >= maxDepth || shouldSkipDirectory(name)) continue;
      queue.push({ base: remote, depth: depth + 1 });
    }
  }

  return null;
}

async function findRemoteFile(client, {
  configuredRoot = '',
  configuredPath = '',
  fileName,
  preferredSuffix = '',
  maxDepth = 6,
  maxDirectories = 160,
  maxEntries = 2500
} = {}) {
  const wantedName = String(fileName || path.posix.basename(String(configuredPath || preferredSuffix || ''))).trim();
  if (!wantedName) throw new Error('SFTP discovery requires a target file name.');

  const suffixRaw = String(preferredSuffix || configuredPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const suffix = suffixRaw.toLowerCase();
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

  // Citadel's ARK layout is rooted at <Home>/ShooterGame. Locate that directory
  // shallowly first, then test the exact known suffix instead of crawling the tree.
  if (/^shootergame\//i.test(suffixRaw)) {
    const starts = [];
    if (configuredRoot) starts.push(configuredRoot);
    starts.push('.');
    const shooterGame = await findDirectoryNamed(client, {
      starts,
      directoryName: 'ShooterGame',
      maxDepth: 4,
      maxDirectories: 100,
      maxEntries: 1500
    });
    if (shooterGame) {
      const remainder = suffixRaw.replace(/^shootergame\//i, '');
      const candidate = joinRemote(shooterGame.path, remainder);
      if (await existsFile(client, candidate)) {
        return {
          path: candidate,
          discovered: true,
          directoriesScanned: shooterGame.directoriesScanned,
          entriesSeen: shooterGame.entriesSeen,
          shooterGameRoot: shooterGame.path
        };
      }
    }
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

module.exports = { normalizeRemote, joinRemote, findDirectoryNamed, findRemoteFile };
