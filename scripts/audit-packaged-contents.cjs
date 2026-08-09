'use strict';

const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const archive = path.resolve(root, process.argv[2] || 'dist/win-unpacked/resources/app.asar');
if (!fs.existsSync(archive)) throw new Error(`Packaged app.asar not found: ${archive}`);

const files = asar.listPackage(archive).map((entry) => String(entry).replace(/\\/g, '/'));
const forbiddenPrefixes = ['/.github/', '/test/', '/tests/', '/docs/', '/scripts/', '/coverage/', '/release-notes/'];
const forbiddenRootFiles = new Set(['/test-output.txt', '/windows-test-output.txt']);
const forbidden = files.filter((file) => forbiddenPrefixes.some((prefix) => file.startsWith(prefix)) || forbiddenRootFiles.has(file));
const sourceMaps = files.filter((file) => file.endsWith('.map'));
const roots = {};
for (const file of files) {
  const first = file.replace(/^\//, '').split('/')[0] || '(root)';
  roots[first] = (roots[first] || 0) + 1;
}

const report = {
  schemaVersion: 1,
  archive: path.relative(root, archive),
  fileCount: files.length,
  forbidden,
  sourceMapCount: sourceMaps.length,
  rootEntries: roots
};

const out = path.join(root, 'dist', 'package-content-audit.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Packaged content audit: ${files.length} files, ${sourceMaps.length} source maps.`);
console.log(`Top-level packaged entries: ${Object.entries(roots).map(([name, count]) => `${name}:${count}`).join(', ')}`);
if (forbidden.length) throw new Error(`Development-only content leaked into app.asar: ${forbidden.join(', ')}`);
console.log('No forbidden development-only directories were found in app.asar.');
