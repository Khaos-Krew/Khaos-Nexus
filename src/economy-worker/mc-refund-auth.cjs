'use strict';

const { isCoinShopAdmin } = require('./coin-shop-staff.cjs');

function refundStaffIds(env = process.env) {
  return String(env.NEXUS_MC_REFUND_STAFF_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{5,32}$/.test(value));
}

// Same staff check as the Coin shop: the configured Owner role id, the guild
// owner, or a staff-admin role that is not also a mod role. A role merely
// named Owner does not pass, and the Administrator bit alone does not pass.
// A non-empty NEXUS_MC_REFUND_STAFF_IDS list only narrows that check.
function mcRefundActorAllowed(interaction, env = process.env) {
  const userId = String(interaction?.user?.id || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return false;
  const listed = refundStaffIds(env);
  if (listed.length > 0 && !listed.includes(userId)) return false;
  return isCoinShopAdmin(interaction, env);
}

// The worker does not call Discord. List membership is not authorization.
// Sentinal checks the admin gate and then sets staffAuthorized on the refund.
function authorizeMcRefundActor({ actor, env = process.env } = {}) {
  const userId = String(actor || '').trim();
  if (!/^\d{5,32}$/.test(userId)) return { ok: false, reason: 'staff-not-authorized' };
  const listed = refundStaffIds(env);
  if (listed.length > 0 && !listed.includes(userId)) return { ok: false, reason: 'staff-not-authorized' };
  return { ok: false, reason: 'staff-not-authorized', actor: userId };
}

module.exports = {
  refundStaffIds,
  mcRefundActorAllowed,
  authorizeMcRefundActor
};
