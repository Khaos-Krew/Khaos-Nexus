'use strict';

const { ACTIVITIES, findActivity, searchActivities } = require('./activities-static.cjs');

function slotsFor(name, modeType) {
  const text = String(name || '').toLowerCase();
  if (text.includes('dungeon')) return 3;
  if (text.includes('nightfall')) return 3;
  if (text.includes('trial')) return 3;
  if (text.includes('gambit')) return 4;
  if (text.includes('onslaught')) return 3;
  if (Number(modeType) === 4 || text.includes('raid')) return 6;
  return 6;
}

function slug(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function createActivityCatalog({ query } = {}) {
  function modes() {
    try {
      return query?.activityModes?.() || [];
    } catch {
      return [];
    }
  }

  function find(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const hash = raw.startsWith('a:') ? raw.slice(2) : '';
    if (hash && query?.definition) {
      const row = query.definition('DestinyActivityDefinition', hash);
      const name = String(row?.displayProperties?.name || '').trim();
      if (name) return { key: `a:${hash}`, label: name, slots: slotsFor(name, row.directActivityModeType) };
    }
    const known = findActivity(raw);
    const match = modes().find((mode) => slug(mode.name) === raw.toLowerCase() || mode.name.toLowerCase() === raw.toLowerCase());
    if (match) {
      const key = known?.key || slug(match.name);
      return { key, label: match.name, slots: known?.slots || slotsFor(match.name, match.modeType) };
    }
    if (known) return { key: known.key, label: known.label, slots: known.slots };
    return null;
  }

  function search(text) {
    const listed = modes();
    let activities = [];
    try {
      activities = query?.searchActivities?.(text) || [];
    } catch {
      activities = [];
    }
    if (!listed.length && !activities.length) return searchActivities(text);
    const choices = [];
    const seen = new Set();
    const push = (name, value) => {
      const label = String(name || '').trim();
      const key = String(value || '').trim();
      if (!label || !key || seen.has(key)) return;
      seen.add(key);
      choices.push({ name: label.slice(0, 100), value: key.slice(0, 100) });
    };
    for (const row of activities) {
      if (row.source === 'activity') push(row.name, `a:${row.hash}`);
      else {
        const known = ACTIVITIES.find((item) => item.label.toLowerCase() === String(row.name).toLowerCase());
        push(row.name, known?.key || slug(row.name));
      }
    }
    if (!String(text || '').trim()) {
      for (const item of ACTIVITIES) push(item.label, item.key);
    }
    return choices.slice(0, 25);
  }

  return { find, search };
}

module.exports = { slotsFor, slug, createActivityCatalog };
