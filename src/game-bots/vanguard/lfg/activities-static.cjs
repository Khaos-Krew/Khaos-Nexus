'use strict';

// Static list until a later slice can read activity names from the manifest.
// No Bungie calls.
const ACTIVITIES = Object.freeze([
  Object.freeze({ key: 'raid', label: 'Raid', slots: 6 }),
  Object.freeze({ key: 'dungeon', label: 'Dungeon', slots: 3 }),
  Object.freeze({ key: 'nightfall', label: 'Nightfall', slots: 3 }),
  Object.freeze({ key: 'trials', label: 'Trials', slots: 3 }),
  Object.freeze({ key: 'iron-banner', label: 'Iron Banner', slots: 6 }),
  Object.freeze({ key: 'crucible', label: 'Crucible', slots: 6 }),
  Object.freeze({ key: 'gambit', label: 'Gambit', slots: 4 }),
  Object.freeze({ key: 'onslaught', label: 'Onslaught', slots: 3 }),
  Object.freeze({ key: 'pantheon', label: 'Pantheon', slots: 6 }),
  Object.freeze({ key: 'other', label: 'Other', slots: 6 })
]);

function findActivity(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  return ACTIVITIES.find((item) => item.key === raw || item.label.toLowerCase() === raw) || null;
}

function searchActivities(query) {
  const q = String(query || '').trim().toLowerCase();
  return ACTIVITIES
    .filter((item) => !q || item.label.toLowerCase().includes(q) || item.key.includes(q))
    .slice(0, 25)
    .map((item) => ({ name: item.label, value: item.key }));
}

module.exports = { ACTIVITIES, findActivity, searchActivities };
