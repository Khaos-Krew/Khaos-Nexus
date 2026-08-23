'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const required = [
  'package.json', 'config.example.json', 'src/main.cjs', 'src/backend/server.cjs',
  'src/backend/providers/http-provider.cjs', 'src/backend/providers/native-providers.cjs',
  'src/backend/providers/warframe-provider.cjs', 'src/sentinel/bot.cjs',
  'src/sentinel/module-provisioner.cjs', 'src/sentinel/module-layouts.cjs',
  'src/sentinel/state-store.cjs', 'src/backend/modules/catalog.cjs'
];
const syntaxFiles = [
  'src/backend/server.cjs', 'src/backend/core/runtime.cjs',
  'src/backend/providers/http-provider.cjs', 'src/backend/providers/native-providers.cjs',
  'src/backend/providers/warframe-provider.cjs', 'src/sentinel/bot.cjs',
  'src/sentinel/module-provisioner.cjs', 'src/sentinel/module-layouts.cjs', 'src/sentinel/state-store.cjs'
];
let failed = false;
for (const file of required) {
  const ok = fs.existsSync(path.join(root, file));
  console.log(`${ok ? 'OK' : 'MISSING'} ${file}`);
  if (!ok) failed = true;
}
for (const file of syntaxFiles) {
  if (!fs.existsSync(path.join(root, file))) continue;
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  const ok = result.status === 0;
  console.log(`${ok ? 'SYNTAX OK' : 'SYNTAX FAIL'} ${file}`);
  if (!ok) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout || 'Unknown syntax error\n');
  }
}
const pkg = require(path.join(root, 'package.json'));
if (pkg.version !== '0.1.0') {
  console.error(`Version must remain 0.1.0 for the rebuild baseline; found ${pkg.version}`);
  failed = true;
}
if (failed) process.exitCode = 1;
else console.log('Nexus rebuild structure check passed.');
