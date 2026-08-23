'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { JsonStore } = require('../core/json-store.cjs');

const IDLEON_ACTIONS = Object.freeze(['profile', 'goals', 'builds', 'farming', 'calculators', 'progression', 'cards', 'obols', 'greenstacks']);

function cleanText(value, max = 1000) {
  return String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function actorKey(context = {}) { return cleanText(context.actorId || 'shared', 120) || 'shared'; }

function createUser() {
  return {
    profile: {}, goals: [], builds: {}, farming: {}, progression: {}, cards: {}, obols: {}, greenstacks: {}, updatedAt: ''
  };
}

function ensureUser(state, context = {}) {
  const key = actorKey(context);
  state.users ||= {};
  state.users[key] ||= createUser();
  return state.users[key];
}

function parsePairs(input) {
  const text = cleanText(input, 2000);
  if (!text) return {};
  const pairs = {};
  for (const fragment of text.split('|')) {
    const index = fragment.indexOf('=');
    if (index < 1) continue;
    const key = cleanText(fragment.slice(0, index), 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const value = cleanText(fragment.slice(index + 1), 500);
    if (key && value) pairs[key] = value;
  }
  return pairs;
}

function profileAction(store, payload, context) {
  const input = cleanText(payload.input, 2000);
  let result;
  store.update((state) => {
    const user = ensureUser(state, context);
    if (/^clear$/i.test(input)) user.profile = {};
    else if (input) Object.assign(user.profile, parsePairs(input));
    user.updatedAt = new Date().toISOString();
    result = {
      profile: { ...user.profile },
      usage: 'Set profile fields with key=value pairs separated by |. Example: main=bubo|world=4|level=350. Use clear to reset.'
    };
  });
  return result;
}

function goalsAction(store, payload, context) {
  const input = cleanText(payload.input, 1000);
  let result;
  store.update((state) => {
    const user = ensureUser(state, context);
    const add = /^add\s+(.+)$/i.exec(input);
    const done = /^done\s+([a-f0-9]+)$/i.exec(input);
    const remove = /^remove\s+([a-f0-9]+)$/i.exec(input);
    if (add) user.goals.push({ id: crypto.randomBytes(3).toString('hex'), text: cleanText(add[1], 500), done: false, createdAt: new Date().toISOString() });
    else if (done) {
      const goal = user.goals.find((item) => item.id === done[1].toLowerCase());
      if (!goal) throw new Error(`Goal ${done[1]} was not found.`);
      goal.done = !goal.done;
    } else if (remove) user.goals = user.goals.filter((item) => item.id !== remove[1].toLowerCase());
    else if (input && !/^list$/i.test(input)) user.goals.push({ id: crypto.randomBytes(3).toString('hex'), text: input, done: false, createdAt: new Date().toISOString() });
    user.updatedAt = new Date().toISOString();
    result = { goals: user.goals.map((item) => ({ ...item })), usage: 'list | add <goal> | done <id> | remove <id>' };
  });
  return result;
}

function keyedNotesAction(store, field, payload, context, label) {
  const input = cleanText(payload.input, 2000);
  const set = /^set\s+([^|]+)\|([\s\S]+)$/i.exec(input);
  const remove = /^remove\s+(.+)$/i.exec(input);
  const query = !set && !remove && input && !/^list$/i.test(input) ? input.toLowerCase() : '';
  let result;
  store.update((state) => {
    const user = ensureUser(state, context);
    user[field] ||= {};
    if (set) user[field][cleanText(set[1], 120)] = cleanText(set[2], 1200);
    if (remove) {
      const key = Object.keys(user[field]).find((name) => name.toLowerCase() === cleanText(remove[1], 120).toLowerCase());
      if (key) delete user[field][key];
    }
    user.updatedAt = new Date().toISOString();
    const entries = Object.entries(user[field])
      .filter(([key, value]) => !query || key.toLowerCase().includes(query) || String(value).toLowerCase().includes(query))
      .map(([name, notes]) => ({ name, notes }));
    result = { entries, usage: `list | set <${label}>|<notes> | remove <${label}> | <search>` };
  });
  return result;
}

function snapshotAction(store, field, payload, context) {
  const input = cleanText(payload.input, 2000);
  let result;
  store.update((state) => {
    const user = ensureUser(state, context);
    user[field] ||= {};
    if (/^clear$/i.test(input)) user[field] = {};
    else if (input) Object.assign(user[field], parsePairs(input));
    user.updatedAt = new Date().toISOString();
    result = {
      snapshot: { ...user[field] },
      usage: `Set ${field} fields with key=value pairs separated by |, or clear.`
    };
  });
  return result;
}

function number(value, label) {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a number.`);
  return parsed;
}

function calculatorsAction(payload = {}) {
  const input = cleanText(payload.input, 1000);
  const [modeRaw, ...rest] = input.split(/\s+/);
  const mode = String(modeRaw || '').toLowerCase();
  const values = rest.join(' ').split('|').map((part) => part.trim()).filter(Boolean);
  if (mode === 'kills') {
    if (values.length < 3) return { usage: 'kills <current>|<target>|<kills per minute>' };
    const current = number(values[0], 'current kills');
    const target = number(values[1], 'target kills');
    const rate = number(values[2], 'kills per minute');
    if (rate <= 0) throw new Error('Kills per minute must be greater than zero.');
    const remaining = Math.max(0, target - current);
    return { mode, current, target, ratePerMinute: rate, remaining, minutes: remaining / rate, hours: remaining / rate / 60 };
  }
  if (mode === 'rate') {
    if (values.length < 3) return { usage: 'rate <current>|<target>|<amount per hour>' };
    const current = number(values[0], 'current amount');
    const target = number(values[1], 'target amount');
    const rate = number(values[2], 'amount per hour');
    if (rate <= 0) throw new Error('Amount per hour must be greater than zero.');
    const remaining = Math.max(0, target - current);
    return { mode, current, target, ratePerHour: rate, remaining, hours: remaining / rate, days: remaining / rate / 24 };
  }
  if (mode === 'percent') {
    if (values.length < 2) return { usage: 'percent <current>|<target>' };
    const current = number(values[0], 'current');
    const target = number(values[1], 'target');
    if (target <= 0) throw new Error('Target must be greater than zero.');
    return { mode, current, target, percent: Math.min(100, Math.max(0, current / target * 100)), remaining: Math.max(0, target - current) };
  }
  return {
    calculators: [
      'kills <current>|<target>|<kills per minute>',
      'rate <current>|<target>|<amount per hour>',
      'percent <current>|<target>'
    ],
    note: 'Nexus only calculates values you provide; it does not invent hidden IdleOn account stats or game formulas.'
  };
}

class IdleOnProvider {
  constructor(options = {}) {
    this.store = options.store || new JsonStore(options.stateFile || path.join(process.cwd(), 'data', 'idleon-state.json'), { users: {} });
    this.connected = false;
    this.providerKind = 'local-companion';
    this.supportedActions = [...IDLEON_ACTIONS];
  }

  async invoke(actionId, payload = {}, context = {}) {
    if (actionId === 'profile') return profileAction(this.store, payload, context);
    if (actionId === 'goals') return goalsAction(this.store, payload, context);
    if (actionId === 'builds') return keyedNotesAction(this.store, 'builds', payload, context, 'class or character');
    if (actionId === 'farming') return keyedNotesAction(this.store, 'farming', payload, context, 'target');
    if (actionId === 'calculators') return calculatorsAction(payload);
    if (actionId === 'progression') return snapshotAction(this.store, 'progression', payload, context);
    if (actionId === 'cards') return snapshotAction(this.store, 'cards', payload, context);
    if (actionId === 'obols') return snapshotAction(this.store, 'obols', payload, context);
    if (actionId === 'greenstacks') return snapshotAction(this.store, 'greenstacks', payload, context);
    throw new Error(`IdleOn companion does not expose ${actionId}.`);
  }
}

module.exports = {
  IdleOnProvider, IDLEON_ACTIONS, cleanText, actorKey, parsePairs, profileAction, goalsAction,
  keyedNotesAction, snapshotAction, calculatorsAction
};
