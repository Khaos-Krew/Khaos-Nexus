'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadConfig, safeTarget } = require('./sync-embedded-ai-sources.cjs');
const { verifyEmbeddedAiSources } = require('./verify-embedded-ai-sources.cjs');

// The authoritative pins are loaded from config/embedded-ai-sources.json.
// D&D AI: 19c718917377d6148f9baaee8ac8dcb937692f32
// Nexus AI Core: 300c653e5643e0ee2e15590f8cb53e30ee7a79ff
const root = path.join(__dirname, '..');
const outputRoot = path.join(root, '.runtime', 'ai-services');
const excluded = new Set(['.git', '.github', 'node_modules', 'test', 'tests', 'coverage', 'dist', '.env', '.env.local']);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in bundled AI services: ${from}`);
    }
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to);
  }
}

function filesUnder(directory, prefix = '') {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...filesUnder(absolute, relative));
    else if (entry.isFile()) output.push({ path: relative, sha256: sha256(absolute), size: fs.statSync(absolute).size });
  }
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

function assignmentsFor(rootDirectory) {
  const config = loadConfig(rootDirectory);
  const verified = new Map(verifyEmbeddedAiSources(rootDirectory).map((service) => [service.id, service]));
  return config.services.map((service) => ({
    ...service,
    source: safeTarget(rootDirectory, service.directory),
    sourceSummary: verified.get(service.id)
  }));
}

function buildBundledAiRuntimes(rootDirectory = root) {
  const runtimeRoot = path.join(rootDirectory, '.runtime', 'ai-services');
  const assignments = assignmentsFor(rootDirectory);
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });

  for (const assignment of assignments) {
    const destination = path.join(runtimeRoot, assignment.id);
    copyTree(assignment.source, destination);
    const packageJson = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
    if (packageJson.version !== assignment.version) {
      throw new Error(`${assignment.id} version mismatch: expected ${assignment.version}, received ${packageJson.version}.`);
    }
    if (!fs.existsSync(path.join(destination, assignment.entry))) {
      throw new Error(`${assignment.id} entry point is missing.`);
    }
    const manifest = {
      schemaVersion: 1,
      id: assignment.id,
      repository: assignment.repository,
      commit: assignment.commit,
      version: assignment.version,
      entry: assignment.entry,
      source: {
        mode: 'embedded',
        directory: assignment.directory,
        snapshotSha256: assignment.sourceSummary.snapshotSha256
      },
      runtime: { executable: 'electron', electronRunAsNode: true, minimumNodeMajor: 22 },
      files: filesUnder(destination).filter((item) => item.path !== 'bundle-manifest.json')
    };
    fs.writeFileSync(path.join(destination, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return { outputRoot: runtimeRoot, assignments };
}

function main() {
  const result = buildBundledAiRuntimes(root);
  for (const assignment of result.assignments) {
    console.log(`Built ${assignment.id} ${assignment.version} from embedded source ${assignment.sourceSummary.snapshotSha256}.`);
  }
  console.log(`Bundled AI runtimes written to ${result.outputRoot}`);
}

if (require.main === module) main();

module.exports = {
  assignmentsFor,
  buildBundledAiRuntimes,
  copyTree,
  excluded,
  filesUnder,
  sha256
};
