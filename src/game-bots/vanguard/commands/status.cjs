'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deployTip } = require('../../ops-spine.cjs');
const { resolveCategoryConfig } = require('../../category-gate.cjs');
const { jtcStatusLine } = require('../../join-to-create.cjs');
const { readJson } = require('../../panel-message.cjs');
const { dataDir, snowflake, statePaths } = require('../config.cjs');
const { BRAND, DISCLAIMER } = require('../panels.cjs');

function countOpen(env) {
  const state = readJson(statePaths(env).lfg, {});
  let open = 0;
  for (const bucket of Object.values(state)) {
    if (!bucket || typeof bucket !== 'object') continue;
    for (const post of Object.values(bucket)) {
      if (post?.status === 'open') open += 1;
    }
  }
  return open;
}

function channelConfigured(env, key, envName) {
  if (snowflake(env[envName])) return true;
  const saved = readJson(statePaths(env).channels, {});
  return Object.values(saved).some((row) => snowflake(row?.[key]));
}

function dataDirWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok', { mode: 0o600 });
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function buildStatusText({ client, env = process.env } = {}) {
  const ready = Boolean(client?.isReady?.());
  const category = resolveCategoryConfig('vanguard', env);
  const gate = category.failClosed || !category.id
    ? `Category gate: fail-closed (${category.source || 'unset'}).`
    : 'Category gate: ok.';
  const dir = dataDir(env);
  const lines = [
    '**Nexus Vanguard status**',
    `Discord: ${ready ? 'ready' : 'not ready'}.`,
    deployTip(env),
    gate,
    `Data dir: ${dataDirWritable(dir) ? 'writable' : 'not writable'}.`,
    `LFG channel: ${channelConfigured(env, 'lfg', 'VANGUARD_LFG_CHANNEL_ID') ? 'configured' : 'unset'}.`,
    `LFG open posts: ${countOpen(env)}.`,
    jtcStatusLine('vanguard', env),
    'No Bungie calls in this build.',
    'Wallet, verify, ranks, and the shop stay on Nexus Sentinal.',
    BRAND,
    DISCLAIMER
  ];
  return lines.join('\n').slice(0, 1900);
}

module.exports = { buildStatusText, dataDirWritable, countOpen };
