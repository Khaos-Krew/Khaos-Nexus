'use strict';

const { installGuildMembersIntentExtension } = require('./guild-members-intent-extension.cjs');
const { installRoleMenuExtension } = require('./role-menu-extension.cjs');
const { installPokemonGoExtension } = require('./pokemon-go-extension.cjs');
const { installEventFeedExtension } = require('./event-feed-extension.cjs');
const { installAdminPairingExtension } = require('./admin-pairing-extension.cjs');
const { installModerationExtension } = require('./moderation-extension.cjs');
const { installRoadmapPatchNoteExtension } = require('./roadmap-patch-note-extension.cjs');
const { installSafetyReportExtension } = require('./safety-report-extension.cjs');
const { installPersistentPanelExtension } = require('./persistent-panel-extension.cjs');
const { installStaffNameColorPreviewExtension } = require('./staff-name-color-preview-extension.cjs');
const { installNexusStatusExtension } = require('./nexus-status-extension.cjs');
const { installWelcomeExtension } = require('./welcome-extension.cjs');

installGuildMembersIntentExtension();
installRoleMenuExtension();
installPokemonGoExtension();
installEventFeedExtension();
installAdminPairingExtension();
installModerationExtension();
installRoadmapPatchNoteExtension();
installSafetyReportExtension();
installPersistentPanelExtension();
installStaffNameColorPreviewExtension();
installNexusStatusExtension();
installWelcomeExtension();
require('./bot.cjs');
