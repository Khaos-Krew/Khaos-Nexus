'use strict';

// Read-only adapter for the #673 wallet cosmetics spine
// (WalletCosmeticsService via BackendClient.walletCosmetics, GET only).

async function readEquippedCosmetics(backend, userId) {
  if (typeof backend?.walletCosmetics !== 'function') {
    throw new Error('cosmetics-unavailable');
  }
  const response = await backend.walletCosmetics(String(userId));
  const profile = response?.profile;
  if (!response || response.ok === false || !profile) throw new Error('cosmetics-unavailable');
  const themeColor = Number.isInteger(profile.color)
    ? profile.color
    : (Number.isInteger(profile.equippedTheme?.color) ? profile.equippedTheme.color : null);
  return {
    title: profile.equippedTitle?.label || null,
    themeLabel: profile.equippedTheme?.label || null,
    color: themeColor
  };
}

module.exports = { readEquippedCosmetics };
