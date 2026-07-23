'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
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

console.log('Application assets are ready.');
