'use strict';

const NOT_CONFIGURED = 'Nexus Craft is not configured. Set NEXUS_CRAFT_DISCORD_CATEGORY_ID.';
const OUTSIDE = 'Use Nexus Craft in its Discord category.';

function readCraftCategory(env = process.env) {
  const raw = env.NEXUS_CRAFT_DISCORD_CATEGORY_ID;
  if (raw === undefined || String(raw).trim() === '') return { id: '', code: 'unset' };
  const id = String(raw).trim();
  if (!/^\d{17,20}$/.test(id)) return { id: '', code: 'invalid' };
  return { id, code: 'set' };
}

function decideCategory(env, channelCategoryId) {
  const config = readCraftCategory(env);
  if (!config.id) return { allow: false, code: config.code, message: NOT_CONFIGURED };
  if (String(channelCategoryId || '') !== config.id) return { allow: false, code: 'outside', message: OUTSIDE };
  return { allow: true, code: 'allow', message: '' };
}

function realmDecisionAllowed({ actorId, listingOwnerId, staff = false } = {}) {
  const actor = String(actorId || '');
  const owner = String(listingOwnerId || '');
  if (!/^\d{17,20}$/.test(actor) || !/^\d{17,20}$/.test(owner)) return false;
  if (actor === owner) return true;
  return staff === true;
}

function craftIsStaff(interaction, config = {}) {
  const { isStaff } = require('../game-bots/ops-spine.cjs');
  return isStaff(interaction, config);
}

module.exports = {
  NOT_CONFIGURED,
  OUTSIDE,
  readCraftCategory,
  decideCategory,
  realmDecisionAllowed,
  craftIsStaff
};
