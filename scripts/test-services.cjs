'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const servicesRoot = path.join(repoRoot, 'services');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!fs.existsSync(servicesRoot)) {
  console.log('No services directory found; no hosted service tests to run.');
  process.exit(0);
}

const servicePackages = [];
walk(servicesRoot);
servicePackages.sort((a, b) => a.dir.localeCompare(b.dir));

if (servicePackages.length === 0) {
  console.log('No hosted services with test scripts found.');
  process.exit(0);
}

for (const service of servicePackages) {
  const relativeDir = path.relative(repoRoot, service.dir) || '.';
  const lockfile = path.join(service.dir, 'package-lock.json');

  if (!fs.existsSync(lockfile)) {
    console.error(`Service ${relativeDir} has a test script but no package-lock.json. Deterministic CI requires a lockfile.`);
    process.exit(1);
  }

  console.log(`\n=== Testing service: ${relativeDir} ===`);
  runNpm(['ci', '--ignore-scripts'], service.dir, `${relativeDir}: npm ci`);
  runNpm(['test'], service.dir, `${relativeDir}: npm test`);
}

console.log(`\nHosted service tests passed for ${servicePackages.length} package(s).`);

function walk(current) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;

    const fullPath = path.join(current, entry.name);
    if (!entry.isDirectory()) continue;

    const packagePath = path.join(fullPath, 'package.json');
    if (fs.existsSync(packagePath)) {
      let packageJson;
      try {
        packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      } catch (error) {
        console.error(`Invalid package.json at ${path.relative(repoRoot, packagePath)}: ${error.message}`);
        process.exit(1);
      }

      if (typeof packageJson.scripts?.test === 'string' && packageJson.scripts.test.trim()) {
        servicePackages.push({ dir: fullPath, packageJson });
      }
    }

    walk(fullPath);
  }
}

function runNpm(args, cwd, label) {
  const result = spawnSync(npmCommand, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(`${label} failed to start:`, result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${label} failed with exit code ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}
