'use strict';

const {
  highestRankForEntitlements,
  isPurchasableRank,
  purchasableRanks
} = require('../shared/ranks.cjs');

function normalizeRoleId(value) {
  const id = String(value || '').trim();
  return /^\d{5,25}$/.test(id) ? id : '';
}

function paidRankRoleMap(config = {}) {
  const map = new Map();
  for (const rank of purchasableRanks()) {
    const roleId = normalizeRoleId(config?.discord?.rankRoles?.[rank.id]);
    if (roleId) map.set(rank.id, roleId);
  }
  return map;
}

function planSupporterRankReconciliation({ currentRoleIds = [], entitlements = [], config = {} } = {}) {
  const current = new Set((Array.isArray(currentRoleIds) ? currentRoleIds : []).map(String));
  const paidRoles = paidRankRoleMap(config);
  const selectedRank = highestRankForEntitlements(entitlements, config);

  if (selectedRank && !isPurchasableRank(selectedRank)) {
    return {
      ok: false,
      reason: 'selected-rank-is-not-purchasable',
      selectedRankId: String(selectedRank.id || ''),
      addRoleIds: [],
      removeRoleIds: []
    };
  }

  const targetRoleId = selectedRank ? String(paidRoles.get(selectedRank.id) || '') : '';
  if (selectedRank && !targetRoleId) {
    return {
      ok: false,
      reason: 'missing-rank-role-mapping',
      selectedRankId: selectedRank.id,
      addRoleIds: [],
      removeRoleIds: []
    };
  }

  const allPaidRoleIds = [...new Set([...paidRoles.values()])];
  const removeRoleIds = allPaidRoleIds.filter((roleId) => roleId !== targetRoleId && current.has(roleId));
  const addRoleIds = targetRoleId && !current.has(targetRoleId) ? [targetRoleId] : [];

  return {
    ok: true,
    reason: '',
    selectedRankId: selectedRank?.id || '',
    selectedRankName: selectedRank?.name || '',
    targetRoleId,
    addRoleIds,
    removeRoleIds,
    changed: Boolean(addRoleIds.length || removeRoleIds.length)
  };
}

module.exports = {
  normalizeRoleId,
  paidRankRoleMap,
  planSupporterRankReconciliation
};
