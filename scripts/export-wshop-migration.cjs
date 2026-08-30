'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildMigrationBundle, validateMigrationBundle } = require('../src/sentinel/wshop-migration.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'config', 'ark', 'wshop', 'nexus-wshop-migration.json');
const bundle = buildMigrationBundle();
const validation = validateMigrationBundle(bundle);
if (!validation.ok) throw new Error(`WShop migration validation failed: ${validation.errors.join(', ')}`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
console.log(`WShop migration bundle ready: ${output}`);
console.log(JSON.stringify(validation.counts));
