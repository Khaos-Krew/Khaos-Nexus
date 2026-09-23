'use strict';

const { healthSummaryLines } = require('./ascended-rcon-health.cjs');

function wipeChecklist(snapshot = []) {
  const health = healthSummaryLines(snapshot);
  return [
    '**ARK wipe / transfer checklist**',
    '1. Pause the cluster shop for the window. This command does not pause it and does not spend Nexus Points.',
    '2. RCON verify from the Discord override store. Host, port, and password are not shown.',
    ...health.map((line) => `• ${line}`),
    '3. Confirm a current backup before anyone transfers or the servers wipe.',
    '4. Tell the tribe the window in the rate card note if the times changed.',
    '',
    'Wallet, verify, and ranks stay on Nexus Sentinal.'
  ].join('\n').slice(0, 1800);
}

module.exports = { wipeChecklist };
