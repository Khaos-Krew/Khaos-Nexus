'use strict';

// Read-only review of the approved slim game layout.
// This command never deletes channels, never edits Discord, and never posts.

const fs = require('node:fs');
const path = require('node:path');
const { collapseDryRun, formatCollapseDryRun } = require('../src/sentinel/layout-profile.cjs');

function fail(message) {
  console.error(message);
  process.exitCode = 2;
}

function usage() {
  console.log(`Usage: node scripts/discord-layout-collapse-dry-run.cjs [--inventory file.json]

Prints the COD, DBD, Diablo, Destiny, and Warframe text channels the slim layout
would remove (hub + lfg stay). Division, Pokémon GO, and Palworld are omitted.
Voice lobbies and game roles are omitted.

With --inventory, only channels present in that JSON are marked as existing.
Without it, the layout names are listed so an operator can compare them to Discord.

There is no apply or delete mode.`);
}

function readInventory(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.channels)) return parsed.channels;
  if (Array.isArray(parsed?.guild?.channels)) return parsed.guild.channels;
  throw new Error('Inventory JSON must be a channel array or an object with channels.');
}

function normalize(channel) {
  return {
    id: channel?.id || channel?.channel_id || '',
    name: channel?.name || '',
    type: Number(channel?.type),
    parentId: channel?.parentId || channel?.parent_id || ''
  };
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }
  if (argv.some((arg) => ['--apply', '--delete', '--execute', '--yes'].includes(arg))) {
    fail('This command is dry-run only. It does not delete or edit channels.');
    return;
  }
  const inventoryFlag = argv.indexOf('--inventory');
  let channels = [];
  if (inventoryFlag !== -1) {
    const file = argv[inventoryFlag + 1];
    if (!file) {
      fail('Pass a JSON file after --inventory.');
      return;
    }
    channels = readInventory(path.resolve(file)).map(normalize);
  }
  const report = collapseDryRun(channels, { discord: { slimGameLayout: true } });
  console.log(formatCollapseDryRun(report, { onlyPresent: false }));
  if (!channels.length) {
    console.log('\nNo inventory was supplied, so the names above are layout candidates, not confirmed live channels.');
  }
  const present = report.modules.reduce((sum, module) => sum + module.present.length, 0);
  console.log(`\nPresent matches: ${present}. Deletes performed: 0.`);
}

main(process.argv.slice(2));
