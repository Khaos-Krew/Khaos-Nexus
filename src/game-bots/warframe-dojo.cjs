'use strict';

const DOJO_LINKS = Object.freeze([
  ['Dojo rooms', 'https://wiki.warframe.com/w/Dojo'],
  ['Clan research', 'https://wiki.warframe.com/w/Research'],
  ['Trading post', 'https://wiki.warframe.com/w/Trading']
]);

function dojoChecklist() {
  return [
    '**Clan dojo checklist**',
    '• Clan key and dojo capacity are a clan-lead decision.',
    '• Research labs: Orokin, Tenno, Chem, Bio, Energy, and Ventkids as the clan needs them.',
    '• Place a Trading Post and a Dry Dock before you invite traders or railjack crews.',
    '• Decorations and pigments are cosmetic. They do not change combat power.',
    '',
    '**Links**',
    ...DOJO_LINKS.map(([label, url]) => `• [${label}](${url})`),
    '',
    'This is a static v1 checklist. Wallet, verify, and ranks stay on Nexus Sentinal.'
  ].join('\n');
}

module.exports = { DOJO_LINKS, dojoChecklist };
