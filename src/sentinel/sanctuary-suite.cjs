'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DIABLO4_CLASSES } = require('../backend/providers/game-companion-providers.cjs');

const LFG_ACTIVITIES = Object.freeze([
  { value: 'helltide', label: 'Helltide' },
  { value: 'boss', label: 'Boss' },
  { value: 'pit', label: 'Pit' },
  { value: 'seasonal', label: 'Seasonal activity' }
]);

const BUILD_TYPES = Object.freeze([
  { value: 'leveling', label: 'Leveling' },
  { value: 'endgame', label: 'Endgame' },
  { value: 'speed', label: 'Speed' },
  { value: 'boss', label: 'Boss' },
  { value: 'pit', label: 'Pit' }
]);

const SEASON_ITEMS = Object.freeze([
  { id: 'roles', label: 'Class, world tier, and seasonal interest roles set' },
  { id: 'build', label: 'Build link shared with a class and build type' },
  { id: 'helltide', label: 'Helltide group posted or joined' },
  { id: 'boss', label: 'Boss group posted or joined' },
  { id: 'pit', label: 'Pit group posted or joined' },
  { id: 'goals', label: 'Season goals read' }
]);

const ROLE_GROUPS = Object.freeze([
  {
    id: 'class',
    placeholder: 'Class',
    max: 3,
    roles: DIABLO4_CLASSES.map((label) => ({ key: slug(label), label, name: `Sanctuary ${label}` }))
  },
  {
    id: 'tier',
    placeholder: 'World tier',
    max: 1,
    roles: [1, 2, 3, 4].map((tier) => ({ key: `wt${tier}`, label: `World Tier ${tier}`, name: `Sanctuary World Tier ${tier}` }))
  },
  {
    id: 'interest',
    placeholder: 'Seasonal interest',
    max: 5,
    roles: [
      ['seasonal', 'Seasonal'],
      ['eternal', 'Eternal'],
      ['helltide', 'Helltide'],
      ['boss', 'Bosses'],
      ['pit', 'Pit']
    ].map(([key, label]) => ({ key, label, name: `Sanctuary ${label}` }))
  }
]);

function slug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function allRoleNames() {
  return ROLE_GROUPS.flatMap((group) => group.roles.map((role) => role.name));
}

function roleGroup(groupId) {
  return ROLE_GROUPS.find((group) => group.id === groupId) || null;
}

function planRoles(existingNames, canManage) {
  const have = new Set((existingNames || []).map((name) => String(name)));
  const missing = allRoleNames().filter((name) => !have.has(name));
  return {
    missing,
    ready: missing.length === 0,
    create: missing.length > 0 && Boolean(canManage)
  };
}

function roleDiff(currentIds, groupIds, selectedIds) {
  const current = new Set((currentIds || []).map(String));
  const selected = new Set((selectedIds || []).map(String));
  const add = [];
  const remove = [];
  for (const id of (groupIds || []).map(String)) {
    const has = current.has(id);
    const want = selected.has(id);
    if (want && !has) add.push(id);
    if (!want && has) remove.push(id);
  }
  return { add, remove };
}

function sanitizePublic(value, max = 200) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/@/g, '@\u200b')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function safeHttpLink(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.username || url.password) return '';
    return url.toString().slice(0, 300);
  } catch {
    return '';
  }
}

function emptyState() {
  return { lfg: [], checks: {} };
}

function lfgTtlMs(env = process.env) {
  const minutes = Number(env.SANCTUARY_LFG_TTL_MINUTES);
  const bounded = Number.isFinite(minutes) ? Math.min(240, Math.max(15, Math.trunc(minutes))) : 120;
  return bounded * 60 * 1000;
}

function createLfgEntry({ id, userId, activity, note, voiceId, channelId, now = Date.now(), ttlMs = lfgTtlMs() } = {}) {
  const activityId = LFG_ACTIVITIES.some((item) => item.value === activity) ? activity : '';
  return {
    id: String(id || crypto.randomBytes(4).toString('hex')),
    userId: String(userId || '').replace(/\D/g, '').slice(0, 20),
    activity: activityId,
    note: sanitizePublic(note, 200),
    voiceId: String(voiceId || '').replace(/\D/g, '').slice(0, 20),
    channelId: String(channelId || '').replace(/\D/g, '').slice(0, 20),
    messageId: '',
    expiresAt: now + ttlMs,
    closed: false,
    reason: ''
  };
}

function activityLabel(activity) {
  return LFG_ACTIVITIES.find((item) => item.value === activity)?.label || 'Group';
}

function buildTypeLabel(value) {
  return BUILD_TYPES.find((item) => item.value === value)?.label || 'Build';
}

function classLabel(value) {
  const match = ROLE_GROUPS[0].roles.find((role) => role.key === value);
  return match?.label || '';
}

function lfgMessage(entry) {
  const closed = Boolean(entry.closed);
  const title = `Sanctuary Nexus • ${activityLabel(entry.activity)}${closed ? (entry.reason === 'expired' ? ' (expired)' : ' (closed)') : ''}`;
  const description = closed
    ? (entry.reason === 'expired' ? 'This group expired.' : 'This group was closed.')
    : (entry.note || 'Group is open.');
  const voice = !closed && entry.voiceId ? `Voice: <#${entry.voiceId}>` : '';
  return {
    content: voice,
    embeds: [{
      title: title.slice(0, 256),
      description: description.slice(0, 4000),
      fields: [
        { name: 'Host', value: entry.userId ? `<@${entry.userId}>` : 'Unknown', inline: true },
        { name: 'Activity', value: activityLabel(entry.activity), inline: true },
        { name: closed ? 'State' : 'Closes', value: closed ? 'Closed' : `<t:${Math.floor(Number(entry.expiresAt) / 1000)}:R>`, inline: true }
      ],
      footer: { text: 'Sanctuary Nexus • group post' }
    }],
    components: closed ? [] : [{
      type: 1,
      components: [{ type: 2, style: 4, label: 'Close group', custom_id: `sanctuary:lfg:close:${entry.id}` }]
    }],
    allowedMentions: !closed && entry.voiceId ? { parse: [], channels: [entry.voiceId] } : { parse: [] }
  };
}

function buildShareMessage({ link, className, buildType, note, userId }) {
  return {
    embeds: [{
      title: 'Sanctuary Nexus build',
      description: 'Shared link and tags. Sanctuary Nexus does not open or scrape the link.',
      fields: [
        { name: 'Link', value: String(link || '').slice(0, 300), inline: false },
        { name: 'Class', value: className || 'Untagged', inline: true },
        { name: 'Type', value: buildType || 'Untagged', inline: true },
        { name: 'Note', value: note || 'None', inline: false },
        { name: 'Shared by', value: userId ? `<@${userId}>` : 'Unknown', inline: true }
      ],
      footer: { text: 'Sanctuary Nexus • build share' }
    }],
    allowedMentions: { parse: [] }
  };
}

function roleMenuPayload(groups) {
  const components = [];
  for (const group of groups || []) {
    const options = (group.roles || []).slice(0, 25).map((role) => ({
      label: String(role.label || 'Role').slice(0, 100),
      value: String(role.id).slice(0, 100)
    })).filter((option) => option.value);
    if (!options.length) continue;
    components.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: `sanctuary:roles:${group.id}`,
        placeholder: String(group.placeholder || 'Choose').slice(0, 150),
        min_values: 0,
        max_values: Math.max(1, Math.min(group.max || 1, options.length)),
        options
      }]
    });
  }
  return {
    embeds: [{
      title: 'Sanctuary Nexus roles',
      description: 'Pick a class, a world tier, and seasonal interests. These Discord roles do not change Nexus Sentinal wallet, verify, shop, or ranks.',
      footer: { text: 'Sanctuary Nexus • self-roles' }
    }],
    components,
    allowedMentions: { parse: [] }
  };
}

function roleInstruction(missing) {
  const lines = (missing || []).map((name) => `• ${name}`);
  return {
    embeds: [{
      title: 'Sanctuary Nexus roles need setup',
      description: 'Create the roles below, or give Sanctuary Nexus Manage Roles and place its role above them. Then run `/sanctuary roles` again. A staff member can post the menu with `/sanctuary roles post:true`.',
      fields: [{ name: 'Required role names', value: (lines.join('\n') || 'None').slice(0, 1024) }],
      footer: { text: 'Sanctuary Nexus • role setup' }
    }],
    allowedMentions: { parse: [] }
  };
}

function seasonChecklistMessage(doneIds) {
  const done = new Set((doneIds || []).map(String));
  const lines = SEASON_ITEMS.map((item) => `${done.has(item.id) ? '☑' : '☐'} ${item.label}`);
  const buttons = SEASON_ITEMS.map((item) => ({
    type: 2,
    style: done.has(item.id) ? 3 : 2,
    label: `${done.has(item.id) ? 'Done' : 'Toggle'}: ${item.label}`.slice(0, 80),
    custom_id: `sanctuary:check:${item.id}`
  }));
  const components = [];
  for (let index = 0; index < buttons.length; index += 5) {
    components.push({ type: 1, components: buttons.slice(index, index + 5) });
  }
  return {
    embeds: [{
      title: 'Sanctuary Nexus season checklist',
      description: lines.join('\n').slice(0, 4000),
      footer: { text: 'Sanctuary Nexus • your checklist only' }
    }],
    components,
    allowedMentions: { parse: [] }
  };
}

function toggleItem(doneIds, itemId) {
  if (!SEASON_ITEMS.some((item) => item.id === itemId)) return [...(doneIds || [])];
  const next = new Set((doneIds || []).map(String));
  if (next.has(itemId)) next.delete(itemId);
  else next.add(itemId);
  return SEASON_ITEMS.map((item) => item.id).filter((id) => next.has(id));
}

function seasonPostMessage({ title, note } = {}) {
  const heading = sanitizePublic(title, 120) || 'Sanctuary Nexus season note';
  const body = sanitizePublic(note, 500) || 'A new season window is open in this category.';
  return {
    embeds: [{
      title: heading.slice(0, 256),
      description: [
        body,
        '',
        '**Herald template**',
        'Season note for Sanctuary Nexus.',
        'Groups: helltide, bosses, and pits. Post one with `/sanctuary lfg`.',
        'Builds: share a link and tags with `/sanctuary build`. The bot does not open the link.',
        'Roles: `/sanctuary roles` sets class, world tier, and seasonal interest.',
        'Checklist: `/sanctuary season`.',
        'Wallet, verify, and shop stay on Nexus Sentinal (`/bal`, `/o9verify`).'
      ].join('\n').slice(0, 4000),
      footer: { text: 'Sanctuary Nexus • staff season note' }
    }],
    allowedMentions: { parse: [] }
  };
}

function categoryGateLabel(config) {
  if (config?.open) return 'unset (gate open)';
  if (config?.failClosed) return 'invalid (fail-closed)';
  if (config?.id) return `present (${config.envName || 'category env'})`;
  return 'missing';
}

function sanctuaryStatusText({ ready, readyFlag, category, guildName, guildConfigured, ping, registered } = {}) {
  const latency = Number.isFinite(Number(ping)) && Number(ping) >= 0 ? `${Math.round(Number(ping))} ms` : 'unavailable';
  const lines = [
    '**Sanctuary Nexus status**',
    `Discord: ${ready ? 'ready' : 'not ready'}.`,
    `READY flag: ${readyFlag || 'unset'} (logged only).`,
    `Category id: ${categoryGateLabel(category)}.`,
    `Guild: ${sanitizePublic(guildName, 80) || 'unknown'} (${guildConfigured ? 'id present' : 'missing'}).`,
    `Latency: ${latency}.`
  ];
  if (registered === true) lines.push('Commands registered again.');
  if (registered === false) lines.push('Command registration failed.');
  lines.push('Wallet, verify, and shop stay on Nexus Sentinal.');
  return lines.join('\n').slice(0, 1900);
}

function sanctuaryHelpText() {
  return [
    '**Sanctuary Nexus help**',
    'Live commands:',
    '• `/nexushelp` — this list',
    '• `/sanctuary help` — this list',
    '• `/sanctuary roles` — class, world tier, and seasonal interest roles',
    '• `/sanctuary lfg` — post a helltide, boss, pit, or seasonal group',
    '• `/sanctuary build` — share a build link and tags',
    '• `/sanctuary season` — your season checklist',
    '• `/sanctuary seasonpost` — staff season note',
    '• `/sanctuary status` — staff service status',
    '• `/status` — staff service status',
    '',
    'Wallet (`/bal`), verify (`/o9verify`), shop, and ranks stay on Nexus Sentinal.'
  ].join('\n');
}

function helpEmbed() {
  return {
    embeds: [{
      title: 'Sanctuary Nexus help',
      description: sanctuaryHelpText().slice(0, 4000),
      footer: { text: 'Sanctuary Nexus' }
    }],
    allowedMentions: { parse: [] }
  };
}

class SanctuaryStore {
  constructor(file) {
    this.file = file ? path.resolve(file) : '';
    this.state = emptyState();
    if (this.file) this.load();
  }

  load() {
    if (!this.file) return this.state;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        this.state = {
          lfg: Array.isArray(parsed.lfg) ? parsed.lfg.slice(-100) : [],
          checks: parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {}
        };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') this.state = emptyState();
    }
    return this.state;
  }

  save() {
    this.state.lfg = (this.state.lfg || []).slice(-100);
    if (!this.file) return this.state;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, this.file);
    return this.state;
  }

  saveLfg(entry) {
    const list = this.state.lfg.filter((item) => item.id !== entry.id && (!item.closed || item.expiresAt > Date.now() - 86400000));
    list.push(entry);
    this.state.lfg = list.slice(-100);
    this.save();
    return entry;
  }

  getLfg(id) {
    return this.state.lfg.find((item) => item.id === id) || null;
  }

  checksFor(userId) {
    const key = String(userId || '').replace(/\D/g, '').slice(0, 20);
    const saved = this.state.checks[key];
    return Array.isArray(saved) ? saved.map(String) : [];
  }

  setChecks(userId, ids) {
    const key = String(userId || '').replace(/\D/g, '').slice(0, 20);
    if (!key) return [];
    this.state.checks[key] = SEASON_ITEMS.map((item) => item.id).filter((id) => (ids || []).map(String).includes(id));
    this.save();
    return this.state.checks[key];
  }
}

module.exports = {
  LFG_ACTIVITIES,
  BUILD_TYPES,
  SEASON_ITEMS,
  ROLE_GROUPS,
  slug,
  allRoleNames,
  roleGroup,
  planRoles,
  roleDiff,
  sanitizePublic,
  safeHttpLink,
  lfgTtlMs,
  createLfgEntry,
  activityLabel,
  buildTypeLabel,
  classLabel,
  lfgMessage,
  buildShareMessage,
  roleMenuPayload,
  roleInstruction,
  seasonChecklistMessage,
  toggleItem,
  seasonPostMessage,
  categoryGateLabel,
  sanctuaryStatusText,
  sanctuaryHelpText,
  helpEmbed,
  SanctuaryStore
};
