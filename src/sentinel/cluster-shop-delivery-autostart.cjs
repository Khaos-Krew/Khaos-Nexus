'use strict';

// Railway production preload: installs the existing fail-closed Cluster Shop
// RewardsAscended delivery worker without coupling it to Sentinel startup.
// Actual delivery still requires NEXUS_CLUSTER_SHOP_DELIVERY_ENABLED=true.
// Keep this bootstrap in a watched src/** path so fulfillment changes deploy with Sentinel.
require('./cluster-shop-delivery-worker.cjs').installClusterShopDeliveryWorker();
