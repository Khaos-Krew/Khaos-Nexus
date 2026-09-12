'use strict';

// Railway live-test preload: installs the existing fail-closed Cluster Shop
// RewardsAscended delivery worker without coupling it to Sentinel startup.
// Actual delivery still requires NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED=true.
require('./cluster-shop-delivery-worker.cjs').installClusterShopDeliveryWorker();
