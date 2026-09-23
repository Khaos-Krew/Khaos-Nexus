'use strict';

// ARK / ASA slash-command runtime. Nexus Ascended loads this. Nexus Sentinal does not.
// RCON connection settings come from the Discord /arkrcon override store when
// NEXUS_RCON_RAILWAY_ENV_FORBIDDEN or NEXUS_RCON_SOURCE=discord_override_store is set.

const { installArkOpsExtension } = require('./ark-ops-extension.cjs');
const { installArkUpdateSafetyExtension } = require('./ark-update-safety-extension.cjs');
const { installArkServerControlsExtension } = require('./ark-server-controls-extension.cjs');
const { installArkDynamicEventsExtension } = require('./ark-dynamic-events-extension.cjs');
const { installArkConfigDbExtension } = require('./ark-config-db-extension.cjs');
const { installArkClusterExtension } = require('./ark-cluster-extension.cjs');
const { installArkConfigProfileExtension } = require('./ark-config-profile-extension.cjs');
const { installArkShopProfileExtension } = require('./arkshop-profile-extension.cjs');

function installAscendedArkRuntime() {
  installArkOpsExtension();
  installArkUpdateSafetyExtension({ prefix: 'ARK_GEN1' });
  installArkServerControlsExtension({ prefix: 'ARK_GEN1' });
  installArkDynamicEventsExtension();
  installArkConfigDbExtension();
  installArkClusterExtension();
  installArkConfigProfileExtension();
  installArkShopProfileExtension();
  require('./ark-dino-cache-runtime.cjs').installDinoCacheRuntime();
  require('./ark-command-routing-patch.cjs');
}

module.exports = { installAscendedArkRuntime };
