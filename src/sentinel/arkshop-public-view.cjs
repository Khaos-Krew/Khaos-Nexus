'use strict';

function clean(value, max = 160) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function priceLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 'Free / not priced';
  return `${Math.round(number)} pts`;
}

function entryName(id, definition = {}) {
  return clean(definition.DisplayName || definition.Name || definition.Description || id, 80) || clean(id, 80);
}

function entryDescription(definition = {}) {
  const value = clean(definition.Description, 100);
  if (!value) return '';
  const name = clean(definition.DisplayName || definition.Name, 100);
  return value === name ? '' : value;
}

function shopLines(profile, limit = 18) {
  const items = Object.entries(profile?.data?.ShopItems || {});
  if (!items.length) return [];
  return items.slice(0, limit).map(([id, definition]) => {
    const name = entryName(id, definition);
    const description = entryDescription(definition);
    return `• **${name}** — ${priceLabel(definition?.Price)}${description ? `\n  ${description}` : ''}`;
  });
}

function kitLines(profile, limit = 18) {
  const kits = Object.entries(profile?.data?.Kits || {});
  if (!kits.length) return [];
  return kits.slice(0, limit).map(([id, definition]) => {
    const name = entryName(id, definition);
    const description = entryDescription(definition);
    const price = Number(definition?.Price);
    const amount = Number(definition?.DefaultAmount);
    const details = [];
    if (Number.isFinite(price) && price >= 0) details.push(priceLabel(price));
    if (Number.isFinite(amount) && amount > 0) details.push(`${Math.round(amount)} starting use${Math.round(amount) === 1 ? '' : 's'}`);
    if (definition?.OnlyFromSpawn === true) details.push('spawn only');
    return `• **${name}**${details.length ? ` — ${details.join(' • ')}` : ''}${description ? `\n  ${description}` : ''}`;
  });
}

function mapProfile(registryServer, profileStore) {
  const profileId = String(registryServer?.shopProfile || '').trim();
  return profileId ? profileStore?.get?.(profileId) || null : null;
}

function renderPublicShopReply(servers = [], profileStore) {
  const sections = [];
  for (const server of servers.filter((item) => item.enabled !== false && item.shopEnabled !== false)) {
    const profile = mapProfile(server, profileStore);
    const mapName = clean(server.mapName || server.name || server.id, 80);
    if (!profile) {
      sections.push(`**${mapName}**\nShop data is syncing.`);
      continue;
    }
    const lines = shopLines(profile);
    sections.push(`**${mapName}**\n${lines.length ? lines.join('\n') : 'No purchasable shop items are currently listed.'}`);
  }
  if (!sections.length) return '🛒 The ARK shop is not currently available on an enabled map.';
  return `🛒 **ARK Shop**\n\n${sections.join('\n\n')}`.slice(0, 1900);
}

function renderPublicKitsReply(servers = [], profileStore) {
  const sections = [];
  for (const server of servers.filter((item) => item.enabled !== false && item.kitsEnabled !== false)) {
    const profile = mapProfile(server, profileStore);
    const mapName = clean(server.mapName || server.name || server.id, 80);
    if (!profile) {
      sections.push(`**${mapName}**\nKit data is syncing.`);
      continue;
    }
    const lines = kitLines(profile);
    sections.push(`**${mapName}**\n${lines.length ? lines.join('\n') : 'No kits are currently listed.'}`);
  }
  if (!sections.length) return '🎁 ARK kits are not currently available on an enabled map.';
  return `🎁 **ARK Kits**\n\n${sections.join('\n\n')}`.slice(0, 1900);
}

module.exports = {
  clean,
  priceLabel,
  entryName,
  entryDescription,
  shopLines,
  kitLines,
  mapProfile,
  renderPublicShopReply,
  renderPublicKitsReply
};
