'use strict';

const COMMANDS = Object.freeze({
  PROTOCOL: 'protocol',
  PROTOCOL_SCORE: 'protocolscore',
  DARK_ZONE: 'darkzone'
});

const SUBCOMMANDS = Object.freeze({
  STATUS: 'status',
  LEADERBOARD: 'leaderboard',
  ENLIST: 'enlist',
  WITHDRAW: 'withdraw'
});

function commandDefinitions() {
  return Object.freeze([
    Object.freeze({
      name: COMMANDS.PROTOCOL,
      description: 'View Nexus Protocol network status.',
      dmPermission: false,
      options: [
        Object.freeze({ type: 'subcommand', name: SUBCOMMANDS.STATUS, description: 'View active Protocol network status.' })
      ]
    }),
    Object.freeze({
      name: COMMANDS.PROTOCOL_SCORE,
      description: 'View seasonal Protocol Score rankings.',
      dmPermission: false,
      options: [
        Object.freeze({ type: 'subcommand', name: SUBCOMMANDS.LEADERBOARD, description: 'View the current Protocol Score leaderboard.' })
      ]
    }),
    Object.freeze({
      name: COMMANDS.DARK_ZONE,
      description: 'View or manage your Dark Zone enrollment.',
      dmPermission: false,
      options: [
        Object.freeze({ type: 'subcommand', name: SUBCOMMANDS.STATUS, description: 'View your current Dark Zone state.' }),
        Object.freeze({
          type: 'subcommand',
          name: SUBCOMMANDS.ENLIST,
          description: 'Plan Dark Zone enlistment; confirmation is required before state changes.',
          options: [Object.freeze({
            type: 'string',
            name: 'mode',
            description: 'Choose solo or tribe enlistment.',
            required: true,
            choices: Object.freeze([
              Object.freeze({ name: 'Solo', value: 'solo' }),
              Object.freeze({ name: 'Tribe', value: 'tribe' })
            ])
          })]
        }),
        Object.freeze({ type: 'subcommand', name: SUBCOMMANDS.WITHDRAW, description: 'Plan withdrawal; combat locks and cooldowns still apply.' })
      ]
    })
  ]);
}

function normalizeCommandIntent(input = {}) {
  const command = String(input.command || input.commandName || '').trim().toLowerCase();
  const subcommand = String(input.subcommand || '').trim().toLowerCase();
  const accountId = String(input.accountId || '').trim();
  if (!Object.values(COMMANDS).includes(command)) throw new Error('Unknown Nexus Protocol command');
  if (accountId && !/^[A-Za-z0-9:_-]{1,96}$/.test(accountId)) throw new Error('Invalid account id');

  if (command === COMMANDS.PROTOCOL) {
    if (subcommand && subcommand !== SUBCOMMANDS.STATUS) throw new Error('Invalid protocol subcommand');
    return Object.freeze({ kind: 'read', target: 'protocol_status', accountId: accountId || null });
  }
  if (command === COMMANDS.PROTOCOL_SCORE) {
    if (subcommand && subcommand !== SUBCOMMANDS.LEADERBOARD) throw new Error('Invalid protocolscore subcommand');
    return Object.freeze({ kind: 'read', target: 'leaderboard', accountId: accountId || null });
  }

  if (subcommand === SUBCOMMANDS.STATUS || !subcommand) {
    if (!accountId) throw new Error('Dark Zone status requires a linked account');
    return Object.freeze({ kind: 'read', target: 'dark_zone', accountId });
  }
  if (subcommand === SUBCOMMANDS.ENLIST) {
    if (!accountId) throw new Error('Dark Zone enlistment requires a linked account');
    const mode = String(input.mode || '').trim().toLowerCase();
    if (!['solo', 'tribe'].includes(mode)) throw new Error('Invalid Dark Zone enlistment mode');
    return Object.freeze({ kind: 'mutation-plan', target: 'dark_zone_enlist', accountId, mode, requiresConfirmation: true });
  }
  if (subcommand === SUBCOMMANDS.WITHDRAW) {
    if (!accountId) throw new Error('Dark Zone withdrawal requires a linked account');
    return Object.freeze({ kind: 'mutation-plan', target: 'dark_zone_withdraw', accountId, requiresConfirmation: true });
  }
  throw new Error('Invalid darkzone subcommand');
}

module.exports = { COMMANDS, SUBCOMMANDS, commandDefinitions, normalizeCommandIntent };
