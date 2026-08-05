'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVICE_IDS = Object.freeze(['dnd-ai', 'ai-core']);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function safeRelative(root, relativePath) {
  const normalizedRoot = path.resolve(root);
  const absolute = path.resolve(normalizedRoot, String(relativePath || ''));
  if (!absolute.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`Unsafe packaged AI manifest path: ${relativePath}`);
  }
  return absolute;
}

function verifyService(resourcesRoot, serviceId) {
  const serviceRoot = path.join(resourcesRoot, serviceId);
  const manifestPath = path.join(serviceRoot, 'bundle-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing packaged AI manifest: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.id !== serviceId) {
    throw new Error(`Packaged AI manifest id mismatch for ${serviceId}.`);
  }
  if (manifest.runtime?.electronRunAsNode !== true) {
    throw new Error(`Packaged AI runtime contract is invalid for ${serviceId}.`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`Packaged AI manifest has no files for ${serviceId}.`);
  }

  const entry = safeRelative(serviceRoot, manifest.entry);
  if (!fs.existsSync(entry)) {
    throw new Error(`Packaged AI entry point is missing for ${serviceId}: ${manifest.entry}`);
  }

  let totalBytes = 0;
  for (const item of manifest.files) {
    const file = safeRelative(serviceRoot, item.path);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`Packaged AI file is missing for ${serviceId}: ${item.path}`);
    }
    const size = fs.statSync(file).size;
    if (size !== item.size) {
      throw new Error(`Packaged AI file size mismatch for ${serviceId}: ${item.path}`);
    }
    const digest = sha256(file);
    if (digest !== item.sha256) {
      throw new Error(`Packaged AI file hash mismatch for ${serviceId}: ${item.path}`);
    }
    totalBytes += size;
  }

  return {
    id: serviceId,
    version: String(manifest.version || ''),
    commit: String(manifest.commit || ''),
    files: manifest.files.length,
    totalBytes
  };
}

function verifyPackagedAiRuntimes(resourcesRoot) {
  const root = path.resolve(resourcesRoot);
  const services = SERVICE_IDS.map((serviceId) => verifyService(root, serviceId));
  return { resourcesRoot: root, services };
}

function main() {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'ai-services');
  const result = verifyPackagedAiRuntimes(root);
  for (const service of result.services) {
    console.log(`${service.id} ${service.version || 'unknown'} | ${service.files} files | ${service.totalBytes} bytes | ${service.commit || 'unknown commit'}`);
  }
  console.log(`Verified packaged AI runtimes at ${result.resourcesRoot}`);
}

if (require.main === module) main();

module.exports = {
  SERVICE_IDS,
  safeRelative,
  sha256,
  verifyPackagedAiRuntimes,
  verifyService
};
