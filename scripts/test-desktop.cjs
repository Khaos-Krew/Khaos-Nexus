'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const testDir = path.join(repoRoot, 'test');

if (!fs.existsSync(testDir)) {
  console.error('Desktop test directory is missing:', testDir);
  process.exit(1);
}

const testFiles = fs
  .readdirSync(testDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.cjs'))
  .map((entry) => path.join(testDir, entry.name))
  .sort();

if (testFiles.length === 0) {
  console.error('No desktop .test.cjs files were found. Refusing to run an unscoped test discovery fallback.');
  process.exit(1);
}

console.log(`Running ${testFiles.length} scoped desktop test files.`);
const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
