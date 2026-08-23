'use strict';

const { installPokemonGoExtension } = require('./pokemon-go-extension.cjs');
const { installEventFeedExtension } = require('./event-feed-extension.cjs');

installPokemonGoExtension();
installEventFeedExtension();
require('./bot.cjs');
