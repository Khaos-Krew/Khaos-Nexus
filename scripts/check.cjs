'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const required = ['package.json','config.example.json','src/main.cjs','src/backend/server.cjs','src/sentinel/bot.cjs','src/backend/modules/catalog.cjs'];
let failed = false;
for (const file of required) { const ok = fs.existsSync(path.join(root,file)); console.log(`${ok?'OK':'MISSING'} ${file}`); if(!ok) failed=true; }
const pkg = require(path.join(root,'package.json'));
if (pkg.version !== '0.1.0') { console.error(`Version must remain 0.1.0 for the rebuild baseline; found ${pkg.version}`); failed=true; }
if (failed) process.exitCode=1; else console.log('Nexus rebuild structure check passed.');
