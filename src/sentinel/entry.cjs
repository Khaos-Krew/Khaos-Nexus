'use strict';

const { installRoleMenuExtension } = require('./role-menu-extension.cjs');
const { installPokemonGoExtension } = require('./pokemon-go-extension.cjs');
const { installEventFeedExtension } = require('./event-feed-extension.cjs');
const { installAdminPairingExtension } = require('./admin-pairing-extension.cjs');

installRoleMenuExtension();
installPokemonGoExtension();
installEventFeedExtension();
installAdminPairingExtension();
require('./bot.cjs');
