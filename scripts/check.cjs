'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const roots = ['main', 'bot', 'renderer', 'shared', 'scripts', 'test'];
const files = [];
for (const root of roots) {
  walk(path.join(process.cwd(), root));
}

function walk(current) {
  if (!fs.existsSync(current)) return;
  const stat = fs.statSync(current);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(current)) walk(path.join(current, name));
    return;
  }
  if (/\.(?:js|cjs|mjs)$/.test(current)) files.push(current);
}

let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures += 1;
    console.error(result.stderr || result.stdout);
  }
}

if (failures) process.exit(1);
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
