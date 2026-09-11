'use strict';

// Nexus Sentinal runtime profile: CORE + ARK
//
// Keep Sentinal deliberately small and reliable. Game-native ARK systems stay
// in place for now, while nonessential Nexus/game modules are no longer loaded
// into the production bot runtime. Retired modules remain in the repository so
// they can be recovered later without making them production dependencies.

const { installGuildMembersIntentExtension } = require('./guild-members-intent-extension.cjs');
const { installCommunityIntentsExtension } = require('./community-intents-extension.cjs');
const { installMentionResponseExtension } = require('./mention-response-extension.cjs');
const { installRoleMenuExtension } = require('./role-menu-extension.cjs');
const { installAdminPairingExtension } = require('./admin-pairing-extension.cjs');
const { installModerationExtension } = require('./moderation-extension.cjs');
const { installSafetyReportExtension } = require('./safety-report-extension.cjs');
const { installPersistentPanelExtension } = require('./persistent-panel-extension.cjs');
const { installNexusStatusExtension } = require('./nexus-status-extension.cjs');
const { installOnboardingAuthorityExtension } = require('./onboarding-authority-extension.cjs');
const { installWelcomeExtension } = require('./welcome-extension.cjs');
const { installAboutExtension } = require('./about-extension.cjs');
const { installRanksExtension } = require('./ranks-extension.cjs');
const { installGameServersExtension } = require('./game-servers-extension.cjs');
const { installStaffWorkspaceExtension } = require('./staff-workspace-extension.cjs');
const { installArnIntakeExtension } = require('./arn-intake-extension.cjs');
const { installNexusEconomyIdentitySyncExtension } = require('./nexus-economy-identity-sync-extension.cjs');
const { installClusterShopUiExtension } = require('./cluster-shop-ui-extension.cjs');

// ARK control, monitoring, identity, economy and cluster integration.
const { installArkOpsExtension } = require('./ark-ops-extension.cjs');
const { installArkUpdateSafetyExtension } = require('./ark-update-safety-extension.cjs');
const { installArkRconDiagnosticExtension } = require('./ark-rcon-diagnostic-extension.cjs');
const { installArkStaffUnifiedOpsPanelExtension } = require('./ark-staff-unified-ops-panel-extension.cjs');
const { installArkConfigDriftAlertExtension } = require('./ark-config-drift-alert-extension.cjs');
const { installArkIdentityHealthExtension } = require('./ark-identity-health-extension.cjs');
const { installArkShopProfileHealthExtension } = require('./arkshop-profile-health-extension.cjs');
const { installArkShopApplyHealthExtension } = require('./arkshop-apply-health-extension.cjs');
const { installNexusBankHealthExtension } = require('./ark-nexus-bank-health-extension.cjs');
const { installArkRestartSchedulerExtension } = require('./ark-restart-scheduler-extension.cjs');
const { installArkServerControlsExtension } = require('./ark-server-controls-extension.cjs');
const { installArkDynamicEventsExtension } = require('./ark-dynamic-events-extension.cjs');
const { installArkConfigDbExtension } = require('./ark-config-db-extension.cjs');
const { installArkClusterExtension } = require('./ark-cluster-extension.cjs');
const { installArkAdditionalRegistryBootstrapExtension } = require('./ark-additional-registry-bootstrap-extension.cjs');
const { installArkClusterMetadataExtension } = require('./ark-cluster-metadata-extension.cjs');
const { installArkConfigProfileExtension } = require('./ark-config-profile-extension.cjs');
const { installArkShopProfileExtension } = require('./arkshop-profile-extension.cjs');
const { installArkClusterPublicActions } = require('./ark-cluster-public-actions.cjs');
const { installArkShopProfileBootstrapExtension } = require('./arkshop-profile-bootstrap-extension.cjs');
const { installArkEconomyPresenceExtension } = require('./ark-economy-presence-extension.cjs');

// Minimal Nexus/Discord core.
installGuildMembersIntentExtension();
installCommunityIntentsExtension();
installMentionResponseExtension();
installRoleMenuExtension();
installAdminPairingExtension();
installModerationExtension();
installSafetyReportExtension();
installPersistentPanelExtension();
installNexusStatusExtension();
installOnboardingAuthorityExtension();
installWelcomeExtension();
installAboutExtension();
installRanksExtension();
installGameServersExtension();
installStaffWorkspaceExtension();
installArnIntakeExtension();
installNexusEconomyIdentitySyncExtension();
installClusterShopUiExtension();
require('./cluster-shop-delivery-worker.cjs').installClusterShopDeliveryWorker();

// ARK stack intentionally preserved during the Sentinal teardown.
installArkOpsExtension();
installArkUpdateSafetyExtension({ prefix: 'ARK_GEN1' });
installArkRconDiagnosticExtension();
installArkStaffUnifiedOpsPanelExtension();
installArkConfigDriftAlertExtension();
installArkIdentityHealthExtension();
installArkShopProfileHealthExtension();
installArkShopApplyHealthExtension();
installNexusBankHealthExtension();
installArkRestartSchedulerExtension({ prefix: 'ARK_GEN1' });
installArkServerControlsExtension({ prefix: 'ARK_GEN1' });
installArkDynamicEventsExtension();
installArkConfigDbExtension();
installArkClusterExtension();
installArkAdditionalRegistryBootstrapExtension();
installArkClusterMetadataExtension();
installArkConfigProfileExtension();
installArkShopProfileExtension();
installArkEconomyPresenceExtension();
require('./arkshop-maintenance-monitor.cjs').installArkShopMaintenanceMonitor();
installArkClusterPublicActions();
installArkShopProfileBootstrapExtension();
require('./ark-cluster-plan-extension.cjs').installArkClusterPlanExtension();
require('./arkshop-nexus-economy-v1-runtime.cjs').installArkShopEconomyV1Runtime();
require('./arkshop-nexus-launch-v2-runtime.cjs').installArkShopLaunchV2Runtime();
require('./arkshop-nexus-launch-v3-kits-runtime.cjs').installArkShopLaunchV3KitsRuntime();
require('./arkshop-nexus-launch-v4-resources-runtime.cjs').installArkShopLaunchV4ResourcesRuntime();
require('./arkshop-nexus-launch-v5-disable-legacy-sell-runtime.cjs').installArkShopLaunchV5DisableLegacySellRuntime();
require('./arkshop-nexus-launch-v6-remove-demo-items-runtime.cjs').installArkShopLaunchV6RemoveDemoItemsRuntime();
require('./arkshop-nexus-launch-v7-basic-sell-runtime.cjs').installArkShopLaunchV7BasicSellRuntime();
require('./arkshop-nexus-launch-v8-boss-sell-runtime.cjs').installArkShopLaunchV8BossSellRuntime();
require('./arkshop-nexus-launch-v9-apex-tribute-sell-runtime.cjs').installArkShopLaunchV9ApexTributeSellRuntime();
require('./arkshop-nexus-launch-v10-native-item-delivery-runtime.cjs').installArkShopLaunchV10NativeItemDeliveryRuntime();
require('./arkshop-nexus-launch-v11-apothecary-runtime.cjs').installArkShopLaunchV11ApothecaryRuntime();
require('./arkshop-nexus-launch-v12-love-craft-fix-runtime.cjs').installArkShopLaunchV12LoveCraftFixRuntime();
require('./arkshop-map2-clone-from-gen1-runtime.cjs').installArkShopMap2CloneRuntime();
require('./natureshop-gen1-export-runtime.cjs').installNatureShopGen1ExportRuntime();
require('./arkshop-nexus-launch-v13-potion-balance-runtime.cjs').installArkShopLaunchV13PotionBalanceRuntime();
require('./arkshop-nexus-launch-v14-shadow-recruit-potion-prices-runtime.cjs').installArkShopLaunchV14PotionPricesRuntime();
require('./arkshop-nexus-launch-v15-rank-timed-points-runtime.cjs').installArkShopLaunchV15RankPointsRuntime();
require('./dinodepot-category-probe-runtime.cjs').installDinoDepotCategoryProbeRuntime();
require('./arkshop-ui-live-deploy-runtime.cjs').installArkShopUiLiveDeployRuntime();
require('./arkshop-cluster-economy-guard.cjs').installArkShopClusterEconomyGuard();
require('./arkshop-backend-preflight-runtime.cjs').installArkShopBackendPreflightRuntime();
require('./ark-dino-cache-sqlite-probe.cjs').installRuntime();
require('./ark-shiny-config-runtime.cjs').installRuntime();
require('./ark-dino-cache-runtime.cjs').installDinoCacheRuntime();
require('./ark-command-routing-patch.cjs');
require('./ark-dynamic-config-http.cjs');
require('./protocol/discord.cjs').installProtocolExtension();

require('./bot.cjs');