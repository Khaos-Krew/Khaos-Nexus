'use strict';

const { installPokemonGoExtension } = require('./pokemon-go-extension.cjs');
const { installEventFeedExtension } = require('./event-feed-extension.cjs');
const { installAdminPairingExtension } = require('./admin-pairing-extension.cjs');

installPokemonGoExtension();
installEventFeedExtension();
installAdminPairingExtension();
require('./bot.cjs');