'use strict';

const { HEALTH_PREFIXES, LOOP, checkRconPrefix, healthEnabled, healthIntervalMs, healthLogLine, mapLabel, openStore, setAscendedHealthSnapshot } = require('./ascended-rcon-health.cjs');
const { errorClass } = require('./command-failure.cjs');

function playerKey(player) {
  const eos = String(player?.eosId || '').trim();
  if (eos) return `eos:${eos}`;
  return `name:${String(player?.name || '').trim().toLowerCase()}`;
}

function playerLabel(player) {
  const name = String(player?.name || '').replace(/[\r\n@`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32);
  if (!name || /^eos[_:]/i.test(name)) return 'A player';
  return name;
}

function diffPlayers(previous = [], next = []) {
  const before = new Map(previous.map((player) => [playerKey(player), player]));
  const after = new Map(next.map((player) => [playerKey(player), player]));
  const joined = [];
  const left = [];
  for (const [key, player] of after) if (!before.has(key)) joined.push(player);
  for (const [key, player] of before) if (!after.has(key)) left.push(player);
  return { joined, left };
}

function presenceLine(prefix, change, player) {
  const label = playerLabel(player);
  const map = mapLabel(prefix);
  return change === 'join' ? `${label} joined ${map}.` : `${label} left ${map}.`;
}

function presenceMessages(prefix, diff) {
  const lines = [
    ...diff.joined.map((player) => presenceLine(prefix, 'join', player)),
    ...diff.left.map((player) => presenceLine(prefix, 'leave', player))
  ];
  if (lines.length <= 10) return lines;
  return [...lines.slice(0, 10), `and ${lines.length - 10} more ${mapLabel(prefix)} presence changes.`];
}

function presenceChannelId(env = process.env) {
  const id = String(env.ASCENDED_PRESENCE_CHANNEL_ID || '').trim();
  return /^\d{17,20}$/.test(id) ? id : '';
}

async function postPresence(client, env, lines) {
  const channelId = presenceChannelId(env);
  if (!channelId || !lines.length) return { posted: false, reason: channelId ? 'empty' : 'unset' };
  if (typeof client?.isReady === 'function' && !client.isReady()) return { posted: false, reason: 'discord-not-ready' };
  const channel = typeof client?.channels?.fetch === 'function' ? await client.channels.fetch(channelId) : null;
  if (!channel || typeof channel.send !== 'function') return { posted: false, reason: 'channel-missing' };
  await channel.send({ content: lines.join('\n').slice(0, 1800), allowedMentions: { parse: [] } });
  return { posted: true, reason: 'sent' };
}

function startAscendedOpsLoop({ client, env = process.env, store, execute, now } = {}) {
  if (client?.[LOOP]) return client[LOOP];
  const activeStore = store || openStore(env);
  const lastPlayers = { ARK_GEN1: [], ARK_MAP2: [] };
  const seeded = { ARK_GEN1: false, ARK_MAP2: false };
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped || !healthEnabled(env)) return setAscendedHealthSnapshot([]);
    const rows = [];
    for (const prefix of HEALTH_PREFIXES) {
      const result = await checkRconPrefix(prefix, { store: activeStore, env, execute, now });
      rows.push(result.row);
      console.log(`[Nexus Ascended] ${healthLogLine(result.row)}`);
      if (!result.row.ok) continue;
      if (!seeded[prefix]) {
        seeded[prefix] = true;
        lastPlayers[prefix] = result.players;
        continue;
      }
      const diff = diffPlayers(lastPlayers[prefix], result.players);
      lastPlayers[prefix] = result.players;
      const lines = presenceMessages(prefix, diff);
      if (!lines.length) continue;
      try {
        const posted = await postPresence(client, env, lines);
        console.log(`[Nexus Ascended] presence ${prefix} joins=${diff.joined.length} leaves=${diff.left.length} posted=${posted.posted ? 'yes' : posted.reason}`);
      } catch (error) {
        console.warn(`[Nexus Ascended] presence post failed: class=${errorClass(error)}`);
      }
    }
    return setAscendedHealthSnapshot(rows);
  }

  if (healthEnabled(env)) {
    timer = setInterval(() => {
      void tick().catch((error) => console.warn(`[Nexus Ascended] RCON health failed: class=${errorClass(error)}`));
    }, healthIntervalMs(env));
    timer.unref?.();
    void tick().catch((error) => console.warn(`[Nexus Ascended] RCON health failed: class=${errorClass(error)}`));
  }

  const handle = {
    tick,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    }
  };
  if (client) client[LOOP] = handle;
  return handle;
}

module.exports = {
  playerKey,
  playerLabel,
  diffPlayers,
  presenceLine,
  presenceMessages,
  presenceChannelId,
  postPresence,
  startAscendedOpsLoop
};
