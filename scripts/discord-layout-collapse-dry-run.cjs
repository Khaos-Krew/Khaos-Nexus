'use strict';

// Read-only list of game subchannels a slim layout would drop.
// This command never deletes channels, never posts, and never changes roles.

const { collapseDryRun, formatCollapseDryRun } = require('../src/sentinel/layout-collapse.cjs');

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return '';
  return String(process.argv[index + 1] || '');
}

function main() {
  const inventoryPath = argument('--inventory');
  const result = collapseDryRun(inventoryPath ? { inventoryPath } : {});
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatCollapseDryRun(result));
}

main();
