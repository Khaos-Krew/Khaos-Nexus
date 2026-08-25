'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { FEEDS } = require('../src/sentinel/event-feed.cjs');
const { LAYOUTS } = require('../src/sentinel/module-layouts.cjs');
const {
  parseDiabloNews,
  parseCallOfDutyNews
} = require('../src/backend/providers/news-enhanced-providers.cjs');
const {
  LiveDivision2Provider,
  parseTargetedLootText,
  nextDailyReset
} = require('../src/backend/providers/division2-live-provider.cjs');
const {
  targetedPayload,
  setBonusesPayload,
  timerPayload
} = require('../src/sentinel/division2-targeted-loot.cjs');

const TARGET_TEXT = `Daily Escalation Target Loot
Date: 2026-08-25
Rotation: Weekly Escalation Rotation

Missions:
- Liberty Island: Rigger
- Potomac Event Center: Eclipse Protocol
- American History Museum: Core Strength
- Jefferson Plaza: Body Armor
- Air & Space Museum: Shotgun

Vendor Caches:
- Weapons: Rifles
- Gear: Holsters

Last updated: 2026-08-25 10:08
Source: ProtoTrack.gg`;

test('persistent feed registry includes every currently supported news module', () => {
  const news = new Map();
  for (const feed of FEEDS) if (feed.actions.includes('news')) news.set(feed.moduleId, feed.channelName);
  assert.equal(news.get('warframe'), 'warframe-world-state');
  assert.equal(news.get('division2'), 'division-weekly');
  assert.equal(news.get('oncehuman'), 'once-human-news');
  assert.equal(news.get('diablo4'), 'diablo-news');
  assert.equal(news.get('callofduty'), 'cod-news');
  assert.ok(LAYOUTS.diablo4.text.includes('diablo-news'));
  assert.ok(LAYOUTS.callofduty.text.includes('cod-news'));
});

test('official news parsers produce changing headline snapshots rather than static source URLs', () => {
  const diablo = parseDiabloNews(`
    <a href="/en-us/article/123/season-update">Diablo IV Season Update</a>
    <a href="/en-us/article/456/patch-notes">Diablo IV Patch Notes 2.5.0</a>
  `, 'https://news.blizzard.com/en-us/diablo4');
  assert.equal(diablo.length, 2);
  assert.match(diablo[0].url, /news\.blizzard\.com/);

  const cod = parseCallOfDutyNews(`
    <a href="/patchnotes/2026/08/warzone-season-05">Call of Duty: Warzone Season 05 Patch Notes</a>
    <a href="/patchnotes/2026/08/bo7-season-05">Black Ops 7 Season 05 Patch Notes</a>
  `, 'https://www.callofduty.com/patchnotes');
  assert.equal(cod.length, 2);
  assert.match(cod[0].title, /Patch Notes/);
});

test('targeted-loot text parser preserves current mission allocation and vendor caches', () => {
  const parsed = parseTargetedLootText(TARGET_TEXT);
  assert.equal(parsed.date, '2026-08-25');
  assert.equal(parsed.missions.length, 5);
  assert.deepEqual(parsed.missions[0], { area:'Liberty Island', target:'Rigger' });
  assert.deepEqual(parsed.vendorCaches[1], { type:'Gear', target:'Holsters' });
});

test('Division 2 daily reset calculation rolls forward at 08:00 UTC', () => {
  assert.equal(nextDailyReset(new Date('2026-08-25T07:59:59Z')).toISOString(), '2026-08-25T08:00:00.000Z');
  assert.equal(nextDailyReset(new Date('2026-08-25T08:00:00Z')).toISOString(), '2026-08-26T08:00:00.000Z');
});

test('live Division 2 provider returns targeted locations and set bonuses through existing backend actions', async () => {
  const stateFile = `/tmp/nexus-division-live-${process.pid}-${Date.now()}.json`;
  const brandCsv = 'name,default_core_stat_id,1pc_bonus,2pc_bonus,3pc_bonus\nLengmo,Armor,Explosive Resistance,Armor Regen,Increased Threat\n';
  const gearCsv = 'name,default_core_stat_id,1pc_bonus,2pc_bonus,3pc_bonus,4pc_bonus\nRigger,Skill Tier,,,Skill Haste,Best Buds\nEclipse Protocol,Skill Tier,,,Status Effects,Indirect Transmission\n';
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('target-loot-current.txt')) return { ok:true, text:async () => TARGET_TEXT };
    if (value.endsWith('/gear/brand_sets.csv')) return { ok:true, text:async () => brandCsv };
    if (value.endsWith('/gear/gear_sets.csv')) return { ok:true, text:async () => gearCsv };
    return { ok:false, status:404, text:async () => '' };
  };
  const provider = new LiveDivision2Provider({ fetchImpl, stateFile });
  const targeted = await provider.invoke('farming', { mode:'targeted' }, { role:'viewer' });
  assert.equal(targeted.missions[1].target, 'Eclipse Protocol');
  assert.match(targeted.resetCadence, /08:00 UTC/);
  const sets = await provider.invoke('gear', { mode:'sets', names:targeted.missions.map((item) => item.target) }, { role:'viewer' });
  assert.equal(sets.results.some((item) => item.name === 'Rigger'), true);
  assert.equal(sets.results.some((item) => item.name === 'Eclipse Protocol'), true);
  fs.rmSync(stateFile, { force:true });
});

test('Division 2 button payloads expose targeted loot, set bonuses, and a Discord-relative reset timer', () => {
  const targeted = {
    date:'2026-08-25', rotation:'Weekly Escalation Rotation',
    missions:[{ area:'Liberty Island', target:'Rigger' }], vendorCaches:[],
    nextResetUnix:1787731200, resetCadence:'Daily at 08:00 UTC (community-tracked)', source:'ProtoTrack.gg'
  };
  assert.match(JSON.stringify(targetedPayload(targeted)), /Liberty Island/);
  assert.match(JSON.stringify(timerPayload(targeted)), /<t:1787731200:R>/);
  const setPayload = setBonusesPayload(targeted, { results:[{
    name:'Rigger', type:'Gear Set', bonuses:[{ pieces:'4 pc', bonus:'Best Buds' }]
  }] });
  assert.match(JSON.stringify(setPayload), /Best Buds/);
  assert.match(JSON.stringify(setPayload), /divisionloot:sets/);
});
