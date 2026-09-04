'use strict';

// The dedicated ARK ops extension owns /ark. Remove ARK from the generic
// friendly-command router so both handlers cannot race to acknowledge the
// same Discord interaction.
const friendly = require('./friendly-commands.cjs');
const { installArkRconConfigExtension } = require('./ark-rcon-config-extension.cjs');

const originalDefinitions = friendly.commandDefinitions;
const originalIsFriendlyCommand = friendly.isFriendlyCommand;
const originalResolveFriendlyCommand = friendly.resolveFriendlyCommand;

friendly.commandDefinitions = (...args) => originalDefinitions(...args).filter((command) => command?.name !== 'ark');
friendly.isFriendlyCommand = (name, ...args) => String(name || '').toLowerCase() === 'ark' ? false : originalIsFriendlyCommand(name, ...args);
friendly.resolveFriendlyCommand = (interaction, ...args) => String(interaction?.commandName || '').toLowerCase() === 'ark' ? null : originalResolveFriendlyCommand(interaction, ...args);

// Install after all legacy ARK command wrappers are loaded but before bot.cjs
// starts the Discord client. This gives Sentinal one cluster-aware RCON admin
// surface without changing the existing /ark command contract.
installArkRconConfigExtension();

module.exports = friendly;
