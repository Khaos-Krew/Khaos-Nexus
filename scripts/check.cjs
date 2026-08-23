'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const required = [
  'package.json', 'config.example.json', 'src/main.cjs', 'src/preload.cjs', 'src/shared/config.cjs', 'src/shared/ranks.cjs',
  'src/desktop/config-store.cjs', 'src/desktop/secret-vault.cjs', 'src/desktop/sentinal-admin-client.cjs', 'src/desktop/owner-test-service.cjs', 'src/thora/bridge.cjs',
  'src/updater/service.cjs', 'src/updater/apply-update.ps1', 'scripts/build-update-bundle.ps1',
  'src/backend/application.cjs', 'src/backend/server.cjs',
  'src/backend/core/runtime.cjs', 'src/backend/core/scheduler.cjs', 'src/backend/core/json-store.cjs',
  'src/backend/providers/http-provider.cjs', 'src/backend/providers/native-providers.cjs',
  'src/backend/providers/warframe-provider.cjs', 'src/backend/providers/division2-provider.cjs',
  'src/backend/providers/idleon-provider.cjs', 'src/backend/providers/pokemon-go-provider.cjs', 'src/backend/providers/pokemon-go-official-events.cjs',
  'src/backend/providers/server-providers.cjs', 'src/backend/providers/source-rcon-provider.cjs',
  'src/backend/providers/palworld-provider.cjs', 'src/backend/providers/rust-provider.cjs',
  'src/backend/providers/satisfactory-provider.cjs',
  'src/backend/transports/source-rcon.cjs', 'src/backend/transports/rcon-protocol.cjs',
  'src/sentinel/bot.cjs', 'src/sentinel/entry.cjs', 'src/sentinel/pokemon-go-extension.cjs',
  'src/sentinel/pokemon-go.cjs', 'src/sentinel/pokemon-go-event-ui.cjs', 'src/sentinel/discord-time.cjs',
  'src/sentinel/event-feed.cjs', 'src/sentinel/event-feed-extension.cjs',
  'src/sentinel/commands.cjs', 'src/sentinel/friendly-commands.cjs', 'src/sentinel/action-formatters.cjs',
  'src/sentinel/admin-ops.cjs', 'src/sentinel/admin-server.cjs', 'src/sentinel/module-inspector.cjs',
  'src/sentinel/module-console.cjs', 'src/sentinel/module-provisioner.cjs', 'src/sentinel/module-layouts.cjs',
  'src/sentinel/state-store.cjs', 'src/backend/modules/catalog.cjs',
  'src/renderer/index.html', 'src/renderer/app.js', 'src/renderer/style.css',
  'src/renderer/updater-ui.js', 'src/renderer/updater.css', 'src/renderer/admin-ops-ui.js', 'src/renderer/admin-ops.css',
  'src/renderer/startup-health.js', 'src/renderer/startup-health.css'
];
const syntaxFiles = required.filter((file) => /\.(?:cjs|js)$/.test(file));
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
if (!/^0\.1\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.test(String(pkg.version || ''))) {
  console.error(`Rebuild versions must stay on the Nexus 0.1 line; found ${pkg.version}`);
  failed = true;
}
if (failed) process.exitCode = 1;
else console.log('Nexus rebuild structure check passed.');
