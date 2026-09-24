'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ASSET_DIR = path.join(__dirname, 'assets');

// One file per bot. The hub image is a brand asset only: Sentinal's managed
// hubs are separate module consoles, not one embed this change can attach to.
const BANNERS = Object.freeze({
  cephalon: 'cephalon-banner.webp',
  ascended: 'ascended-banner.webp',
  sanctuary: 'sanctuary-banner.webp',
  sentinal: 'sentinal-banner.webp'
});

const PANEL_BOTS = Object.freeze({
  fissures: 'cephalon',
  clanApplications: 'cephalon',
  cephalonWelcome: 'cephalon',
  cephalonEvent: 'cephalon',
  official: 'ascended',
  ascendedWelcome: 'ascended',
  arkCluster: 'ascended',
  sanctuaryRoles: 'sanctuary'
});

function bannerFor(bot) {
  const key = String(bot || '');
  const name = BANNERS[key];
  if (!name) return null;
  return {
    bot: key,
    name,
    path: path.join(ASSET_DIR, name),
    url: `attachment://${name}`
  };
}

function bannerBotForPanel(panel) {
  return PANEL_BOTS[String(panel || '')] || '';
}

function attachBanner(bot, payload = {}) {
  const banner = bannerFor(bot);
  if (!banner || !fs.existsSync(banner.path)) return payload;
  const embeds = Array.isArray(payload.embeds)
    ? payload.embeds.map((embed, index) => (index === 0 ? { ...embed, image: { url: banner.url } } : embed))
    : payload.embeds;
  const files = (Array.isArray(payload.files) ? payload.files : []).filter((file) => file?.name !== banner.name);
  files.push({ attachment: banner.path, name: banner.name });
  // discord.js 14 keeps prior attachments on edit when `attachments` is omitted.
  // An empty array plus `files` replaces them, so an older panel gains this banner.
  return { ...payload, embeds, files, attachments: [] };
}

function cloneDelivery(body) {
  const next = { ...body };
  if (Array.isArray(body?.files)) next.files = body.files.slice();
  if (Array.isArray(body?.attachments)) next.attachments = body.attachments.slice();
  if (Array.isArray(body?.embeds)) next.embeds = body.embeds.map((embed) => ({ ...embed }));
  return next;
}

module.exports = {
  ASSET_DIR,
  BANNERS,
  PANEL_BOTS,
  bannerFor,
  bannerBotForPanel,
  attachBanner,
  cloneDelivery
};
