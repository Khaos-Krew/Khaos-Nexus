'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { XUR_VENDOR_HASH, renderXur } = require('../../src/game-bots/vanguard/panels/xur.cjs');
const { describeMilestone, renderWeeklyReset, sectionFor } = require('../../src/game-bots/vanguard/panels/weekly-reset.cjs');
const { boardEmbed, renderPost } = require('../../src/game-bots/vanguard/lfg/lfg-buttons.cjs');
const { upsertOwnedPanel } = require('../../src/game-bots/vanguard/panels.cjs');
const { DISCORD, messageCharacterCount, packSections } = require('../../src/game-bots/vanguard/panels/layout.cjs');

const NOW = Date.parse('2026-10-02T19:00:00Z');
const RESET = '2026-10-06T17:00:00Z';
const HELMET = 3448274439;
const KINETIC = 1498876634;

function withinDiscord(embeds) {
  assert.ok(messageCharacterCount(embeds) <= DISCORD.message);
  for (const embed of embeds) {
    assert.ok((embed.fields || []).length <= DISCORD.fields);
    assert.doesNotMatch(embed.title || '', /Nexus Vanguard|Vanguard Nexus/);
    for (const field of embed.fields || []) {
      assert.equal(field.inline, false);
      assert.ok(field.value.length <= DISCORD.fieldValue);
      assert.ok(field.name.length <= DISCORD.fieldName);
      assert.notEqual(field.value, 'None');
    }
  }
}

function fieldText(embed, name) {
  return (embed.embeds || [embed]).flatMap((page) => page.fields || [])
    .filter((field) => field.name.includes(name))
    .map((field) => field.value)
    .join('\n');
}

test('weekly reset stacks full sections and files raids, dungeons, and the nightfall', () => {
  const rows = {};
  const names = new Map();
  const add = (hash, name, extra = {}) => {
    rows[hash] = { milestoneHash: hash, endDate: RESET, ...extra.row };
    names.set(String(hash), { name, ...extra.meta });
  };
  add(1, "King's Fall");
  add(2, "Crota's End", { meta: { featured: true } });
  add(3, 'Deep Stone Crypt', { meta: { modifiers: ['Weekly Featured'] } });
  add(4, 'Vault of Glass');
  add(5, 'Vow of the Disciple');
  add(6, 'Root of Nightmares');
  add(7, "Salvation's Edge");
  add(8, 'Last Wish');
  add(9, 'Grasp of Avarice');
  add(10, 'The Corrupted', { meta: { activityModeTypes: [46] } });
  add(11, 'Crucible Rotator');
  add(12, 'Vanguard Ops');
  add(13, 'Weekly Clan Engrams');
  add(14, 'Garden of Salvation');
  add(15, 'Desert Perpetual');
  add(16, 'Ghosts of the Deep', { meta: { isFocusedActivity: true } });
  add(17, 'Shattered Throne', { meta: { rotator: true } });
  add(18, 'Equilibrium');
  add(19, 'Pinnacle Ops');
  add(20, 'Weekly Pinnacle Challenge');
  const embed = renderWeeklyReset({ milestones: { Response: rows }, names, now: NOW });
  const resetUnix = Math.floor(Date.parse(RESET) / 1000);
  const text = JSON.stringify(embed);
  withinDiscord(embed.embeds);
  assert.match(embed.description, new RegExp(`⏳ Next reset <t:${resetUnix}:R>`));
  assert.equal((embed.description.match(/<t:/g) || []).length, 1);
  assert.doesNotMatch(JSON.stringify(embed.fields), /<t:/);
  assert.doesNotMatch(text, /\+ \d+ more|\+\d+ more/);
  assert.doesNotMatch(text, /"value":"None"/);
  const raids = fieldText(embed, 'Raid');
  for (const name of ["Crota's End", 'Deep Stone Crypt', 'Ghosts of the Deep', 'Shattered Throne']) {
    assert.match(raids, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const pool = ["King's Fall", 'Vault of Glass', 'Vow of the Disciple', 'Root of Nightmares', "Salvation's Edge", 'Last Wish', 'Garden of Salvation', 'Desert Perpetual', 'Grasp of Avarice', 'Equilibrium'];
  for (const name of pool) {
    const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    assert.doesNotMatch(raids, pattern);
    assert.doesNotMatch(fieldText(embed, 'This Week'), pattern);
  }
  assert.match(fieldText(embed, 'Nightfall'), /The Corrupted/);
  assert.match(fieldText(embed, 'Rewards'), /Weekly Clan Engrams/);
  assert.match(fieldText(embed, 'Rewards'), /Weekly Pinnacle Challenge/);
  assert.doesNotMatch(fieldText(embed, 'Rewards'), /Pinnacle Ops/);
  assert.match(fieldText(embed, 'This Week'), /Crucible Rotator/);
  assert.match(fieldText(embed, 'This Week'), /Vanguard Ops/);
  assert.match(fieldText(embed, 'This Week'), /Pinnacle Ops/);
  assert.doesNotMatch(fieldText(embed, 'This Week'), /King's Fall|The Corrupted|Weekly Clan Engrams/);
  assert.equal(embed.fields.find((field) => /Nightfall|Raid|This Week|Rewards/.test(field.name)).inline, false);
  const empty = renderWeeklyReset({
    milestones: { Response: { 11: { milestoneHash: 11, endDate: RESET }, 12: { milestoneHash: 12, endDate: RESET } } },
    names: new Map([['12', 'Crucible Rotator']]),
    now: NOW
  });
  assert.equal(empty.fields.find((field) => field.name.includes('Nightfall')), undefined);
  assert.equal(empty.fields.find((field) => field.name.includes('Raid')), undefined);
  assert.equal(empty.fields.find((field) => field.name.includes('Rewards')), undefined);
  assert.match(empty.fields.find((field) => field.name.includes('This Week')).value, /Crucible Rotator/);
});

test('milestone activity modes categorize a strike nightfall even when the name does not say nightfall', () => {
  assert.equal(sectionFor("King's Fall"), null);
  assert.equal(sectionFor("King's Fall", { activityModeTypes: [46] }), null);
  assert.equal(sectionFor("King's Fall", { featured: true }), 'raid');
  assert.equal(sectionFor("King's Fall", { activityModeTypes: [46], isFocusedActivity: true }), 'raid');
  assert.equal(sectionFor('Prophecy'), null);
  assert.equal(sectionFor('Prophecy', { rotator: true }), 'raid');
  assert.equal(sectionFor('Equilibrium'), null);
  assert.equal(sectionFor('Equilibrium', { modifiers: ['Weekly Featured'] }), 'raid');
  assert.equal(sectionFor('Pinnacle Ops'), 'week');
  assert.equal(sectionFor('Weekly Pinnacle Challenge'), 'rewards');
  assert.equal(sectionFor('The Corrupted', { activityModeTypes: [46] }), 'nightfall');
  assert.equal(sectionFor('The Corrupted', { modifiers: ['Nightfall'] }), 'nightfall');
  assert.equal(sectionFor('Weekly Clan Engrams'), 'rewards');
  assert.equal(sectionFor('Crucible Rotator'), 'week');
  const query = {
    definition(table, hash) {
      if (table === 'DestinyMilestoneDefinition' && Number(hash) === 5) {
        return {
          displayProperties: { name: 'The Corrupted' },
          friendlyName: 'nightfall',
          quests: { 9: { activities: { 1: { conceptualActivityHash: 77, variants: { 2: { activityHash: 88 } } } } } }
        };
      }
      if (table === 'DestinyActivityDefinition' && Number(hash) === 88) {
        return { directActivityModeType: 46, activityModeTypes: [46] };
      }
      return null;
    }
  };
  const described = describeMilestone(query, { milestoneHash: 5, activities: [{ activityHash: 88 }] });
  assert.equal(described.name, 'The Corrupted');
  assert.equal(described.friendlyName, 'nightfall');
  assert.ok(described.activityModeTypes.includes(46));
  const embed = renderWeeklyReset({
    milestones: {
      Response: {
        5: { milestoneHash: 5, endDate: RESET, activities: [{ activityHash: 88 }] },
        6: { milestoneHash: 6, endDate: RESET }
      }
    },
    names: new Map([['5', described], ['6', { name: "King's Fall", featured: true }]]),
    now: NOW
  });
  assert.match(fieldText(embed, 'Nightfall'), /^The Corrupted$/);
  assert.match(fieldText(embed, 'Raid'), /^King's Fall$/);
  assert.equal(embed.fields.find((field) => field.name.includes('This Week')), undefined);
});

test('weekly reset keeps the featured raid and dungeon rotation and shows a nightfall strike from activity data', () => {
  const query = {
    definition(table, hash) {
      const id = Number(hash);
      if (table === 'DestinyMilestoneDefinition' && id === 1) return { displayProperties: { name: 'Nightfall' }, friendlyName: 'Nightfall' };
      if (table === 'DestinyMilestoneDefinition' && id === 2) return { displayProperties: { name: "Crota's End" }, friendlyName: 'Raid' };
      if (table === 'DestinyMilestoneDefinition' && id === 3) return { displayProperties: { name: 'Ghosts of the Deep' }, friendlyName: 'Dungeon' };
      if (table === 'DestinyMilestoneDefinition' && id === 4) return { displayProperties: { name: "King's Fall" }, friendlyName: 'Raid' };
      if (table === 'DestinyActivityDefinition' && id === 88) return { displayProperties: { name: 'The Corrupted' }, directActivityModeType: 46 };
      if (table === 'DestinyActivityDefinition' && id === 90) return { displayProperties: { name: "Crota's End" }, directActivityModeType: 4, isFocusedActivity: true };
      if (table === 'DestinyActivityDefinition' && id === 91) return { displayProperties: { name: 'Ghosts of the Deep' }, directActivityModeType: 82 };
      if (table === 'DestinyActivityDefinition' && id === 92) return { displayProperties: { name: "King's Fall" }, directActivityModeType: 4, isFocusedActivity: false };
      if (table === 'DestinyActivityModifierDefinition' && id === 501) return { displayProperties: { name: 'Weekly Featured' } };
      if (table === 'DestinyActivityModifierDefinition' && id === 502) return { displayProperties: { name: 'Nightfall' } };
      return null;
    }
  };
  const nightfall = describeMilestone(query, { milestoneHash: 1, activities: [{ activityHash: 88, modifierHashes: [502] }] });
  const crota = describeMilestone(query, { milestoneHash: 2, activities: [{ activityHash: 90 }] });
  const ghosts = describeMilestone(query, { milestoneHash: 3, activities: [{ activityHash: 91, modifierHashes: [501] }] });
  const kings = describeMilestone(query, { milestoneHash: 4, activities: [{ activityHash: 92 }] });
  assert.equal(nightfall.name, 'The Corrupted');
  assert.ok(nightfall.modifiers.includes('Nightfall'));
  assert.ok(nightfall.activityModeTypes.includes(46));
  assert.equal(crota.isFocusedActivity, true);
  assert.ok(ghosts.modifiers.includes('Weekly Featured'));
  assert.equal(kings.featured, false);
  const embed = renderWeeklyReset({
    milestones: {
      Response: {
        1: { milestoneHash: 1, endDate: RESET, activities: [{ activityHash: 88, modifierHashes: [502] }] },
        2: { milestoneHash: 2, endDate: RESET, activities: [{ activityHash: 90 }] },
        3: { milestoneHash: 3, endDate: RESET, activities: [{ activityHash: 91, modifierHashes: [501] }] },
        4: { milestoneHash: 4, endDate: RESET, activities: [{ activityHash: 92 }] },
        5: { milestoneHash: 5, endDate: RESET }
      }
    },
    names: new Map([
      ['1', nightfall],
      ['2', crota],
      ['3', ghosts],
      ['4', kings],
      ['5', { name: 'Vanguard Ops' }]
    ]),
    now: NOW
  });
  assert.match(fieldText(embed, 'Nightfall'), /The Corrupted/);
  assert.match(fieldText(embed, 'Raid'), /Crota's End/);
  assert.match(fieldText(embed, 'Raid'), /Ghosts of the Deep/);
  assert.doesNotMatch(fieldText(embed, 'Raid'), /King's Fall/);
  assert.doesNotMatch(fieldText(embed, 'This Week'), /King's Fall|Crota's End|Ghosts of the Deep|The Corrupted/);
  const hidden = renderWeeklyReset({
    milestones: {
      Response: {
        4: { milestoneHash: 4, endDate: RESET },
        8: { milestoneHash: 8, endDate: RESET },
        5: { milestoneHash: 5, endDate: RESET }
      }
    },
    names: new Map([
      ['4', { name: "King's Fall", friendlyName: 'Raid' }],
      ['8', { name: 'Equilibrium', friendlyName: 'Dungeon' }],
      ['5', { name: 'Vanguard Ops' }]
    ]),
    now: NOW
  });
  assert.equal(hidden.fields.find((field) => field.name.includes('Nightfall')), undefined);
  assert.equal(hidden.fields.find((field) => field.name.includes('Raid')), undefined);
  assert.match(fieldText(hidden, 'This Week'), /Vanguard Ops/);
  assert.doesNotMatch(fieldText(hidden, 'This Week'), /King's Fall|Equilibrium/);
});

test('xur lists every item on its own line, groups armor by class, and hides empty sections', () => {
  const sales = {
    1: { itemHash: 1, costs: [{ itemHash: 50, quantity: 41 }] },
    2: { itemHash: 2, costs: [{ itemHash: 50, quantity: 41 }] },
    3: { itemHash: 3, costs: [{ itemHash: 50, quantity: 41 }] },
    4: { itemHash: 4, costs: [{ itemHash: 50, quantity: 97 }] }
  };
  const embed = renderXur({
    vendors: {
      Response: {
        vendors: { data: { [String(XUR_VENDOR_HASH)]: { vendorHash: XUR_VENDOR_HASH, enabled: true, nextRefreshDate: '2026-10-06T17:00:00Z' } } },
        sales: { data: { [String(XUR_VENDOR_HASH)]: { saleItems: sales } } }
      }
    },
    names: new Map([
      ['1', { name: 'Celestial Nighthawk', itemType: 2, tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: HELMET, classType: 1 }],
      ['2', { name: 'Cuirass of the Falling Star', itemType: 2, tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: HELMET, classType: 0 }],
      ['3', { name: 'Crown of Tempests', itemType: 2, tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: HELMET, classType: 2 }],
      ['4', { name: 'Gjallarhorn', itemType: 3, tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: KINETIC, classType: 3 }],
      ['50', { name: 'Strange Coin', itemType: 1, tierType: 3, bucketTypeHash: 1469714392 }]
    ]),
    now: NOW
  });
  const exotics = fieldText(embed, 'Exotics');
  assert.match(exotics, /\*\*Titan\*\*\nCuirass of the Falling Star — 41 Strange Coin/);
  assert.match(exotics, /\*\*Hunter\*\*\nCelestial Nighthawk — 41 Strange Coin/);
  assert.match(exotics, /\*\*Warlock\*\*\nCrown of Tempests — 41 Strange Coin/);
  assert.match(exotics, /\*\*Weapons\*\*\nGjallarhorn — 97 Strange Coin/);
  assert.equal(embed.fields.find((field) => field.name.includes('Legendaries')), undefined);
  assert.equal(embed.fields.find((field) => field.name.includes('Other')), undefined);
  assert.doesNotMatch(JSON.stringify(embed), /"value":"None"/);
  assert.equal(embed.fields.every((field) => field.inline === false), true);
  assert.doesNotMatch(embed.title, /Nexus Vanguard/);
});

test('a long xur list splits into continuation fields before it hides anything', () => {
  const saleItems = {};
  const names = new Map([['50', { name: 'Strange Coin', itemType: 1, tierType: 3, bucketTypeHash: 1469714392 }]]);
  const expected = [];
  for (let index = 0; index < 24; index += 1) {
    const hash = 1000 + index;
    const name = `Hunter Exotic Helmet With A Very Long Name ${String(index).padStart(2, '0')}`;
    expected.push(`${name} — 41 Strange Coin`);
    saleItems[index] = { itemHash: hash, costs: [{ itemHash: 50, quantity: 41 }] };
    names.set(String(hash), {
      name,
      itemType: 2,
      tierType: 6,
      tierTypeName: 'Exotic',
      bucketTypeHash: HELMET,
      classType: 1
    });
  }
  const embed = renderXur({
    vendors: {
      Response: {
        vendors: { data: { [String(XUR_VENDOR_HASH)]: { vendorHash: XUR_VENDOR_HASH, enabled: true, nextRefreshDate: '2026-10-06T17:00:00Z' } } },
        sales: { data: { [String(XUR_VENDOR_HASH)]: { saleItems } } }
      }
    },
    names,
    now: NOW
  });
  withinDiscord(embed.embeds);
  const shown = fieldText(embed, 'Exotics');
  assert.ok(embed.embeds.flatMap((page) => page.fields).some((field) => field.name.includes('Exotics (cont.)')));
  for (const line of expected) assert.ok(shown.includes(line), line);
  assert.doesNotMatch(shown, /\+\d+ more/);
  assert.equal(embed.fields.find((field) => field.name.includes('Other')), undefined);
});

test('xur drops a bare price, resolves signed currency hashes, and files non-weapons under other gear', () => {
  const UNSIGNED = 3000000000;
  const SIGNED = UNSIGNED - 0x100000000;
  const GHOST = 4023194814;
  const embed = renderXur({
    vendors: {
      Response: {
        vendors: { data: { [String(XUR_VENDOR_HASH)]: { vendorHash: XUR_VENDOR_HASH, enabled: true, nextRefreshDate: '2026-10-06T17:00:00Z' } } },
        sales: {
          data: {
            [String(XUR_VENDOR_HASH)]: {
              saleItems: {
                1: { itemHash: 1, costs: [{ itemHash: SIGNED, quantity: 41 }] },
                2: { itemHash: 2, costs: [{ itemHash: 999, quantity: 41 }] },
                3: { itemHash: 3, costs: [{ itemHash: 50, quantity: 23 }] }
              }
            }
          }
        }
      }
    },
    names: new Map([
      ['1', { name: 'Cuirass of the Falling Star', itemType: 2, tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: HELMET, classType: 0 }],
      ['2', { name: 'Gjallarhorn', itemType: 3, tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: KINETIC, classType: 3 }],
      ['3', { name: 'Sagira Shell', itemType: 24, tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: GHOST, classType: 3 }],
      [String(UNSIGNED), { name: 'Strange Coin', itemType: 1, tierType: 3, bucketTypeHash: 1469714392 }]
    ]),
    now: NOW
  });
  const exotics = fieldText(embed, 'Exotics');
  assert.match(exotics, /Cuirass of the Falling Star — 41 Strange Coin/);
  assert.match(exotics, /Gjallarhorn(?! —)/);
  assert.doesNotMatch(exotics, /Gjallarhorn — 41/);
  assert.match(exotics, /\*\*Other gear\*\*\nSagira Shell/);
  assert.doesNotMatch(exotics, /\*\*Weapons\*\*\nSagira Shell/);
  assert.match(exotics, /\*\*Weapons\*\*\nGjallarhorn/);
});

test('overflow notes skip class headers and continuation fields repeat them', () => {
  const lines = ['**Hunter**'];
  for (let index = 0; index < 70; index += 1) {
    lines.push(`Hunter Exotic Helmet With A Very Long Name ${String(index).padStart(2, '0')} ${'Y'.repeat(60)}`);
  }
  const packed = packSections({
    title: 'Xûr',
    description: 'Xûr is here.',
    sections: [{ name: '🟡 Exotics', lines }]
  });
  withinDiscord(packed.embeds);
  const flat = packed.embeds.flatMap((page) => page.fields);
  const tail = flat[flat.length - 1].value.split('\n').pop();
  assert.match(tail, /^\+\d+ more$/);
  const hidden = Number(tail.slice(1).split(' ')[0]);
  const visibleItems = flat.flatMap((field) => field.value.split('\n')).filter((line) => line.trim() && !/^\+\d+ more$/.test(line) && !/^\*\*[^*]+\*\*$/.test(line));
  const itemLines = lines.filter((line) => !/^\*\*[^*]+\*\*$/.test(line));
  assert.equal(visibleItems.length + hidden, itemLines.length);
  assert.ok(hidden < itemLines.length);
  for (const field of flat) {
    if (/Hunter Exotic/.test(field.value)) assert.match(field.value, /^\*\*Hunter\*\*/);
  }
});

test('field packing stays inside Discord limits and uses +N more only past the message cap', () => {
  const sections = [];
  for (let index = 0; index < 30; index += 1) {
    sections.push({ name: `Section ${index}`, lines: [`Line ${index}`] });
  }
  const split = packSections({ title: 'Weekly Reset', description: 'One list.', sections });
  withinDiscord(split.embeds);
  assert.equal(split.embeds.length, 2);
  assert.equal(split.embeds[0].fields.length, 25);
  assert.equal(split.embeds[1].fields.length, 5);
  assert.match(split.embeds[1].title, /continued/);
  assert.doesNotMatch(JSON.stringify(split), /\+\d+ more/);

  const lines = [];
  for (let index = 0; index < 80; index += 1) lines.push(`Item ${String(index).padStart(3, '0')} ${'X'.repeat(70)}`);
  const packed = packSections({
    title: 'Xûr',
    description: 'Xûr is here.',
    sections: [{ name: 'Exotics', lines }]
  });
  withinDiscord(packed.embeds);
  const flat = packed.embeds.flatMap((page) => page.fields);
  assert.ok(flat.some((field) => field.name === 'Exotics (cont.)'));
  const tail = flat[flat.length - 1].value.split('\n').pop();
  assert.match(tail, /^\+\d+ more$/);
  const hidden = Number(tail.slice(1).split(' ')[0]);
  assert.ok(hidden > 0);
  const visible = flat.flatMap((field) => field.value.split('\n')).filter((line) => !/^\+\d+ more$/.test(line) && line.trim());
  for (const line of visible) assert.ok(lines.includes(line));
  assert.ok(visible.length + hidden <= lines.length);
  assert.ok(visible.length > 10);
});

test('fireteam posts and the board stay full width and keep every name', () => {
  const members = ['111111111111111111', '222222222222222222', '333333333333333333', '444444444444444444'];
  const rendered = renderPost({
    id: 'abcdef123456',
    hostId: members[0],
    activityKey: 'raid',
    activityLabel: "King's Fall",
    slots: 6,
    members,
    when: 'Tonight',
    note: '',
    status: 'open',
    expiresAt: '2026-10-03T02:00:00.000Z'
  }, {});
  assert.ok(rendered.embeds[0].fields.every((field) => field.inline === false));
  assert.match(rendered.embeds[0].fields.find((field) => field.name === 'Activity').value, /King's Fall/);
  const roster = rendered.embeds[0].fields.find((field) => field.name === 'Roster').value;
  for (const id of members) assert.match(roster, new RegExp(`<@${id}>`));
  assert.doesNotMatch(roster, /\+\d+ more/);

  const posts = ['Vault of Glass', "Crota's End", 'Deep Stone Crypt', "King's Fall", 'Last Wish'].map((label, index) => ({
    activityLabel: label,
    activityKey: 'raid',
    members: [members[0]],
    slots: 6,
    expiresAt: '2026-10-03T02:00:00.000Z',
    id: `post${index}`
  }));
  const board = boardEmbed(posts);
  const boardText = JSON.stringify(board);
  assert.equal(board.fields.every((field) => field.inline === false), true);
  for (const label of ["Vault of Glass", "Crota's End", 'Deep Stone Crypt', "King's Fall", 'Last Wish']) {
    assert.match(boardText, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(boardText, /\+\d+ more/);
});

test('a long weekly panel still edits the same message', async () => {
  const sections = [];
  for (let index = 0; index < 28; index += 1) sections.push({ name: `Block ${index}`, lines: [`Row ${index}`] });
  const packed = packSections({ title: '🗓️ Weekly Reset', description: 'Next reset soon.', sections });
  assert.equal(packed.embeds.length, 2);
  const sent = [];
  const list = [];
  const channel = {
    send: async (body) => {
      const created = {
        id: '1516640233389822701',
        author: { id: '111111111111111111', bot: true },
        embeds: body.embeds,
        createdTimestamp: 5,
        edit: async (next) => {
          created.embeds = next.embeds;
          return created;
        },
        delete: async () => {}
      };
      sent.push(body);
      list.push(created);
      return created;
    },
    messages: {
      fetch: async (arg) => (arg && typeof arg === 'object' ? { values: () => list.values() } : list.find((item) => item.id === arg) || null)
    }
  };
  const client = {
    user: { id: '111111111111111111', displayName: 'Nexus Vanguard', displayAvatarURL: () => 'https://cdn.example/avatar.png' },
    channels: { fetch: async () => channel }
  };
  const first = await upsertOwnedPanel(client, {
    channelId: '1516640233389822111',
    panelId: 'weekly-reset',
    embed: packed,
    botId: '111111111111111111'
  });
  assert.equal(first.created, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].embeds.length, 2);
  assert.equal(sent[0].embeds[0].image.url, 'attachment://vanguard-panel-banner.png');
  assert.equal(sent[0].embeds[1].image, undefined);
  assert.match(sent[0].embeds[0].description, /Not affiliated with or endorsed by Bungie/);
  assert.equal(sent[0].embeds[0].footer.text, 'Many Worlds One Nexus • reset');
  assert.doesNotMatch(sent[0].embeds[0].title, /Nexus Vanguard/);
  const second = await upsertOwnedPanel(client, {
    channelId: '1516640233389822111',
    messageId: first.messageId,
    panelId: 'weekly-reset',
    embed: packed,
    botId: '111111111111111111'
  });
  assert.equal(second.created, false);
  assert.equal(second.edited, true);
  assert.equal(sent.length, 1);
});
