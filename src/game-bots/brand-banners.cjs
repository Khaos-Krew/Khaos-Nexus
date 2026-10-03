'use strict';

// Thin re-export for one release. New embeds use src/shared/embed-style.cjs.
const {
  LEGACY_ASSET_DIR,
  BANNERS,
  PANEL_BOTS,
  bannerFor,
  bannerBotForPanel,
  attachBanner,
  cloneDelivery
} = require('../shared/embed-style.cjs');

module.exports = {
  ASSET_DIR: LEGACY_ASSET_DIR,
  BANNERS,
  PANEL_BOTS,
  bannerFor,
  bannerBotForPanel,
  attachBanner,
  cloneDelivery
};
