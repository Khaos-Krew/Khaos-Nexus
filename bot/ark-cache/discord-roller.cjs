'use strict';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function displaySpecies(reward) {
  return reward.variant === 'Normal' ? reward.speciesName : `${reward.variant}-${reward.speciesName}`;
}

function renderCacheReceipt(purchase, state = {}) {
  const reward = purchase.reward;
  const rolling = state.rolling || null;
  const hidden = '❓';
  const species = rolling && rolling !== 'done' && !state.speciesLocked ? state.preview?.species || '🦖 Rolling…' : displaySpecies(reward);
  const variant = state.speciesLocked || rolling === 'done' ? reward.variant : hidden;
  const level = state.variantLocked || rolling === 'done' ? `Lv ${reward.level}` : hidden;
  const sex = state.levelLocked || rolling === 'done' ? reward.sex : hidden;
  const status = rolling === 'done' ? '📦 Awaiting ARK Login' : '🎰 Cache opening…';

  return [
    '## 🎰 NEXUS DINO CACHE',
    `**${purchase.cacheName}**`,
    '',
    `🦖 **Species:** ${species}`,
    `🧬 **Variant:** ${variant}`,
    `⭐ **Level:** ${level}`,
    `⚥ **Sex:** ${sex}`,
    '',
    `🆔 **Cache:** \`${purchase.cacheId}\``,
    status,
  ].join('\n');
}

function previewSpecies(cache, index) {
  const pool = Array.isArray(cache?.species) ? cache.species : [];
  if (!pool.length) return '🦖 Rolling…';
  const item = pool[index % pool.length];
  return String(item?.name || item?.id || 'Unknown');
}

async function animateCacheReveal(message, purchase, cache, options = {}) {
  if (!message || typeof message.edit !== 'function') throw new Error('A Discord message with edit() is required.');
  const delayMs = Math.max(650, Number(options.delayMs) || 850);
  const frames = Math.max(3, Math.min(8, Number(options.frames) || 4));

  for (let index = 0; index < frames; index += 1) {
    await message.edit(renderCacheReceipt(purchase, {
      rolling: 'species',
      preview: { species: previewSpecies(cache, index) },
    }));
    await sleep(delayMs);
  }

  await message.edit(renderCacheReceipt(purchase, { rolling: 'variant', speciesLocked: true }));
  await sleep(delayMs);
  await message.edit(renderCacheReceipt(purchase, { rolling: 'level', speciesLocked: true, variantLocked: true }));
  await sleep(delayMs);
  await message.edit(renderCacheReceipt(purchase, { rolling: 'sex', speciesLocked: true, variantLocked: true, levelLocked: true }));
  await sleep(delayMs);
  await message.edit(renderCacheReceipt(purchase, { rolling: 'done', speciesLocked: true, variantLocked: true, levelLocked: true }));

  return purchase.reward;
}

function renderDeliveredReceipt(purchase, mapName) {
  return `${renderCacheReceipt(purchase, { rolling: 'done', speciesLocked: true, variantLocked: true, levelLocked: true })}\n✅ **Delivered:** ${String(mapName || 'ARK server')}`;
}

module.exports = {
  displaySpecies,
  renderCacheReceipt,
  animateCacheReveal,
  renderDeliveredReceipt,
};
