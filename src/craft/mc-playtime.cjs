'use strict';

const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const { McAfkTracker } = require('./mc-afk.cjs');
const { parseListUuids, parseDataVector, dataGetCommand } = require('./mc-rcon-text.cjs');

const POLL_MS = 60 * 1000;

async function pollMcPlaytime({ rcon, presence, afk = new McAfkTracker(), now = Date.now(), env = process.env, seen = new Set(), log = () => {} } = {}) {
  const flags = mcPointsFlags(env);
  if (!flags.trackingEnabled) return { skipped: 'mc-playtime-disabled' };
  let raw;
  try {
    raw = await rcon('list uuids');
  } catch (error) {
    log({ online: null, players: null, afk: null, failures: 1, authoritative: false });
    return { ok: false, authoritative: false, error: String(error?.message || error).slice(0, 200) };
  }
  const listed = parseListUuids(raw);
  if (!listed.ok) {
    log({ online: null, players: null, afk: null, failures: 1, authoritative: false });
    return { ok: false, authoritative: false, reason: 'unparseable' };
  }
  const at = now();
  let afkCount = 0;
  let failures = 0;
  const onlineIds = new Set();
  const samples = [];
  for (const player of listed.players) {
    try {
      const pos = parseDataVector(await rcon(dataGetCommand(player.name, 'Pos')));
      const rotation = parseDataVector(await rcon(dataGetCommand(player.name, 'Rotation')));
      if (!pos || !rotation) {
        failures += 1;
        continue;
      }
      const state = afk.observe(player.uuid, pos, rotation, at);
      if (state.afk) afkCount += 1;
      onlineIds.add(player.uuid);
      seen.add(player.uuid);
      samples.push({ mcUuid: player.uuid, online: state.afk !== true });
    } catch {
      failures += 1;
    }
  }
  for (const uuid of [...seen]) {
    if (!onlineIds.has(uuid) && listed.players.every((player) => player.uuid !== uuid)) {
      samples.push({ mcUuid: uuid, online: false });
      afk.forget(uuid);
      seen.delete(uuid);
    }
  }
  let posted = 0;
  if (flags.playtimeWrites && typeof presence === 'function') {
    for (const sample of samples) {
      await presence({ provider: 'minecraft', mcUuid: sample.mcUuid, online: sample.online, server: 'minecraft' });
      posted += 1;
    }
  }
  const summary = { online: samples.filter((sample) => sample.online).length, players: listed.players.length, afk: afkCount, failures, posted, dryRun: flags.dryRun === true };
  log(summary);
  return { ok: true, authoritative: true, ...summary, samples };
}

function installMcPlaytimeLoop({ rcon, presence, env = process.env, log } = {}) {
  const flags = mcPointsFlags(env);
  if (!flags.trackingEnabled) return { started: false };
  const afk = new McAfkTracker();
  const seen = new Set();
  const timer = setInterval(() => {
    pollMcPlaytime({ rcon, presence, afk, env, seen, log }).catch((error) => {
      log?.({ failures: 1, authoritative: false, error: String(error?.message || error).slice(0, 160) });
    });
  }, POLL_MS);
  timer.unref?.();
  return { started: true, timer };
}

module.exports = { POLL_MS, pollMcPlaytime, installMcPlaytimeLoop };
