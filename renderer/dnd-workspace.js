'use strict';

(() => {
  const dndUi = { payload: null, selectedCampaignId: '', tab: 'overview', resources: [], loading: false };
  const e = (value) => typeof escapeHtml === 'function' ? escapeHtml(value) : String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const call = async (channel, payload, success = '') => {
    try {
      const result = await window.khaos.invoke(channel, payload);
      if (success && typeof toast === 'function') toast(success);
      return result;
    } catch (error) {
      if (typeof toast === 'function') toast(error.message || String(error));
      throw error;
    }
  };

  function selectedCampaign() {
    return dndUi.payload?.state?.campaigns?.find((item) => item.id === dndUi.selectedCampaignId) || null;
  }

  function campaignItems(collection) {
    return (dndUi.payload?.state?.[collection] || []).filter((item) => item.campaignId === dndUi.selectedCampaignId);
  }

  function mount() {
    if (document.getElementById('view-dnd')) return;
    viewMeta.dnd = ['Dungeons & Dragons', 'Campaigns, Discord bindings, sessions, party status, and game-master tools.'];
    const nav = document.getElementById('navigation');
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.view = 'dnd';
    button.innerHTML = '<span>⚔</span>D&amp;D';
    nav.appendChild(button);

    const section = document.createElement('section');
    section.className = 'view';
    section.id = 'view-dnd';
    section.innerHTML = '<div class="dnd-loading panel">Loading D&amp;D campaign data…</div>';
    document.querySelector('main.content').appendChild(section);
    bind();
    load();
  }

  async function load() {
    dndUi.loading = true;
    try {
      dndUi.payload = await call('dnd:get');
      const campaigns = dndUi.payload.state.campaigns || [];
      if (!campaigns.some((item) => item.id === dndUi.selectedCampaignId)) dndUi.selectedCampaignId = campaigns[0]?.id || '';
      render();
    } finally { dndUi.loading = false; }
  }

  function render() {
    const root = document.getElementById('view-dnd');
    const payload = dndUi.payload;
    if (!payload) return;
    const campaigns = payload.state.campaigns || [];
    const campaign = selectedCampaign();
    root.innerHTML = `
      <div class="section-intro inline dnd-header">
        <div><h2>Dungeons &amp; Dragons</h2><p>Operate multiple campaigns through any registered Discord bot without automatically creating channel collections.</p></div>
        <div class="dnd-campaign-picker">
          <select id="dndCampaignSelect" aria-label="Current campaign">
            <option value="">${campaigns.length ? 'Select campaign' : 'No campaigns yet'}</option>
            ${campaigns.map((item) => `<option value="${e(item.id)}" ${item.id === dndUi.selectedCampaignId ? 'selected' : ''}>${e(item.name)}</option>`).join('')}
          </select>
          <button class="button primary" data-dnd-action="new-campaign">New Campaign</button>
        </div>
      </div>
      <div class="local-banner dnd-policy-banner">
        <div><strong>Default setup: Do not create anything</strong><span>${e(payload.policy.message)}</span></div>
        <span class="tag good">Category creation disabled</span>
      </div>
      ${campaign ? renderCampaign(campaign) : renderNoCampaign()}
    `;
  }

  function renderNoCampaign() {
    return `<article class="panel empty-state"><span class="empty-icon">⚔</span><h3>No D&amp;D campaigns in this installation</h3><p>Create a campaign to begin. No Discord channel, thread, forum post, or category is created as part of campaign creation.</p><button class="button primary" data-dnd-action="new-campaign">Create Campaign</button></article>`;
  }

  function renderCampaign(campaign) {
    const tabs = ['overview', 'members', 'sources', 'discord', 'sessions', 'party'];
    return `
      <div class="dnd-tabs" role="tablist">
        ${tabs.map((tab) => `<button class="dnd-tab ${dndUi.tab === tab ? 'active' : ''}" data-dnd-tab="${tab}">${tab[0].toUpperCase()}${tab.slice(1)}</button>`).join('')}
      </div>
      <div class="dnd-tab-panel">${({
        overview: renderOverview,
        members: renderMembers,
        sources: renderSources,
        discord: renderDiscord,
        sessions: renderSessions,
        party: renderParty
      })[dndUi.tab](campaign)}</div>
    `;
  }

  function renderOverview(campaign) {
    const members = campaignItems('members').filter((item) => item.active !== false);
    const sessions = campaignItems('sessions');
    const active = sessions.find((item) => item.status === 'active');
    const next = sessions.filter((item) => item.status === 'planned').sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))[0];
    return `
      <div class="metric-grid">
        <article class="metric-card"><span>Status</span><strong>${e(campaign.status)}</strong><small>${e(campaign.ruleset)}</small></article>
        <article class="metric-card"><span>Members</span><strong>${members.length}</strong><small>${members.filter((item) => item.role === 'player').length} players</small></article>
        <article class="metric-card"><span>Active session</span><strong>${e(active?.title || 'None')}</strong><small>${active?.startsAt ? e(new Date(active.startsAt).toLocaleString()) : 'No session running'}</small></article>
        <article class="metric-card"><span>Next session</span><strong>${e(next?.title || 'Not scheduled')}</strong><small>${next?.startsAt ? e(new Date(next.startsAt).toLocaleString()) : 'No planned date'}</small></article>
      </div>
      <article class="panel form-panel">
        <div class="panel-heading"><div><span class="eyebrow">Campaign settings</span><h3>${e(campaign.name)}</h3></div><span class="tag">${e(campaign.id)}</span></div>
        <div class="form-grid three">
          <label>Name<input id="dndCampaignName" value="${e(campaign.name)}" maxlength="120"></label>
          <label>Status<select id="dndCampaignStatus">${['planning','active','paused','completed','archived'].map((value) => `<option ${campaign.status === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>
          <label>Ruleset<input id="dndCampaignRuleset" value="${e(campaign.ruleset || '')}" maxlength="80"></label>
        </div>
        <div class="form-grid">
          <label>Current location<input id="dndCampaignLocation" value="${e(campaign.currentLocation || '')}" maxlength="200"></label>
          <label>Active quest ID<input id="dndCampaignQuest" value="${e(campaign.activeQuestId || '')}" maxlength="100"></label>
        </div>
        <label>Description<textarea id="dndCampaignDescription" rows="4" maxlength="2000">${e(campaign.description || '')}</textarea></label>
        <div class="form-actions"><button class="button primary" data-dnd-action="save-campaign">Save Campaign</button></div>
      </article>`;
  }

  function renderMembers() {
    const members = campaignItems('members').filter((item) => item.active !== false);
    return `
      <div class="two-column dnd-two-column">
        <article class="panel">
          <div class="panel-heading"><div><span class="eyebrow">Access</span><h3>Campaign members</h3></div><span class="tag">${members.length}</span></div>
          <div class="dnd-list">${members.length ? members.map((member) => `
            <div class="dnd-list-row"><div><strong>${e(member.displayName || member.discordUserId || member.userId)}</strong><span>${e(member.discordUserId ? `Discord ${member.discordUserId}` : member.userId || 'No linked account')}</span></div><span class="tag">${e(member.role)}</span></div>
          `).join('') : '<p class="dnd-empty">No campaign members.</p>'}</div>
        </article>
        <article class="panel form-panel">
          <span class="eyebrow">Add or update</span><h3>Member role</h3>
          <label>Display name<input id="dndMemberName" maxlength="120"></label>
          <div class="form-grid">
            <label>Discord user ID<input id="dndMemberDiscordId" inputmode="numeric" maxlength="25"></label>
            <label>Role<select id="dndMemberRole">${['dm','assistant_dm','player','viewer','admin'].map((role) => `<option value="${role}">${role}</option>`).join('')}</select></label>
          </div>
          <div class="callout">DM and Assistant DM can manage campaign integration. Platform Admin remains a support role and does not come from Discord role mapping.</div>
          <button class="button primary" data-dnd-action="save-member">Save Member</button>
        </article>
      </div>`;
  }

  function renderSources() {
    const state = dndUi.payload.state;
    const enabled = new Map(campaignItems('campaignSources').map((item) => [item.sourceId, item.enabled]));
    const sources = state.sources || [];
    return `<article class="panel">
      <div class="panel-heading"><div><span class="eyebrow">Permitted content</span><h3>Campaign sources</h3></div></div>
      <div class="callout">A source toggle controls eligible content for this campaign. It does not prove ownership or authorize redistribution of paid rulebook text.</div>
      <div class="settings-list dnd-source-list">${sources.length ? sources.map((source) => `
        <label class="toggle-row"><span><strong>${e(source.name)}</strong><small>${e(source.licenseType || source.description || 'Source metadata')}</small></span><input type="checkbox" data-dnd-source="${e(source.id)}" ${enabled.get(source.id) ? 'checked' : ''}></label>
      `).join('') : '<p class="dnd-empty">No source records exist in the current project database or local campaign store.</p>'}</div>
    </article>`;
  }

  function renderDiscord() {
    const state = dndUi.payload.state;
    const apps = dndUi.payload.registeredApps || [];
    const bindings = campaignItems('bindings').filter((item) => item.active !== false);
    const grants = campaignItems('grants').filter((item) => item.active !== false);
    const appOptions = apps.map((app) => `<option value="${e(app.id)}">${e(app.name)}${app.hasToken ? '' : ' — token missing'}</option>`).join('');
    const resourceOptions = dndUi.resources.map((resource) => `<option value="${e(resource.id)}" data-type="${e(resource.resourceType)}" data-parent="${e(resource.parentId)}">${e(resource.name)} — ${e(resource.resourceType)}</option>`).join('');
    return `
      <div class="dnd-discord-grid">
        <article class="panel form-panel">
          <div class="panel-heading"><div><span class="eyebrow">Registered bot routing</span><h3>Discord campaign setup</h3></div><span class="tag good">Creates 0 by default</span></div>
          <label>Registered bot<select id="dndAppId"><option value="">Select registered bot</option>${appOptions}</select></label>
          <div class="form-grid">
            <label>Guild<select id="dndGuildSynced"><option value="">Use manual guild ID</option>${apps.flatMap((app) => (app.guildIds || []).map((guildId) => `<option value="${e(guildId)}">${e(guildId)} — ${e(app.name)}</option>`)).join('')}</select></label>
            <label>Manual guild ID<input id="dndGuildId" inputmode="numeric" maxlength="25" placeholder="Enable Developer Mode, then Copy Server ID"></label>
          </div>
          <label>Setup mode<select id="dndSetupMode">
            <option value="none" selected>1. Do not create anything</option>
            <option value="existing-channel">2. Assign existing channel</option>
            <option value="existing-thread">3. Assign existing thread</option>
            <option value="existing-forum-post">4. Assign existing forum post</option>
            <option value="create-thread">5. Create one thread</option>
            <option value="create-forum-post">6. Create one forum post</option>
            <option value="full-category" disabled>Full campaign category — planned, unavailable</option>
          </select></label>
          <div class="form-grid">
            <label>Synced Discord resource<select id="dndResourceSelect"><option value="">Use manual Discord ID</option>${resourceOptions}</select></label>
            <label>Manual resource / parent ID<input id="dndResourceId" inputmode="numeric" maxlength="25" placeholder="Copy Channel ID or Thread ID"></label>
          </div>
          <div class="form-grid">
            <label>Display or new thread name<input id="dndBindingName" maxlength="90" placeholder="campaign-table"></label>
            <label>Purpose<select id="dndPurpose">${['main','dm_private','dice_log','character_chat','session_notes','loot','announcements','voice'].map((purpose) => `<option value="${purpose}">${purpose}</option>`).join('')}</select></label>
          </div>
          <label class="toggle-row"><span><strong>Primary main binding</strong><small>Only one active primary main binding is allowed per campaign, bot, and guild.</small></span><input id="dndPrimary" type="checkbox"></label>
          <div class="callout">Khaos Nexus will not automatically generate categories, extra text channels, voice channels, or a campaign server structure. Creating one thread or forum post requires deliberate confirmation.</div>
          <details><summary>Manual Discord ID instructions</summary><p>In Discord, open User Settings → Advanced → enable Developer Mode. Right-click or long-press the server, channel, thread, or forum post and choose Copy ID.</p></details>
          <div class="form-actions">
            <button class="button" data-dnd-action="load-resources">Load Resources</button>
            <button class="button" data-dnd-action="test-resource">Test Bot Access</button>
            <button class="button primary" data-dnd-action="save-binding">Save Integration</button>
          </div>
        </article>
        <article class="panel form-panel">
          <div class="panel-heading"><div><span class="eyebrow">Bot registry</span><h3>Add registered Discord app</h3></div></div>
          <label>Display name<input id="dndNewAppName" maxlength="120" placeholder="Campaign Bot"></label>
          <div class="form-grid">
            <label>Application ID<input id="dndNewApplicationId" inputmode="numeric" maxlength="25"></label>
            <label>Bot user ID<input id="dndNewBotUserId" inputmode="numeric" maxlength="25"></label>
          </div>
          <label>Protected bot token<input id="dndNewBotToken" type="password" autocomplete="off" placeholder="Encrypted locally and never returned to the renderer"></label>
          <div class="form-actions"><button class="button primary" data-dnd-action="save-app">Register Bot</button></div>
          <div class="dnd-list">${apps.map((app) => `<div class="dnd-list-row"><div><strong>${e(app.name)}</strong><span>${e(app.applicationId || app.id)} · ${app.enabled ? 'enabled' : 'disabled'}</span></div><span class="tag ${app.hasToken ? 'good' : ''}">${app.hasToken ? 'Token protected' : 'Token missing'}</span></div>`).join('')}</div>
        </article>
      </div>
      <div class="two-column dnd-two-column">
        <article class="panel">
          <div class="panel-heading"><div><span class="eyebrow">Current routing</span><h3>Bindings and panels</h3></div><span class="tag">${bindings.length}</span></div>
          <div class="dnd-list">${bindings.length ? bindings.map((binding) => {
            const panel = state.panels.find((item) => item.bindingId === binding.id);
            return `<div class="dnd-binding-card"><div><strong>${e(binding.displayName || binding.resourceId)}</strong><span>${e(binding.resourceType)} · ${e(binding.purpose)} · ${e(binding.guildId)}</span><small>${binding.verifiedAt ? `Verified ${e(binding.verifiedAt)}` : 'Not verified'}${binding.lastError ? ` · ${e(binding.lastError)}` : ''}</small></div><div class="server-actions"><button class="button" data-dnd-panel="${e(binding.id)}">Refresh Panel</button><button class="button danger" data-dnd-unbind="${e(binding.id)}">Unbind</button></div>${panel?.messageId ? `<span class="tag good">Panel ${e(panel.messageId)}</span>` : '<span class="tag">No panel</span>'}</div>`;
          }).join('') : '<p class="dnd-empty">No active Discord bindings.</p>'}</div>
        </article>
        <article class="panel form-panel">
          <div class="panel-heading"><div><span class="eyebrow">Authorization</span><h3>Campaign grant and shared context</h3></div></div>
          <label>Bot<select id="dndGrantApp"><option value="">Select bot</option>${appOptions}</select></label>
          <label>Guild ID<input id="dndGrantGuild" inputmode="numeric" maxlength="25"></label>
          <div class="dnd-scope-grid">${['campaign:read','characters:read','characters:update','rolls:create','encounters:manage','sessions:manage','quests:read','panels:manage'].map((scope) => `<label><input type="checkbox" data-dnd-scope="${scope}"> ${e(scope)}</label>`).join('')}</div>
          <button class="button primary" data-dnd-action="save-grant">Save Grant</button>
          <hr>
          <label>Shared channel ID<input id="dndContextChannel" inputmode="numeric" maxlength="25"></label>
          <button class="button" data-dnd-action="save-context">Use This Campaign in Shared Channel</button>
          <div class="dnd-list">${grants.map((grant) => `<div class="dnd-list-row"><div><strong>${e(apps.find((app) => app.id === grant.appId)?.name || grant.appId)}</strong><span>${e(grant.guildId)}</span></div><small>${e(grant.scopes.join(', '))}</small></div>`).join('')}</div>
        </article>
      </div>`;
  }

  function renderSessions() {
    const sessions = campaignItems('sessions').sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
    const attendance = dndUi.payload.state.attendance || [];
    const count = (sessionId, status) => attendance.filter((item) => item.sessionId === sessionId && item.status === status).length;
    return `
      <div class="two-column dnd-two-column">
        <article class="panel">
          <div class="panel-heading"><div><span class="eyebrow">Actual campaign data</span><h3>Sessions</h3></div><span class="tag">${sessions.length}</span></div>
          <div class="dnd-list">${sessions.length ? sessions.map((session) => `
            <div class="dnd-session-card"><div><strong>${e(session.title)}</strong><span>${e(session.status)} · ${session.startsAt ? e(new Date(session.startsAt).toLocaleString()) : 'date not set'}</span><small>Attending ${count(session.id,'attending')} · Maybe ${count(session.id,'maybe')} · Late ${count(session.id,'late')} · Unavailable ${count(session.id,'unavailable')}</small><small>Recap: ${session.recapDraft ? (session.recapApprovedAt ? 'approved' : 'draft awaiting DM approval') : 'not drafted'}</small></div><div class="server-actions">${session.status === 'planned' ? `<button class="button primary" data-dnd-session-start="${e(session.id)}">Start</button>` : ''}${session.status === 'active' ? `<button class="button danger" data-dnd-session-end="${e(session.id)}">End</button>` : ''}</div></div>
          `).join('') : '<p class="dnd-empty">No sessions have been created.</p>'}</div>
        </article>
        <article class="panel form-panel">
          <span class="eyebrow">Schedule</span><h3>Plan a session</h3>
          <label>Title<input id="dndSessionTitle" maxlength="160"></label>
          <div class="form-grid"><label>Start<input id="dndSessionStart" type="datetime-local"></label><label>Time zone<input id="dndSessionTimezone" value="America/Chicago" maxlength="80"></label></div>
          <button class="button primary" data-dnd-action="save-session">Save Planned Session</button>
        </article>
      </div>`;
  }

  function renderParty() {
    const state = dndUi.payload.state;
    const characters = campaignItems('characters');
    const quests = campaignItems('quests');
    const loot = campaignItems('loot');
    return `
      <div class="dnd-party-grid">${characters.length ? characters.map((character) => {
        const quest = quests.find((item) => item.id === character.activeQuestId);
        return `<article class="panel dnd-character-card">${character.portraitUrl ? `<img src="${e(character.portraitUrl)}" alt="">` : '<div class="dnd-portrait-placeholder">⚔</div>'}<div><span class="eyebrow">${e(character.status)}</span><h3>${e(character.name)}</h3><p>Level ${e(character.level)} ${e(character.className || 'Adventurer')}</p><div class="dnd-stats"><span>HP <strong>${e(character.hp)}/${e(character.maxHp)}</strong></span><span>AC <strong>${e(character.armorClass)}</strong></span><span>Exhaustion <strong>${e(character.exhaustion || 0)}</strong></span><span>Inspiration <strong>${character.inspiration ? 'Yes' : 'No'}</strong></span></div><p>Conditions: ${character.conditions?.length ? e(character.conditions.join(', ')) : 'None'}</p><p>Active quest: ${e(quest?.title || quest?.name || 'None')}</p></div></article>`;
      }).join('') : '<article class="panel empty-state"><h3>No characters in this campaign</h3><p>Party data is empty; no placeholder characters are shown.</p></article>'}</div>
      <article class="panel"><div class="panel-heading"><div><span class="eyebrow">Campaign inventory</span><h3>Shared loot</h3></div><span class="tag">${loot.length}</span></div><div class="dnd-list">${loot.length ? loot.map((item) => `<div class="dnd-list-row"><div><strong>${e(item.name || item.title || 'Loot')}</strong><span>${e(item.quantity || 1)} · ${e(item.status || 'available')}</span></div></div>`).join('') : '<p class="dnd-empty">No shared campaign loot has been recorded.</p>'}</div></article>`;
  }

  function value(id) { return document.getElementById(id)?.value || ''; }
  function checked(id) { return Boolean(document.getElementById(id)?.checked); }
  function guildValue(prefix = '') { return value(`${prefix}GuildSynced`) || value(`${prefix}GuildId`) || value('dndGuildSynced') || value('dndGuildId'); }

  async function handleAction(action) {
    const campaign = selectedCampaign();
    if (action !== 'new-campaign' && !campaign) return;
    if (action === 'new-campaign') {
      const name = prompt('Campaign name');
      if (!name) return;
      const result = await call('dnd:campaign-save', { name, status: 'planning', ruleset: '5e_2024' }, 'Campaign created.');
      dndUi.payload = result;
      dndUi.selectedCampaignId = result.state.campaigns.at(-1)?.id || '';
      dndUi.tab = 'overview';
      render();
      return;
    }
    if (action === 'save-campaign') {
      dndUi.payload = await call('dnd:campaign-save', { ...campaign, name: value('dndCampaignName'), status: value('dndCampaignStatus'), ruleset: value('dndCampaignRuleset'), currentLocation: value('dndCampaignLocation'), activeQuestId: value('dndCampaignQuest'), description: value('dndCampaignDescription') }, 'Campaign saved.');
    }
    if (action === 'save-member') dndUi.payload = await call('dnd:member-save', { campaignId: campaign.id, displayName: value('dndMemberName'), discordUserId: value('dndMemberDiscordId'), userId: value('dndMemberDiscordId'), role: value('dndMemberRole'), active: true }, 'Member saved.');
    if (action === 'save-app') {
      const appId = `discord-app-${Date.now()}`;
      let response = await call('dnd:app-save', { id: appId, name: value('dndNewAppName'), applicationId: value('dndNewApplicationId'), botUserId: value('dndNewBotUserId'), enabled: true, modules: ['dnd-workspace'], guildIds: [] });
      dndUi.payload = response;
      if (value('dndNewBotToken')) {
        response = await call('dnd:app-token', { appId, token: value('dndNewBotToken') }, 'Registered bot saved with protected credentials.');
        dndUi.payload = response.state;
      }
    }
    if (action === 'load-resources') {
      const appId = value('dndAppId'); const guildId = guildValue();
      dndUi.resources = await call('dnd:guild-resources', { appId, guildId }, 'Discord resources loaded.');
    }
    if (action === 'test-resource') {
      const selected = document.getElementById('dndResourceSelect')?.selectedOptions?.[0];
      const resourceId = value('dndResourceSelect') || value('dndResourceId');
      const resourceType = selected?.dataset.type || ({ 'existing-channel': 'channel', 'existing-thread': 'thread', 'existing-forum-post': 'forum_post' })[value('dndSetupMode')] || '';
      await call('dnd:test-resource', { appId: value('dndAppId'), guildId: guildValue(), resourceId, resourceType }, 'Bot can view the selected Discord resource.');
    }
    if (action === 'save-binding') {
      const mode = value('dndSetupMode') || 'none';
      const selected = document.getElementById('dndResourceSelect')?.selectedOptions?.[0];
      const creating = ['create-thread','create-forum-post'].includes(mode);
      const confirmed = !creating || confirm(`Create exactly one ${mode === 'create-thread' ? 'thread' : 'forum post'}? Khaos Nexus will not create any category or additional channels.`);
      if (!confirmed) return;
      const result = await call('dnd:setup-save', {
        mode, confirmed, campaignId: campaign.id, appId: value('dndAppId'), guildId: guildValue(),
        resourceId: value('dndResourceSelect') || value('dndResourceId'), parentChannelId: creating ? value('dndResourceId') : (selected?.dataset.parent || ''),
        resourceType: selected?.dataset.type || ({ 'existing-channel': 'channel', 'existing-thread': 'thread', 'existing-forum-post': 'forum_post', 'create-thread': 'thread', 'create-forum-post': 'forum_post' })[mode],
        displayName: value('dndBindingName'), name: value('dndBindingName'), purpose: value('dndPurpose'), primary: checked('dndPrimary')
      }, mode === 'none' ? 'No Discord resources were created.' : 'Campaign integration saved.');
      dndUi.payload = result.state;
    }
    if (action === 'save-grant') {
      const scopes = [...document.querySelectorAll('[data-dnd-scope]:checked')].map((input) => input.dataset.dndScope);
      dndUi.payload = await call('dnd:grant-save', { campaignId: campaign.id, appId: value('dndGrantApp'), guildId: value('dndGrantGuild'), scopes, active: true }, 'Campaign grant saved.');
    }
    if (action === 'save-context') dndUi.payload = await call('dnd:context-save', { campaignId: campaign.id, appId: value('dndGrantApp'), guildId: value('dndGrantGuild'), channelId: value('dndContextChannel'), active: true }, 'Shared-channel campaign selected explicitly.');
    if (action === 'save-session') dndUi.payload = await call('dnd:session-save', { campaignId: campaign.id, title: value('dndSessionTitle'), status: 'planned', startsAt: value('dndSessionStart') ? new Date(value('dndSessionStart')).toISOString() : '', timezone: value('dndSessionTimezone') }, 'Session planned.');
    render();
  }

  function bind() {
    document.addEventListener('change', async (event) => {
      if (event.target.id === 'dndCampaignSelect') { dndUi.selectedCampaignId = event.target.value; dndUi.tab = 'overview'; dndUi.resources = []; render(); }
      if (event.target.matches('[data-dnd-source]')) { dndUi.payload = await call('dnd:source-toggle', { campaignId: dndUi.selectedCampaignId, sourceId: event.target.dataset.dndSource, enabled: event.target.checked }, 'Source setting updated.'); render(); }
      if (event.target.id === 'dndGuildSynced' && event.target.value) document.getElementById('dndGuildId').value = event.target.value;
      if (event.target.id === 'dndResourceSelect' && event.target.value) document.getElementById('dndResourceId').value = event.target.value;
    });
    document.addEventListener('click', async (event) => {
      const nav = event.target.closest('[data-view="dnd"]');
      if (nav) { await load(); return; }
      const tab = event.target.closest('[data-dnd-tab]');
      if (tab) { dndUi.tab = tab.dataset.dndTab; render(); return; }
      const action = event.target.closest('[data-dnd-action]');
      if (action) { await handleAction(action.dataset.dndAction); return; }
      const unbind = event.target.closest('[data-dnd-unbind]');
      if (unbind && confirm('Unbind this Discord resource? The Discord channel or thread will not be deleted.')) { dndUi.payload = await call('dnd:binding-remove', { bindingId: unbind.dataset.dndUnbind }, 'Campaign unbound.'); render(); }
      const panel = event.target.closest('[data-dnd-panel]');
      if (panel) { const result = await call('dnd:panel-refresh', { bindingId: panel.dataset.dndPanel }, 'Campaign panel refreshed.'); dndUi.payload = result.state; render(); }
      const start = event.target.closest('[data-dnd-session-start]');
      if (start) { const resetInitiative = confirm('Start this session. Select OK to also reset active initiative; Cancel starts without resetting initiative.'); dndUi.payload = await call('dnd:session-start', { sessionId: start.dataset.dndSessionStart, resetInitiative }, 'Session started.'); render(); }
      const end = event.target.closest('[data-dnd-session-end]');
      if (end && confirm('End this session and create an unapproved recap draft from Nexus-recorded activity?')) { dndUi.payload = await call('dnd:session-end', { sessionId: end.dataset.dndSessionEnd }, 'Session ended; recap draft requires DM approval.'); render(); }
    });
    if (window.khaos.onDnd) window.khaos.onDnd((payload) => { dndUi.payload = payload; render(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  setInterval(() => {
    if (!dndUi.loading && document.getElementById('view-dnd')?.classList.contains('active')) load().catch(() => {});
  }, 15000);
})();
