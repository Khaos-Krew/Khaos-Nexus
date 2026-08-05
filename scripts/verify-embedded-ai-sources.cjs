'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, safeTarget, summarizeDirectory } = require('./sync-embedded-ai-sources.cjs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sameSummary(actual, expected) {
  return actual.fileCount === expected.fileCount
    && actual.totalBytes === expected.totalBytes
    && actual.snapshotSha256 === expected.snapshotSha256;
}

function verifyEmbeddedAiSources(root = path.resolve(__dirname, '..')) {
  const config = loadConfig(root);
  const lockPath = path.join(root, 'packages', 'ai', 'embedded-ai-lock.json');
  if (!fs.existsSync(lockPath)) throw new Error('Embedded AI lock file is missing.');
  const lock = readJson(lockPath);
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.services)) {
    throw new Error('Embedded AI lock file is invalid.');
  }

  const results = [];
  for (const service of config.services) {
    const directory = safeTarget(root, service.directory);
    const packagePath = path.join(directory, 'package.json');
    const provenancePath = path.join(directory, 'source-provenance.json');
    if (!fs.existsSync(packagePath)) throw new Error(`Embedded ${service.id} package.json is missing.`);
    if (!fs.existsSync(provenancePath)) throw new Error(`Embedded ${service.id} provenance is missing.`);
    if (!fs.existsSync(path.join(directory, service.entry))) {
      throw new Error(`Embedded ${service.id} entry point is missing: ${service.entry}.`);
    }
    for (const forbidden of ['.git', '.github', 'node_modules', 'test', 'tests', 'coverage', 'dist']) {
      if (fs.existsSync(path.join(directory, forbidden))) {
        throw new Error(`Embedded ${service.id} contains forbidden directory: ${forbidden}.`);
      }
    }

    const packageJson = readJson(packagePath);
    const provenance = readJson(provenancePath);
    if (packageJson.version !== service.version) {
      throw new Error(`Embedded ${service.id} version mismatch.`);
    }
    for (const key of ['id', 'repository', 'commit', 'version', 'entry']) {
      if (provenance[key] !== service[key]) {
        throw new Error(`Embedded ${service.id} provenance mismatch for ${key}.`);
      }
    }
    if (provenance.mode !== 'embedded-source-snapshot') {
      throw new Error(`Embedded ${service.id} provenance mode is invalid.`);
    }

    const expected = lock.services.find((item) => item.id === service.id);
    if (!expected) throw new Error(`Embedded ${service.id} is missing from the lock file.`);
    for (const key of ['directory', 'repository', 'commit', 'version', 'entry']) {
      if (expected[key] !== service[key]) {
        throw new Error(`Embedded ${service.id} lock mismatch for ${key}.`);
      }
    }
    const actual = summarizeDirectory(directory);
    if (!sameSummary(actual, expected)) {
      throw new Error(`Embedded ${service.id} snapshot integrity mismatch.`);
    }
    results.push({ id: service.id, version: service.version, commit: service.commit, ...actual });
  }

  if (lock.services.length !== config.services.length) {
    throw new Error('Embedded AI lock file contains unexpected services.');
  }
  return results;
}

function main() {
  const results = verifyEmbeddedAiSources(path.resolve(__dirname, '..'));
  for (const service of results) {
    console.log(`Verified embedded ${service.id} ${service.version}: ${service.fileCount} files, ${service.totalBytes} bytes, ${service.snapshotSha256}.`);
  }
}

if (require.main === module) main();

module.exports = { sameSummary, verifyEmbeddedAiSources };
