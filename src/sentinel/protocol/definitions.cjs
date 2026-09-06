'use strict';
const definitions = [
  ['alpha-purge', 'Alpha Purge', 'alpha-kill', 'Hunt alpha creatures.', 'scheduled'],
  ['ascension', 'Ascension', 'boss-kill', 'Confront world bosses.', 'scheduled'],
  ['dark-zone', 'Dark Zone', 'pvp-kill', 'Voluntary PvP; server protection adapter required.', 'opt-in'],
  ['anomaly', 'Anomaly', 'anomaly-kill', 'Track anomalous creatures.', 'reactive'],
  ['extraction', 'Extraction', 'delivery', 'Recover and deliver objectives.', 'scheduled'],
  ['community', 'Community', 'community-objective', 'Staff-defined planned events.', 'manual']
].map(([id, name, metric, description, activation]) => Object.freeze({ id, name, metric, description, activation, version: 1 }));
module.exports = { DEFINITIONS: Object.freeze(definitions) };
