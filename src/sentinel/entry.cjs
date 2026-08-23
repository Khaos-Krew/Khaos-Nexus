'use strict';

const { installRoleMenuExtension } = require('./role-menu-extension.cjs');
const { installPokemonGoExtension } = require('./pokemon-go-extension.cjs');

installRoleMenuExtension();
installPokemonGoExtension();
require('./bot.cjs');
