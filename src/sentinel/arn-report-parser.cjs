'use strict';

function clean(value, max = 180) {
  return String(value || '')
    .replace(/[\r\n\0]+/g, ' ')
    .replace(/[@`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanName(value, max = 80) {
  return clean(value, max)
    .replace(/^[*_]{1,3}\s*/, '')
    .replace(/\s*[*_]{1,3}$/, '')
    .replace(/^[!"'.\s]+|[!"'.\s]+$/g, '')
    .trim();
}

function payloadText(payload = {}) {
  const lines = [];
  if (payload.content) lines.push(payload.content);
  if (payload.message) lines.push(payload.message);
  if (payload.text) lines.push(payload.text);
  for (const embed of Array.isArray(payload.embeds) ? payload.embeds : []) {
    lines.push(embed?.title, embed?.description, embed?.footer?.text);
    for (const field of Array.isArray(embed?.fields) ? embed.fields : []) lines.push(field?.name, field?.value);
  }
  return lines.map((line) => String(line || '').trim()).filter(Boolean).join('\n');
}

function kindFromVerb(verb) {
  const value = String(verb || '').toLowerCase();
  if (value === 'tamed' || value === 'captured') return 'tame';
  if (value === 'killed' || value === 'defeated' || value === 'slain') return 'kill';
  return '';
}

function award(kind, dinoName, playerName, mapName, serverName = '', tribeName = '', eventId = '') {
  const dino = cleanName(dinoName, 160);
  const player = cleanName(playerName, 80);
  if (!kind || !dino || !player) return { ok: false, reason: 'malformed' };
  return {
    ok: true,
    kind,
    dinoName: dino,
    playerName: player,
    mapName: clean(mapName, 100),
    serverName: clean(serverName, 100),
    tribeName: cleanName(tribeName, 80),
    eventId: clean(eventId, 80)
  };
}

function embedField(payload, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const embed of Array.isArray(payload?.embeds) ? payload.embeds : []) {
    for (const field of Array.isArray(embed?.fields) ? embed.fields : []) {
      if (wanted.has(String(field?.name || '').trim().toLowerCase())) return field?.value;
    }
  }
  return '';
}

function parseMarker(text, authoritativeMap) {
  const line = String(text || '').split(/\r?\n/).find((row) => /NEXUS\|(ACTIVE|TAMED|KILLED|DESPAWNED)\|/i.test(row));
  if (!line) return null;
  const parts = line.slice(line.toUpperCase().indexOf('NEXUS|')).split('|');
  const state = String(parts[1] || '').toUpperCase();
  if (state === 'ACTIVE' || state === 'DESPAWNED') return { ok: false, reason: 'not-award', state };
  if (state !== 'TAMED' && state !== 'KILLED') return { ok: false, reason: 'malformed' };
  return award(
    state === 'TAMED' ? 'tame' : 'kill',
    parts[2],
    parts[3],
    authoritativeMap || parts[5],
    parts[4],
    parts[6],
    parts[7]
  );
}

function proseLine(value) {
  return String(value || '').replace(/[*_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseProseLine(line, authoritativeMap) {
  const stripped = proseLine(line);
  if (!stripped) return null;
  if (/\bhas\s+spawned\b|\bdetected\s+on\b|\bhas\s+despawned\b|\bno\s+longer\s+detectable\b|\bsignal\s+lost\b/i.test(stripped)
    && !/\bhas\s+been\s+(tamed|killed)\b/i.test(stripped)) {
    return { ok: false, reason: 'not-award' };
  }
  const native = stripped.match(/^(.+?)\s+has\s+been\s+(tamed|killed)\s+by\s+(.+?)\s*$/i);
  if (native) return award(kindFromVerb(native[2]), native[1], native[3], authoritativeMap);
  const resolved = stripped.match(/^(.+?)(?:\s+on\s+(.+?))?\s+(?:was|has been|is)\s+(captured|tamed|defeated|killed|slain)\s+by\s+(.+?)\s*$/i);
  if (resolved) return award(kindFromVerb(resolved[3]), resolved[1], resolved[4], authoritativeMap || resolved[2]);
  if (/\b(tamed|killed|captured|defeated|slain)\b/i.test(stripped)) return { ok: false, reason: 'malformed' };
  return null;
}

function parseProse(text, authoritativeMap) {
  const lines = String(text || '').split(/\r?\n/);
  let malformed = false;
  let other = false;
  for (const line of lines) {
    const parsed = parseProseLine(line, authoritativeMap);
    if (!parsed) continue;
    if (parsed.ok) return parsed;
    if (parsed.reason === 'malformed') malformed = true;
    if (parsed.reason === 'not-award') other = true;
  }
  if (malformed) return { ok: false, reason: 'malformed' };
  if (other || lines.some((line) => proseLine(line))) return { ok: false, reason: other ? 'not-award' : 'malformed' };
  return { ok: false, reason: 'malformed' };
}

function parseArnReport(payload = {}, authoritativeMap = '') {
  const text = payloadText(payload);
  if (!text) return { ok: false, reason: 'malformed' };
  const marker = parseMarker(text, authoritativeMap);
  if (marker) {
    if (!marker.ok) return marker;
    return {
      ...marker,
      tribeName: marker.tribeName || cleanName(embedField(payload, ['tribe', 'tribe name']), 80),
      eventId: marker.eventId || clean(embedField(payload, ['id', 'event', 'event id', 'timestamp', 'time']), 80)
    };
  }
  const prose = parseProse(text, authoritativeMap);
  if (prose?.ok) return { ...prose, tribeName: prose.tribeName || '', eventId: prose.eventId || '' };
  return prose;
}

module.exports = {
  cleanName,
  payloadText,
  parseArnReport
};
