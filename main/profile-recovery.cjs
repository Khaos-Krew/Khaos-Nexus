'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { candidateProfiles, profileSummary } = require('./startup-health-extension.cjs');

const SKIP_NAMES = new Set([
  'Cache', 'Code Cache', 'DawnCache', 'GPUCache', 'ShaderCache', 'Crashpad',
  'blob_storage', 'Session Storage', 'Local Storage', 'Network', 'Service Worker'
]);

function shouldSkip(name) {
  return SKIP_NAMES.has(name) || /^(Singleton|LOCK$|lockfile$)/i.test(name);
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) files += copyTree(from, to);
    else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      files += 1;
    }
  }
  return files;
}

function atomicOverlay(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (shouldSkip(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      files += atomicOverlay(from, to);
      continue;
    }
    if (!entry.isFile()) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const temporary = `${to}.v0183-restore-${process.pid}-${Date.now()}`;
    fs.copyFileSync(from, temporary);
    try {
      fs.renameSync(temporary, to);
    } catch (error) {
      try { fs.rmSync(to, { force: true }); } catch {}
      fs.renameSync(temporary, to);
    }
    files += 1;
  }
  return files;
}

function selectRecoveryCandidate(destination) {
  const current = profileSummary(destination);
  const candidates = candidateProfiles(destination);
  const preferred = candidates[0] || null;
  const currentInvalid = current.configExists && !current.configValid;
  const currentEmpty = !current.meaningful || current.configSignal === 0;
  const recordedBackup = preferred && /migration backup|pre-migration backup/i.test(preferred.reason);
  const clearlyBetterBackup = Boolean(
    recordedBackup &&
    preferred.summary.score >= current.score + 20 &&
    preferred.summary.configSignal > current.configSignal
  );
  const selected = Boolean(preferred && (currentInvalid || currentEmpty || clearlyBetterBackup));
  return { current, candidates, preferred, selected };
}

function recoverProfileSafely(destination) {
  const selection = selectRecoveryCandidate(destination);
  const { current, candidates, preferred, selected } = selection;
  if (!selected) return { recovered: false, current, candidates, preferred };

  const timestamp = Date.now();
  const parent = path.dirname(destination);
  const base = path.basename(destination);
  const staging = path.join(parent, `${base}.restore-stage-${timestamp}`);
  const backup = path.join(parent, `${base}.before-v0.18.3-${timestamp}`);

  try {
    fs.rmSync(staging, { recursive: true, force: true });
    const stagedFiles = copyTree(preferred.directory, staging);
    const staged = profileSummary(staging);
    if (!staged.configValid || !staged.meaningful || staged.score < preferred.summary.score * 0.75) {
      throw new Error('The staged v0.17 profile did not pass validation.');
    }

    fs.mkdirSync(backup, { recursive: true });
    const backupFiles = fs.existsSync(destination) ? copyTree(destination, backup) : 0;
    const restoredFiles = atomicOverlay(staging, destination);
    const restored = profileSummary(destination);
    if (!restored.configValid || !restored.meaningful || restored.configSignal < staged.configSignal) {
      throw new Error('The restored profile did not pass post-write validation.');
    }

    fs.rmSync(staging, { recursive: true, force: true });
    return {
      recovered: true,
      source: preferred.directory,
      sourceReason: preferred.reason,
      backup,
      stagedFiles,
      backupFiles,
      restoredFiles,
      current: restored,
      previous: current,
      candidates
    };
  } catch (error) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    try {
      if (fs.existsSync(backup)) atomicOverlay(backup, destination);
    } catch {}
    return {
      recovered: false,
      current: profileSummary(destination),
      previous: current,
      preferred,
      candidates,
      backup: fs.existsSync(backup) ? backup : null,
      error: error.message
    };
  }
}

module.exports = {
  SKIP_NAMES,
  shouldSkip,
  copyTree,
  atomicOverlay,
  selectRecoveryCandidate,
  recoverProfileSafely
};
