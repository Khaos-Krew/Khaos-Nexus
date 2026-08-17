'use strict';

(() => {
  const CARD_ID = 'dndDiscordStoreRanks';

  const e = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  const call = async (channel, payload) => window.khaos.invoke(channel, payload);

  function rankLines(policy) {
    return (policy.ranks || []).map((rank) => [
      rank.id,
      rank.name,
      Number(rank.priority) || 0,
      (rank.skuIds || []).join(',')
    ].join(' | ')).join('\n');
  }

  function featureLines(policy) {
    return Object.entries(policy.featureRanks || {})
      .map(([feature, rank]) => `${feature} = ${rank}`)
      .join('\n');
  }

  function parseRanks(value) {
    return String(value || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line, index) => {
        const [id = '', name = '', priority = '', skuText = ''] = line.split('|').map((part) => part.trim());
        return {
          id,
          name: name || id,
          priority: priority === '' ? index : Number(priority),
          skuIds: skuText.split(',').map((item) => item.trim()).filter(Boolean)
        };
      })
      .filter((rank) => rank.id);
  }

  function parseFeatures(value) {
    const result = {};
    for (const raw of String(value || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const split = line.indexOf('=');
      if (split < 1) continue;
      const feature = line.slice(0, split).trim();
      const rank = line.slice(split + 1).trim();
      if (feature && rank) result[feature] = rank;
    }
    return result;
  }

  function renderCard(policy) {
    const card = document.createElement('article');
    card.id = CARD_ID;
    card.className = 'panel form-panel dnd-monetization-card';
    card.innerHTML = `
      <div class="panel-heading">
        <div><span class="eyebrow">Discord monetization</span><h3>Discord Store ranks &amp; feature locks</h3></div>
        <span class="tag ${policy.enabled ? 'good' : ''}" id="dndMonetizationStatus">${policy.enabled ? 'ACTIVE' : 'TEST / OFF'}</span>
      </div>
      <p class="dnd-monetization-copy">Use Discord Premium App SKU entitlements for ranks and feature access. Leave this disabled while setting up or testing the bot.</p>
      <label class="toggle-row">
        <span><strong>Enforce Discord Store ranks</strong><small>Owner access always bypasses rank gates.</small></span>
        <input id="dndMonetizationEnabled" type="checkbox" ${policy.enabled ? 'checked' : ''}>
      </label>
      <div class="form-grid">
        <label>Default rank ID<input id="dndMonetizationDefaultRank" maxlength="64" value="${e(policy.defaultRank || 'member')}"></label>
        <label>Store setup<small>Discord Developer Portal → Monetization → Manage SKUs. Copy each SKU ID into a rank below.</small></label>
      </div>
      <label>Ranks <small>One per line: <code>id | Display Name | priority | skuId,skuId</code></small>
        <textarea id="dndMonetizationRanks" rows="6" spellcheck="false">${e(rankLines(policy))}</textarea>
      </label>
      <label>Feature gates <small>One per line: <code>dnd.roll = supporter</code>. Omitted features remain available.</small>
        <textarea id="dndMonetizationFeatures" rows="6" spellcheck="false">${e(featureLines(policy))}</textarea>
      </label>
      <div class="dnd-monetization-presets">
        <button class="button" type="button" data-dnd-store-preset="basic">Add D&amp;D feature list</button>
        <span>Available keys: dnd.campaign, dnd.character, dnd.roll, dnd.initiative, dnd.session, dnd.quest</span>
      </div>
      <div class="form-actions">
        <button class="button" type="button" data-dnd-store-action="reload">Reload</button>
        <button class="button primary" type="button" data-dnd-store-action="save">Save Discord Store Policy</button>
      </div>
    `;
    return card;
  }

  async function loadPolicy() {
    return call('dnd:monetization-get');
  }

  async function mountOrRefresh() {
    const root = document.getElementById('view-dnd');
    if (!root || root.querySelector('.dnd-loading')) return false;
    if (document.getElementById(CARD_ID)) return true;
    try {
      const policy = await loadPolicy();
      root.appendChild(renderCard(policy));
      return true;
    } catch {
      return false;
    }
  }

  async function reload() {
    document.getElementById(CARD_ID)?.remove();
    await mountOrRefresh();
  }

  async function save() {
    const enabled = Boolean(document.getElementById('dndMonetizationEnabled')?.checked);
    const defaultRank = document.getElementById('dndMonetizationDefaultRank')?.value || 'member';
    const ranks = parseRanks(document.getElementById('dndMonetizationRanks')?.value);
    const featureRanks = parseFeatures(document.getElementById('dndMonetizationFeatures')?.value);
    const policy = await call('dnd:monetization-set', { enabled, defaultRank, ranks, featureRanks });
    if (typeof toast === 'function') toast('Discord Store rank policy saved.');
    document.getElementById(CARD_ID)?.remove();
    const root = document.getElementById('view-dnd');
    if (root) root.appendChild(renderCard(policy));
  }

  document.addEventListener('click', (event) => {
    const action = event.target?.closest?.('[data-dnd-store-action]')?.dataset?.dndStoreAction;
    if (action === 'reload') reload().catch((error) => typeof toast === 'function' && toast(error.message || String(error)));
    if (action === 'save') save().catch((error) => typeof toast === 'function' && toast(error.message || String(error)));

    const preset = event.target?.closest?.('[data-dnd-store-preset]')?.dataset?.dndStorePreset;
    if (preset === 'basic') {
      const target = document.getElementById('dndMonetizationFeatures');
      if (target && !target.value.trim()) {
        target.value = [
          '# Assign the rank IDs you create above only to features you want locked.',
          '# dnd.campaign = rank-id',
          '# dnd.character = rank-id',
          '# dnd.roll = rank-id',
          '# dnd.initiative = rank-id',
          '# dnd.session = rank-id',
          '# dnd.quest = rank-id'
        ].join('\n');
      }
    }
  });

  const observer = new MutationObserver(() => { mountOrRefresh(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  mountOrRefresh();
})();
