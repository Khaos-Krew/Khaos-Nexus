'use strict';

const { installRoleMenuExtension } = require('./role-menu-extension.cjs');
const { installPokemonGoExtension } = require('./pokemon-go-extension.cjs');
const { installEventFeedExtension } = require('./event-feed-extension.cjs');

installRoleMenuExtension();
installPokemonGoExtension();
installEventFeedExtension();
require('./bot.cjs');
