'use strict';

const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const { McAfkTracker } = require('./mc-afk.cjs');
const { parseListUuids, parseDataVector, dataGetCommand, tagListCommand, parseTagList } = require('./mc-rcon-text.cjs');

const POLL_MS = 60 * 1000;

function afkDatapackTag(env = process.env) {
  const raw = env.MC_AFK_DATAPACK_TAG;
  if (raw == null || String(raw).trim() === '') return { enabled: false, tag: '' };
  const tag = String(raw).trim();
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(tag)) return { enabled: true, tag: '', invalid: true };
  return { enabled: true, tag, invalid: false };
}

function clockMs(now) {
  if (typeof now === 'function') {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  }
  const value = Number(now);
  return Number.isFinite(value) ? value : Date.now();
}

async function pollMcPlaytime({ rcon, presence, afk = new McAfkTracker(), now = Date.now, env = process.env, seen = new Set(), log = () => {} } = {}) {
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
  const at = clockMs(now);
  const datapack = afkDatapackTag(env);
  let afkCount = 0;
  let failures = 0;
  const onlineIds = new Set();
  const samples = [];
  for (const player of listed.players) {
    try {
      const position = parseDataVector(await rcon(dataGetCommand(player.uuid, 'Pos')));
      const rotation = parseDataVector(await rcon(dataGetCommand(player.uuid, 'Rotation')));
      let datapackAfk;
      if (datapack.enabled) {
        if (datapack.invalid) throw new Error('afk-tag-invalid');
        const tags = parseTagList(await rcon(tagListCommand(player.uuid)));
        if (!tags) throw new Error('afk-tag-unreadable');
        datapackAfk = tags.includes(datapack.tag);
      }
      const state = afk.observe(player.uuid, { position, rotation, datapackAfk }, at);
      if (state.afk) afkCount += 1;
      onlineIds.add(player.uuid);
      seen.add(player.uuid);
      samples.push({ mcUuid: player.uuid, online: state.afk !== true, afk: state.afk === true });
    } catch {
      failures += 1;
      afkCount += 1;
      onlineIds.add(player.uuid);
      seen.add(player.uuid);
      samples.push({ mcUuid: player.uuid, online: false, afk: true });
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
  if (flags.playtimeEnabled && typeof presence === 'function') {
    for (const sample of samples) {
      const body = { provider: 'minecraft', mcUuid: sample.mcUuid, online: sample.online, server: 'minecraft' };
      if (sample.afk === true) body.afk = true;
      await presence(body);
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

module.exports = { POLL_MS, clockMs, afkDatapackTag, pollMcPlaytime, installMcPlaytimeLoop };
