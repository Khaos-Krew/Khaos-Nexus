'use strict';

(() => {
  let scheduled = false;
  let rendering = false;

  const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);

  async function renderAuthorizationSummary() {
    scheduled = false;
    if (rendering) return;
    const root = document.getElementById('view-dnd');
    const discordGrid = root?.querySelector('.dnd-discord-grid');
    if (!root || !discordGrid || !window.khaos?.invoke) return;

    rendering = true;
    try {
      const payload = await window.khaos.invoke('dnd:get');
      const apps = payload?.registeredApps || [];
      const campaigns = new Map((payload?.state?.campaigns || []).map((campaign) => [campaign.id, campaign]));
      const grants = (payload?.state?.grants || []).filter((grant) => grant.active !== false);
      const signature = JSON.stringify({
        apps: apps.map((app) => [app.id, app.name, app.enabled, app.dndEnabled, app.modules, app.hasToken]),
        grants: grants.map((grant) => [grant.appId, grant.campaignId, grant.guildId, grant.scopes]).sort()
      });

      let panel = root.querySelector('#dndAppAuthorizationSummary');
      if (!panel) {
        panel = document.createElement('article');
        panel.id = 'dndAppAuthorizationSummary';
        panel.className = 'panel';
        discordGrid.insertAdjacentElement('afterend', panel);
      }
      if (panel.dataset.signature === signature) return;
      panel.dataset.signature = signature;

      panel.innerHTML = `
        <div class="panel-heading">
          <div><span class="eyebrow">Discord Apps</span><h3>Campaign and D&amp;D scope authorization</h3></div>
          <span class="tag">${apps.length} registered</span>
        </div>
        <div class="callout">Tokens are never shown here. Each bot lists only its configured campaign, guild, and least-privilege D&amp;D scopes. Disabling D&amp;D removes its command registration for that bot without deleting campaign data.</div>
        <div class="dnd-list">
          ${apps.length ? apps.map((app) => {
            const appGrants = grants.filter((grant) => grant.appId === app.id);
            const dndEnabled = app.dndEnabled !== false && (app.modules || []).includes('dnd-workspace');
            return `<div class="dnd-binding-card">
              <div>
                <strong>${escape(app.name || app.id)}</strong>
                <span>${app.enabled === false ? 'Bot disabled' : 'Bot enabled'} · ${app.hasToken ? 'Protected token present' : 'Token missing'} · ${dndEnabled ? 'D&D enabled' : 'D&D disabled'}</span>
                ${appGrants.length ? appGrants.map((grant) => {
                  const campaign = campaigns.get(grant.campaignId);
                  return `<small><strong>${escape(campaign?.name || grant.campaignId)}</strong> · Guild ${escape(grant.guildId)}<br>${escape((grant.scopes || []).join(', ') || 'No scopes')}</small>`;
                }).join('') : '<small>No campaign grants.</small>'}
              </div>
              <div class="server-actions">
                <button class="button ${dndEnabled ? 'danger' : 'primary'}" data-dnd-toggle-app="${escape(app.id)}" data-dnd-enabled="${dndEnabled ? 'true' : 'false'}">${dndEnabled ? 'Disable D&D' : 'Enable D&D'}</button>
              </div>
            </div>`;
          }).join('') : '<p class="dnd-empty">No registered Discord apps.</p>'}
        </div>`;
    } catch (error) {
      const panel = root?.querySelector('#dndAppAuthorizationSummary');
      if (panel) panel.innerHTML = `<p class="dnd-empty">Authorization summary unavailable: ${escape(error.message || error)}</p>`;
    } finally {
      rendering = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(renderAuthorizationSummary, 80);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', async (event) => {
    const toggle = event.target.closest('[data-dnd-toggle-app]');
    if (toggle) {
      const currentlyEnabled = toggle.dataset.dndEnabled === 'true';
      toggle.disabled = true;
      try {
        await window.khaos.invoke('dnd:app-module-toggle', {
          appId: toggle.dataset.dndToggleApp,
          enabled: !currentlyEnabled
        });
        if (typeof window.toast === 'function') window.toast(`D&D ${currentlyEnabled ? 'disabled' : 'enabled'} for the registered bot.`);
      } finally {
        toggle.disabled = false;
        schedule();
      }
      return;
    }
    if (event.target.closest('[data-dnd-tab="discord"], [data-view="dnd"]')) schedule();
  });
  schedule();
})();
