'use strict';

const ALL_SERVERS_VALUE = 'all';
const ATM10_PUBLIC_HOST = '172.240.47.65';
const ATM10_PUBLIC_PORT = 25588;

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/\.+$/, '');
}

function looksLikeAtm10Host(host, port) {
  const name = normalizeHost(host);
  const number = Number(port);
  if (!name) return false;
  if (name === ATM10_PUBLIC_HOST) return true;
  if (number === ATM10_PUBLIC_PORT && name === ATM10_PUBLIC_HOST) return true;
  if (/(^|\.)atm10(\.|$)/i.test(name) || /allthemods/i.test(name) || /aeronautics/i.test(name)) return true;
  return false;
}

function staleNote(target) {
  if (!target?.stale) return '';
  const address = target.javaPort ? `${target.host}:${target.javaPort}` : target.host;
  return `Saved address \`${address}\` looks like the old ATM10 join address. Update it with \`/mc panel\` if this should point at the current Skyblock server.`;
}

function emptyListNote() {
  return 'No servers are saved in the Craft config yet. Staff can add the public join address with `/mc panel`, or save RCON with `/mcrcon setup`. You can also type a raw host or host:port.';
}

function listSavedStatusTargets(store) {
  const targets = [];
  const seen = new Set();
  const remember = (target) => {
    const key = `${normalizeHost(target.host)}:${Number(target.javaPort) || 0}`;
    const idKey = String(target.id || '').toLowerCase();
    if (seen.has(key) || (idKey && seen.has(`id:${idKey}`))) return;
    seen.add(key);
    if (idKey) seen.add(`id:${idKey}`);
    targets.push(target);
  };

  const panel = typeof store?.getStatusPanel === 'function' ? store.getStatusPanel() : null;
  if (panel && String(panel.host || '').trim()) {
    const javaPort = Number(panel.javaPort) || 25565;
    const bedrockPort = Number(panel.bedrockPort) || 19132;
    const id = String(panel.rconName || 'panel').trim() || 'panel';
    remember({
      id,
      name: id === 'panel' ? 'Status panel' : id,
      host: String(panel.host).trim(),
      javaPort,
      bedrockPort,
      kind: panel.kind === 'bedrock' || panel.kind === 'geyser' ? panel.kind : 'java',
      source: 'status-panel',
      stale: looksLikeAtm10Host(panel.host, javaPort)
    });
  }

  const statusList = typeof store?.listStatusServers === 'function' ? store.listStatusServers() : [];
  for (const entry of statusList || []) {
    const host = String(entry?.host || '').trim();
    if (!host) continue;
    const javaPort = Number(entry.javaPort || entry.port) || 25565;
    const id = String(entry.id || entry.name || '').trim() || host;
    remember({
      id,
      name: String(entry.name || id).trim() || id,
      host,
      javaPort,
      bedrockPort: Number(entry.bedrockPort) || 19132,
      kind: entry.kind === 'bedrock' || entry.kind === 'geyser' ? entry.kind : 'java',
      source: 'status-server',
      stale: false
    });
  }

  const rconList = typeof store?.listPublicStatus === 'function' ? store.listPublicStatus() : [];
  for (const entry of rconList || []) {
    const host = String(entry?.host || '').trim();
    if (!host) continue;
    const javaPort = Number(entry.port) || 25565;
    const id = String(entry.name || '').trim() || host;
    remember({
      id,
      name: id,
      host,
      javaPort,
      bedrockPort: 19132,
      kind: 'java',
      source: 'rcon',
      stale: looksLikeAtm10Host(host, javaPort),
      queryPortUncertain: javaPort !== 25565 && javaPort !== 25614
    });
  }
  return targets;
}

function parseHostPort(value, fallbackPort) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const ipv6 = raw.match(/^\[([^\]]+)\]:(\d{1,5})$/);
  if (ipv6) {
    const port = Number(ipv6[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host: ipv6[1], port };
  }
  const split = raw.lastIndexOf(':');
  if (split > 0 && raw.indexOf(']') === -1) {
    const port = Number(raw.slice(split + 1));
    const host = raw.slice(0, split).trim();
    if (host && Number.isInteger(port) && port >= 1 && port <= 65535 && !raw.includes('://') && !host.includes('/')) {
      return { host, port };
    }
  }
  if (raw.includes('://') || raw.includes('/')) return null;
  return { host: raw, port: Number(fallbackPort) || 25565 };
}

function isAllSelection(value) {
  const text = String(value || '').trim().toLowerCase();
  return text === '' || text === ALL_SERVERS_VALUE || text === '__all__' || text === 'all servers';
}

function resolveStatusSelection(value, store, extras = {}) {
  const targets = listSavedStatusTargets(store);
  const edition = extras.edition || '';
  const kind = edition === 'bedrock' ? 'bedrock' : edition === 'both' ? 'geyser' : '';
  const overridePort = extras.javaPort ? Number(extras.javaPort) : 0;
  const overrideBedrock = extras.bedrockPort ? Number(extras.bedrockPort) : 0;

  const applyOverrides = (target) => ({
    ...target,
    javaPort: overridePort || target.javaPort,
    bedrockPort: overrideBedrock || target.bedrockPort,
    kind: kind || target.kind
  });

  if (isAllSelection(value)) {
    return { mode: 'all', targets: targets.map(applyOverrides) };
  }

  const text = String(value || '').trim();
  const lowered = text.toLowerCase();
  const saved = targets.find((target) => (
    target.id.toLowerCase() === lowered
    || target.name.toLowerCase() === lowered
    || `${target.host}:${target.javaPort}`.toLowerCase() === lowered
    || normalizeHost(target.host) === normalizeHost(text)
  ));
  if (saved) return { mode: 'one', targets: [applyOverrides(saved)] };

  const parsed = parseHostPort(text, overridePort || 25565);
  if (!parsed) return { mode: 'invalid', targets: [], error: 'That address is not a saved server or a raw host:port.' };
  return {
    mode: 'raw',
    targets: [applyOverrides({
      id: 'custom',
      name: 'Typed address',
      host: parsed.host,
      javaPort: overridePort || parsed.port,
      bedrockPort: overrideBedrock || 19132,
      kind: kind || 'java',
      source: 'typed',
      stale: looksLikeAtm10Host(parsed.host, overridePort || parsed.port)
    })]
  };
}

function autocompleteStatusHosts(store, focused = '', options = {}) {
  const includeAll = options.includeAll !== false;
  const valueAsAddress = Boolean(options.valueAsAddress);
  const targets = listSavedStatusTargets(store);
  const needle = String(focused || '').trim().toLowerCase();
  const choices = [];
  if (includeAll) choices.push({ name: 'All servers', value: ALL_SERVERS_VALUE });
  for (const target of targets) {
    const address = `${target.host}:${target.javaPort}`;
    const label = `${target.name} — ${address}`.slice(0, 100);
    const value = (valueAsAddress ? address : (target.id || address)).slice(0, 100);
    choices.push({ name: label, value });
  }
  const filtered = needle
    ? choices.filter((choice) => choice.name.toLowerCase().includes(needle) || choice.value.toLowerCase().includes(needle))
    : choices;
  return filtered.slice(0, 25);
}

function autocompleteSavedServers(store, focused = '') {
  const list = typeof store?.listPublicStatus === 'function' ? store.listPublicStatus() : [];
  const needle = String(focused || '').trim().toLowerCase();
  const choices = list
    .filter((entry) => entry && entry.name)
    .map((entry) => {
      const address = entry.host && entry.port ? `${entry.host}:${entry.port}` : '';
      const name = address ? `${entry.name} — ${address}` : entry.name;
      return { name: name.slice(0, 100), value: String(entry.name).slice(0, 100) };
    });
  const filtered = needle
    ? choices.filter((choice) => choice.name.toLowerCase().includes(needle) || choice.value.toLowerCase().includes(needle))
    : choices;
  return filtered.slice(0, 25);
}

module.exports = {
  ALL_SERVERS_VALUE,
  ATM10_PUBLIC_HOST,
  ATM10_PUBLIC_PORT,
  autocompleteSavedServers,
  autocompleteStatusHosts,
  emptyListNote,
  isAllSelection,
  listSavedStatusTargets,
  looksLikeAtm10Host,
  parseHostPort,
  resolveStatusSelection,
  staleNote
};
