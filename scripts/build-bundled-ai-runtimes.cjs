'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const outputRoot = path.join(root, '.runtime', 'ai-services');
const assignments = [
  {
    id: 'dnd-ai',
    repository: 'Khaos-Krew/Khaos-Nexus-AI',
    commit: '19c718917377d6148f9baaee8ac8dcb937692f32',
    version: '0.12.1',
    source: process.env.KHAOS_DND_AI_SOURCE || path.join(root, '.ai-sources', 'dnd-ai'),
    entry: 'src/index.js'
  },
  {
    id: 'ai-core',
    repository: 'Khaos-Krew/Khaos-Nexus-AI-Core',
    commit: '300c653e5643e0ee2e15590f8cb53e30ee7a79ff',
    version: '0.7.0',
    source: process.env.KHAOS_AI_CORE_SOURCE || path.join(root, '.ai-sources', 'ai-core'),
    entry: 'src/index.js'
  }
];

const excluded = new Set(['.git', '.github', 'test', 'tests', 'coverage', 'dist', '.env', '.env.local']);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
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

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const assignment of assignments) {
  if (!fs.existsSync(path.join(assignment.source, 'package.json'))) {
    throw new Error(`Missing ${assignment.id} source at ${assignment.source}. Checkout the assigned snapshot before packaging.`);
  }
  const destination = path.join(outputRoot, assignment.id);
  copyTree(assignment.source, destination);
  const packageJson = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
  if (packageJson.version !== assignment.version) throw new Error(`${assignment.id} version mismatch: expected ${assignment.version}, received ${packageJson.version}.`);
  if (!fs.existsSync(path.join(destination, assignment.entry))) throw new Error(`${assignment.id} entry point is missing.`);
  const manifest = {
    schemaVersion: 1,
    id: assignment.id,
    repository: assignment.repository,
    commit: assignment.commit,
    version: assignment.version,
    entry: assignment.entry,
    runtime: { executable: 'electron', electronRunAsNode: true, minimumNodeMajor: 22 },
    files: filesUnder(destination).filter((item) => item.path !== 'bundle-manifest.json')
  };
  fs.writeFileSync(path.join(destination, 'bundle-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Bundled AI runtimes written to ${outputRoot}`);
