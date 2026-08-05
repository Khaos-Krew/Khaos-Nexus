'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const IGNORED_NAMES = new Set([
  '.git',
  '.github',
  'node_modules',
  'test',
  'tests',
  'coverage',
  'dist',
  '.env',
  '.env.local'
]);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function safeTarget(root, relative) {
  const normalizedRoot = path.resolve(root);
  const absolute = path.resolve(normalizedRoot, String(relative || ''));
  if (!absolute.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Embedded AI path escapes the repository: ${relative}`);
  }
  return absolute;
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in embedded AI snapshots: ${from}`);
    }
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function listFiles(directory, prefix = '') {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(absolute, relative));
    else if (entry.isFile()) {
      const content = fs.readFileSync(absolute);
      output.push({ path: relative, size: content.length, sha256: sha256(content) });
    }
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

function summarizeDirectory(directory) {
  const files = listFiles(directory);
  const canonical = files.map((file) => `${file.path}\0${file.size}\0${file.sha256}`).join('\n');
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.size, 0),
    snapshotSha256: sha256(Buffer.from(canonical, 'utf8'))
  };
}

function loadConfig(root) {
  const configPath = path.join(root, 'config', 'embedded-ai-sources.json');
  const config = readJson(configPath);
  if (config.schemaVersion !== 1 || !Array.isArray(config.services) || config.services.length === 0) {
    throw new Error('Embedded AI source configuration is invalid.');
  }
  return config;
}

function sourceFor(root, service, environment) {
  const override = service.sourceEnvironment && environment[service.sourceEnvironment];
  if (override) {
    if (environment.KHAOS_ALLOW_EXTERNAL_AI_SOURCE !== '1') {
      throw new Error(`${service.sourceEnvironment} requires KHAOS_ALLOW_EXTERNAL_AI_SOURCE=1.`);
    }
    return path.resolve(override);
  }
  return path.join(root, '.vendor', service.id);
}

function validateSource(source, service) {
  const packagePath = path.join(source, 'package.json');
  if (!fs.existsSync(packagePath)) throw new Error(`Missing ${service.id} package.json at ${source}.`);
  const packageJson = readJson(packagePath);
  if (packageJson.version !== service.version) {
    throw new Error(`${service.id} version mismatch: expected ${service.version}, received ${packageJson.version}.`);
  }
  if (!fs.existsSync(path.join(source, service.entry))) {
    throw new Error(`${service.id} entry point is missing: ${service.entry}.`);
  }
}

function syncEmbeddedAiSources(root = path.resolve(__dirname, '..'), environment = process.env) {
  const config = loadConfig(root);
  const lock = { schemaVersion: 1, services: [] };

  for (const service of config.services) {
    const source = sourceFor(root, service, environment);
    const destination = safeTarget(root, service.directory);
    validateSource(source, service);
    fs.rmSync(destination, { recursive: true, force: true });
    copyTree(source, destination);
    writeJson(path.join(destination, 'source-provenance.json'), {
      schemaVersion: 1,
      mode: 'embedded-source-snapshot',
      id: service.id,
      repository: service.repository,
      commit: service.commit,
      version: service.version,
      entry: service.entry
    });
    lock.services.push({
      id: service.id,
      directory: service.directory,
      repository: service.repository,
      commit: service.commit,
      version: service.version,
      entry: service.entry,
      ...summarizeDirectory(destination)
    });
  }

  const lockPath = path.join(root, 'packages', 'ai', 'embedded-ai-lock.json');
  writeJson(lockPath, lock);
  return lock;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const lock = syncEmbeddedAiSources(root, process.env);
  for (const service of lock.services) {
    console.log(`Embedded ${service.id} ${service.version} from ${service.commit}: ${service.fileCount} files, ${service.totalBytes} bytes.`);
  }
}

if (require.main === module) main();

module.exports = {
  IGNORED_NAMES,
  copyTree,
  listFiles,
  loadConfig,
  safeTarget,
  sha256,
  sourceFor,
  summarizeDirectory,
  syncEmbeddedAiSources,
  validateSource
};
