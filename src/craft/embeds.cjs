'use strict';

const COLORS = Object.freeze({
  black: 0x0A0A0A,
  fieryRed: 0xC8102E,
  gunmetal: 0x2F3437,
  silver: 0xC0C0C0
});
const MOTTO = 'Many Worlds One Nexus';

function cleanField(value, max = 200) {
  const text = String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (/^(n\/a|na|none|unknown|—|-)$/i.test(text)) return '';
  return text.slice(0, max);
}

function scrub(value, forbidden = []) {
  let text = String(value ?? '');
  for (const secret of forbidden) {
    const token = String(secret || '');
    if (token.length < 4) continue;
    if (text.includes(token)) text = text.split(token).join('');
  }
  return text;
}

function joinSecrets(forbidden, host) {
  const skip = String(host || '');
  return (forbidden || []).filter((item) => {
    const token = String(item || '');
    if (!token || token === skip || /^\d{1,5}$/.test(token)) return false;
    return true;
  });
}

function addField(fields, name, value, { inline = true, forbidden = [] } = {}) {
  const text = cleanField(scrub(value, forbidden), 1024);
  if (!text) return;
  fields.push({ name: String(name).slice(0, 256), value: text, inline });
}

function footer(suffix) {
  const extra = cleanField(suffix, 80);
  return { text: extra ? `${MOTTO} • ${extra}` : MOTTO };
}

function joinValue(host, port) {
  const name = cleanField(host, 255);
  const number = Number(port);
  if (!name || !Number.isInteger(number) || number < 1 || number > 65535) return '';
  return `${name}:${number}`;
}

function playerLine(status) {
  if (!status || status.offline) return '';
  const online = Number(status.online);
  const max = Number(status.max);
  if (!Number.isFinite(online) || !Number.isFinite(max)) return '';
  return `${Math.max(0, Math.trunc(online))}/${Math.max(0, Math.trunc(max))}`;
}

function sampleLine(status) {
  const names = Array.isArray(status?.sample) ? status.sample : [];
  return names.map((name) => cleanField(name, 16)).filter(Boolean).slice(0, 12).join(', ');
}

function latencyLine(status) {
  if (status?.latencyMs === null || status?.latencyMs === undefined || status?.latencyMs === '') return '';
  const latency = Number(status.latencyMs);
  if (!Number.isFinite(latency) || latency < 0) return '';
  return `${Math.round(latency)} ms`;
}

function statusLabel(status) {
  if (!status || status.offline) return 'Offline';
  return 'Online';
}

function safeRconName(value) {
  const name = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(name) ? name : '';
}

function staffComponents(rconName) {
  const name = safeRconName(rconName);
  if (!name) return [];
  return [{
    type: 1,
    components: [
      { type: 2, style: 2, label: 'Player list', custom_id: `craft:staff:players:${name}` },
      { type: 2, style: 2, label: 'Whitelist', custom_id: `craft:staff:whitelist:${name}` }
    ]
  }];
}

function payload(embed, components = []) {
  const body = { embeds: [embed], allowedMentions: { parse: [] } };
  if (components.length) body.components = components;
  return body;
}

function buildJavaEmbed(input = {}) {
  const forbidden = input.forbidden || [];
  const status = input.java || null;
  const online = status && !status.offline;
  const fields = [];
  addField(fields, 'Status', statusLabel(status), { forbidden });
  addField(fields, 'Players', playerLine(status), { forbidden });
  addField(fields, 'Playing', sampleLine(status), { inline: false, forbidden });
  addField(fields, 'Version', status?.version, { forbidden });
  addField(fields, 'MOTD', status?.motd, { inline: false, forbidden });
  addField(fields, 'Latency', latencyLine(status), { forbidden });
  addField(fields, 'Join', joinValue(input.host, input.javaPort || input.port), { inline: false, forbidden: joinSecrets(forbidden, input.host) });
  const embed = {
    title: 'Nexus Craft • Java',
    color: online ? COLORS.fieryRed : COLORS.black,
    fields,
    footer: footer('status')
  };
  const components = input.includeStaffActions ? staffComponents(input.rconName) : [];
  return payload(embed, components);
}

function buildBedrockEmbed(input = {}) {
  const forbidden = input.forbidden || [];
  const status = input.bedrock || null;
  const online = status && !status.offline;
  const fields = [];
  addField(fields, 'Status', statusLabel(status), { forbidden });
  addField(fields, 'Players', playerLine(status), { forbidden });
  addField(fields, 'Version', status?.version, { forbidden });
  addField(fields, 'MOTD', status?.motd, { inline: false, forbidden });
  addField(fields, 'Join', joinValue(input.host, input.bedrockPort || input.port), { inline: false, forbidden: joinSecrets(forbidden, input.host) });
  return payload({
    title: 'Nexus Craft • Bedrock',
    color: online ? COLORS.gunmetal : COLORS.black,
    fields,
    footer: footer('status')
  });
}

function buildGeyserEmbed(input = {}) {
  const forbidden = input.forbidden || [];
  const status = input.java || null;
  const online = status && !status.offline;
  const fields = [];
  addField(fields, 'Status', statusLabel(status), { forbidden });
  addField(fields, 'Players', playerLine(status), { forbidden });
  addField(fields, 'Playing', sampleLine(status), { inline: false, forbidden });
  addField(fields, 'Version', status?.version, { forbidden });
  addField(fields, 'MOTD', status?.motd, { inline: false, forbidden });
  addField(fields, 'Latency', latencyLine(status), { forbidden });
  addField(fields, 'Join (Java)', joinValue(input.host, input.javaPort), { inline: false, forbidden: joinSecrets(forbidden, input.host) });
  addField(fields, 'Join (Bedrock)', joinValue(input.host, input.bedrockPort), { inline: false, forbidden: joinSecrets(forbidden, input.host) });
  return payload({
    title: 'Nexus Craft • Geyser',
    color: online ? COLORS.fieryRed : COLORS.black,
    fields,
    footer: footer('status')
  });
}

function buildRealmEmbed(listing = {}) {
  const open = listing.status !== 'closed';
  const fields = [];
  const owner = String(listing.ownerId || '').trim();
  if (/^\d{17,20}$/.test(owner)) fields.push({ name: 'Owner', value: `<@${owner}>`, inline: true });
  const embed = {
    title: cleanField(listing.name, 80) || 'Realm',
    color: open ? COLORS.fieryRed : COLORS.silver,
    footer: footer(`realm:${cleanField(listing.id, 16)}`)
  };
  const description = cleanField(listing.description, 1000);
  if (description) embed.description = description;
  if (fields.length) embed.fields = fields;
  if (listing.image) embed.image = { url: listing.image };
  return payload(embed, [{
    type: 1,
    components: [{
      type: 2,
      style: open ? 1 : 2,
      label: open ? 'Apply' : 'Closed',
      custom_id: `craft:realm:apply:${listing.id}`,
      disabled: !open
    }]
  }]);
}

function buildStatusPayload(input = {}) {
  const kind = input.kind === 'bedrock' || input.kind === 'geyser' ? input.kind : 'java';
  if (kind === 'bedrock') return buildBedrockEmbed(input);
  if (kind === 'geyser') return buildGeyserEmbed(input);
  return buildJavaEmbed(input);
}

function embedText(body) {
  return JSON.stringify(body || {});
}

module.exports = {
  COLORS,
  MOTTO,
  buildBedrockEmbed,
  buildGeyserEmbed,
  buildJavaEmbed,
  buildRealmEmbed,
  buildStatusPayload,
  cleanField,
  embedText,
  joinValue
};
