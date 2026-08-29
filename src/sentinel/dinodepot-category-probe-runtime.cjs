'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const ENV_KEY = 'ARK_GEN1_DINODEPOT_CATEGORY_PROBE_ONCE';
const VERSION = 'dinodepot-category-probe-v1';
const TARGET = 'NONEXISTENT_NEXUS_PROBE_000';
const COMMAND = `ScriptCommand SpawnDinoInBall -p=${TARGET} -t=any -l=200 -i=1 -a=1`;

function dataDir() { return process.env.NEXUS_DATA_DIR || '/app/data'; }
function stampFile() { return path.join(dataDir(), `${VERSION}.done.json`); }
function requested() { return String(process.env[ENV_KEY] || '').trim().toLowerCase() === 'true'; }
function clean(value, max = 800) { return String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, max); }

async function run() {
  fs.mkdirSync(dataDir(), { recursive: true });
  if (fs.existsSync(stampFile())) {
    console.log(`[Nexus Sentinal] ${VERSION} skipped: already-applied`);
    return { skipped: 'already-applied' };
  }
  if (!COMMAND.includes(`-p=${TARGET}`) || !COMMAND.includes('-t=any') || !COMMAND.includes('-l=200')) {
    throw new Error('Dino Depot category probe command failed its hard-coded safety assertion.');
  }
  const connection = arkServerFromEnv('ARK_GEN1');
  const rcon = new ArkRconClient({ host: connection.host, port: connection.port, password: connection.password, timeoutMs: 8000 });
  const before = await rcon.execute('ListPlayers');
  if (String(before || '').includes(TARGET)) throw new Error('Probe target unexpectedly exists on the server; refusing command.');
  const response = await rcon.execute(COMMAND);
  const stamp = {
    version: VERSION,
    executedAt: new Date().toISOString(),
    target: TARGET,
    commandClass: 'DinoDepot SpawnDinoInBall parser probe',
    response: clean(response, 800),
    verifiedNonPlayerTarget: true
  };
  fs.writeFileSync(stampFile(), JSON.stringify(stamp, null, 2), { mode: 0o600 });
  console.log(`[Nexus Sentinal] ${VERSION} COMPLETE: target=nonexistent response=${clean(response, 500) || '(empty)'}`);
  return stamp;
}

function installDinoDepotCategoryProbeRuntime() {
  if (!requested()) return { enabled: false };
  const timer = setTimeout(() => {
    void run().catch((error) => console.error(`[Nexus Sentinal] ${VERSION} FAILED CLOSED: ${clean(error?.message || error, 500)}`));
  }, 25_000);
  timer.unref?.();
  console.log(`[Nexus Sentinal] ${VERSION} armed via ${ENV_KEY}.`);
  return { enabled: true };
}

module.exports = { ENV_KEY, VERSION, TARGET, COMMAND, requested, run, installDinoDepotCategoryProbeRuntime };
