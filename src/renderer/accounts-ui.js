'use strict';

(() => {
  const api = window.nexusAdmin;
  const nav = document.querySelector('nav');
  const content = document.getElementById('content');
  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const refresh = document.getElementById('refresh');
  if (!api || !nav || !content) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let active = false;
  let pairing = null;

  const button = document.createElement('button');
  button.textContent = 'Accounts & Access';
  button.dataset.accountsView = 'true';
  nav.insertBefore(button, nav.children[2] || null);

  function roleLabel(role) {
    return role === 'owner' ? 'OWNER' : role === 'co-owner' ? 'CO-OWNER' : String(role || '').toUpperCase();
  }

  async function render() {
    if (!active) return;
    const state = await api.state();
    const accounts = state.accounts?.accounts || [];
    const owner = accounts.find((account) => account.role === 'owner');
    const nextRole = owner ? 'co-owner' : 'owner';
    const oauthClientId = state.settings?.discord?.oauthClientId || '';
    const oauthRedirectUri = state.settings?.discord?.oauthRedirectUri || 'http://127.0.0.1:53117/callback';
    title.textContent = 'Accounts & Access';
    subtitle.textContent = 'Household identity, Discord linking and Nexus authority';
    document.querySelectorAll('nav button').forEach((item) => item.classList.toggle('active', item === button));

    const accountCards = accounts.length ? accounts.map((account) => `
      <article class="card credential">
        <div class="credential-head"><div><h3>${esc(account.displayName)}</h3><p>Discord: ${esc(account.discord?.username || account.discord?.id || 'Linked')}</p></div><span class="badge good">${esc(roleLabel(account.role))}</span></div>
        <dl class="facts"><dt>Discord ID</dt><dd class="mono">${esc(account.discord?.id || '')}</dd><dt>Nexus ID</dt><dd class="mono small-text">${esc(account.id)}</dd></dl>
        ${account.role === 'co-owner' ? `<div class="actions"><button class="danger" data-remove-account="${esc(account.id)}">Remove Co-Owner</button></div>` : ''}
      </article>`).join('') : '<article class="card"><h3>No linked accounts yet</h3><p>Create the Owner account first. Discord becomes the easy login identity while Nexus keeps its own internal account ID.</p></article>';

    content.innerHTML = `
      <div class="grid">
        <article class="card">
          <h3>${owner ? 'Add household Co-Owner' : 'Create Owner account'}</h3>
          <p>${owner ? 'Link another trusted household Discord account with full personal Admin Control Center access.' : 'Link your Discord account as the primary Nexus Owner. No separate Nexus password is required.'}</p>
          <div class="actions">
            <button id="oauthLink" class="primary" ${state.discordOAuthReady ? '' : 'disabled'}>Link Discord in browser</button>
            <button id="codeLink" class="secondary">Create Sentinal link code</button>
          </div>
          ${state.discordOAuthReady ? '<p class="good">Discord OAuth is ready.</p>' : '<p class="warn">Browser linking needs the OAuth Client ID plus the NEXUS_DISCORD_OAUTH_CLIENT_SECRET credential. Pairing codes can still be generated now.</p>'}
          ${pairing ? `<div class="env-hint"><strong>Link code: <code>${esc(pairing.code)}</code></strong><br>Expires ${esc(new Date(pairing.expiresAt).toLocaleTimeString())}. Use this code from the Discord account being linked when the Sentinal link command is enabled.</div>` : ''}
        </article>
        <article class="card">
          <h3>Discord OAuth setup</h3>
          <label class="field"><span>Discord Application / Client ID</span><input id="oauthClientId" value="${esc(oauthClientId)}" placeholder="Discord application ID"></label>
          <label class="field"><span>Loopback redirect URI</span><input id="oauthRedirectUri" value="${esc(oauthRedirectUri)}"></label>
          <p class="field-note">Add this exact redirect URI in the Discord Developer Portal OAuth2 settings. The OAuth client secret stays in OS-protected Credentials storage.</p>
          <div class="actions"><button id="saveOauth" class="primary">Save OAuth settings</button></div>
        </article>
      </div>
      <div class="section-head"><div><h3>Household Accounts</h3><p>Owner and Co-Owner identities are resolved by Discord user ID. Tokens are not kept after browser linking.</p></div><span class="badge">${accounts.length} linked</span></div>
      <div class="credential-list">${accountCards}</div>`;

    document.getElementById('saveOauth').onclick = async () => {
      const next = JSON.parse(JSON.stringify(state.settings || {}));
      next.discord ||= {};
      next.discord.oauthClientId = document.getElementById('oauthClientId').value.trim();
      next.discord.oauthRedirectUri = document.getElementById('oauthRedirectUri').value.trim();
      await api.saveSettings(next);
      await render();
    };
    document.getElementById('codeLink').onclick = async () => {
      try {
        pairing = await api.createAccountLinkCode(nextRole);
        await render();
      } catch (error) {
        pairing = null;
        content.insertAdjacentHTML('afterbegin', `<div class="card"><p class="bad">${esc(error.message || error)}</p></div>`);
      }
    };
    document.getElementById('oauthLink').onclick = async () => {
      try {
        document.getElementById('oauthLink').disabled = true;
        await api.linkDiscordOAuth(nextRole);
        pairing = null;
        await render();
      } catch (error) {
        content.insertAdjacentHTML('afterbegin', `<div class="card"><p class="bad">${esc(error.message || error)}</p></div>`);
      }
    };
    content.querySelectorAll('[data-remove-account]').forEach((element) => {
      element.onclick = async () => {
        if (!confirm('Remove this Co-Owner Nexus account link?')) return;
        await api.removeAccount(element.dataset.removeAccount);
        await render();
      };
    });
  }

  button.onclick = () => {
    const settingsButton = nav.querySelector('[data-view="settings"]');
    if (settingsButton) settingsButton.click();
    active = true;
    render().catch((error) => { content.innerHTML = `<div class="card"><p class="bad">${esc(error.message || error)}</p></div>`; });
  };

  nav.querySelectorAll('button[data-view]').forEach((item) => item.addEventListener('click', () => { active = false; }));
  refresh?.addEventListener('click', () => setTimeout(() => { if (active) render().catch(() => {}); }, 250));
})();
