'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildBundledAiRuntimes } = require('./build-bundled-ai-runtimes.cjs');

const AI_SERVICE_IDS = Object.freeze(['dnd-ai', 'ai-core']);

function inspectBundledAiResources(root) {
  const runtimeRoot = path.join(root, '.runtime', 'ai-services');
  if (!fs.existsSync(runtimeRoot)) {
    return { status: 'absent', runtimeRoot, missing: [...AI_SERVICE_IDS] };
  }

  const missing = AI_SERVICE_IDS.filter((serviceId) => {
    return !fs.existsSync(path.join(runtimeRoot, serviceId, 'bundle-manifest.json'));
  });

  return {
    status: missing.length === 0 ? 'complete' : 'incomplete',
    runtimeRoot,
    missing
  };
}

function isAiServicesResource(entry) {
  const target = String(entry?.to || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  return target === 'ai-services';
}

function configureBundledAiResources(root) {
  const packagePath = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const inspection = inspectBundledAiResources(root);

  if (inspection.status === 'incomplete') {
    throw new Error(`Bundled AI runtime directory is incomplete. Missing manifests: ${inspection.missing.join(', ')}.`);
  }

  pkg.build = pkg.build || {};
  const retained = (Array.isArray(pkg.build.extraResources) ? pkg.build.extraResources : [])
    .filter((entry) => !isAiServicesResource(entry));

  if (inspection.status === 'complete') {
    retained.push({ from: '.runtime/ai-services', to: 'ai-services', filter: ['**/*'] });
  }

  if (retained.length > 0) pkg.build.extraResources = retained;
  else delete pkg.build.extraResources;

  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  return inspection;
}

function materializeAssets(root) {
  const assets = [
    ['assets/icon.png.b64', 'assets/icon.png'],
    ['assets/icon.ico.b64', 'assets/icon.ico']
  ];

  for (const [sourceRelative, targetRelative] of assets) {
    const source = path.join(root, sourceRelative);
    const target = path.join(root, targetRelative);
    if (fs.existsSync(target) || !fs.existsSync(source)) continue;
    const encoded = fs.readFileSync(source, 'utf8').replace(/\s+/g, '');
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length === 0) throw new Error(`Could not decode ${sourceRelative}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, decoded);
  }
}

function prepareApplicationAssets(root) {
  const bundle = buildBundledAiRuntimes(root);
  materializeAssets(root);
  const inspection = configureBundledAiResources(root);
  if (inspection.status !== 'complete') {
    throw new Error('Embedded AI source build did not produce both required service bundles.');
  }
  return { bundle, inspection };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const result = prepareApplicationAssets(root);
  console.log(`Application assets are ready. ${result.bundle.assignments.length} embedded AI services will be included.`);
}

if (require.main === module) main();

module.exports = {
  AI_SERVICE_IDS,
  configureBundledAiResources,
  inspectBundledAiResources,
  materializeAssets,
  prepareApplicationAssets
};
