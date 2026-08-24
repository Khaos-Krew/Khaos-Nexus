'use strict';

const { installRoleMenuExtension } = require('./role-menu-extension.cjs');
const { installPokemonGoExtension } = require('./pokemon-go-extension.cjs');
const { installEventFeedExtension } = require('./event-feed-extension.cjs');
const { installAdminPairingExtension } = require('./admin-pairing-extension.cjs');
const { installModerationExtension } = require('./moderation-extension.cjs');
const { installSafetyReportExtension } = require('./safety-report-extension.cjs');

installRoleMenuExtension();
installPokemonGoExtension();
installEventFeedExtension();
installAdminPairingExtension();
installModerationExtension();
installSafetyReportExtension();
require('./bot.cjs');
