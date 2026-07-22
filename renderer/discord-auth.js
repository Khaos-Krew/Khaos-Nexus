'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  let current = null;
  let configSignature = '';

  function titleCase(value) {
    return String(value || 'signed-out').replace(/(^|[-_\s])\w/g, (char) => char.toUpperCase());
  }

  function notify(message) {
    const toast = byId('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 3600);
  }

  async function invoke(channel, payload) {
    try {
      return await window.khaos.invoke(channel, payload);
    } catch (error) {
      notify(error.message || String(error));
      throw error;
    }
  }

  function initials(user) {
    const name = user?.globalName || user?.username || 'Discord';
    return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  }

  function render(next) {
    current = next;
    const config = next?.config?.discord || {};
    const auth = next?.discordAuth || {};
    const signature = JSON.stringify({
      oauthClientId: config.oauthClientId,
      oauthRedirectUri: config.oauthRedirectUri,
      operatorUserIds: config.operatorUserIds
    });

    if (signature !== configSignature) {
      configSignature = signature;
      byId('oauthClientId').value = config.oauthClientId || '';
      byId('oauthRedirectUri').value = config.oauthRedirectUri || 'http://127.0.0.1:43119/callback';
      byId('operatorUserIds').value = Array.isArray(config.operatorUserIds) ? config.operatorUserIds.join(', ') : '';
    }

    const status = auth.status || 'signed-out';
    byId('discordLoginStatus').textContent = titleCase(status);
    byId('discordLoginStatus').className = `severity discord-auth-${status}`;
    byId('discordLoginError').textContent = auth.lastError || '';
    byId('discordLoginError').classList.toggle('hidden', !auth.lastError);

    const signedIn = Boolean(auth.user);
    byId('discordIdentityCard').classList.toggle('hidden', !signedIn);
    byId('discordSignedOutCard').classList.toggle('hidden', signedIn);
    if (signedIn) {
      byId('discordIdentityInitials').textContent = initials(auth.user);
      byId('discordIdentityName').textContent = auth.user.globalName || auth.user.username;
      byId('discordIdentityUsername').textContent = `@${auth.user.username}`;
      byId('discordIdentityId').textContent = auth.user.id;
      byId('discordGuildCount').textContent = String(auth.guildCount || 0);
      byId('discordConfiguredGuild').textContent = auth.configuredGuild?.name || 'Not detected';
      byId('discordAuthorization').textContent = auth.authorized ? 'Authorized operator' : 'Not authorized';
      byId('discordAuthorization').className = `tag ${auth.authorized ? 'good' : 'bad'}`;
      byId('discordAuthorizationReason').textContent = auth.authorizedReason || '';
    }

    byId('discordSignInButton').disabled = !auth.configured || auth.loginInProgress;
    byId('discordSignInButton').textContent = auth.loginInProgress ? 'Waiting for Discord…' : 'Sign in with Discord';
    byId('discordRefreshButton').disabled = !signedIn || auth.loginInProgress;
    byId('discordSignOutButton').disabled = !signedIn;

    const setupParts = [];
    if (!config.oauthClientId) setupParts.push('Add the Discord application client ID.');
    else setupParts.push('Discord application ID configured.');
    setupParts.push(`Redirect: ${config.oauthRedirectUri || 'not configured'}`);
    setupParts.push('Scopes: identify, guilds.');
    byId('discordLoginSetupState').textContent = setupParts.join(' ');
  }

  async function saveLoginSettings(showMessage = true) {
    await invoke('config:save-discord', {
      oauthClientId: byId('oauthClientId').value,
      oauthRedirectUri: byId('oauthRedirectUri').value,
      oauthScopes: ['identify', 'guilds'],
      operatorUserIds: byId('operatorUserIds').value.split(',').map((item) => item.trim()).filter(Boolean)
    });
    const latest = await invoke('app:get-state');
    render(latest);
    if (showMessage) notify('Discord login settings saved.');
    return latest;
  }

  function bind() {
    byId('saveDiscordLoginButton').addEventListener('click', () => saveLoginSettings(true));
    byId('discordSignInButton').addEventListener('click', async () => {
      await saveLoginSettings(false);
      notify('Discord opened in your browser. Complete authorization there.');
      const result = await invoke('discord-auth:login');
      render(await invoke('app:get-state'));
      notify(result.authorized ? `Signed in as ${result.user.globalName || result.user.username}.` : 'Signed in, but this account is not on the operator allowlist.');
    });
    byId('discordRefreshButton').addEventListener('click', async () => {
      const result = await invoke('discord-auth:refresh');
      render(await invoke('app:get-state'));
      notify(`Discord session refreshed for ${result.user.globalName || result.user.username}.`);
    });
    byId('discordSignOutButton').addEventListener('click', async () => {
      await invoke('discord-auth:logout');
      render(await invoke('app:get-state'));
      notify('Signed out of Discord.');
    });
    byId('copyDiscordRedirectButton').addEventListener('click', async () => {
      await saveLoginSettings(false);
      const result = await invoke('discord-auth:copy-redirect');
      notify(`Copied ${result.redirectUri}`);
    });
    byId('openDiscordDeveloperPortalButton').addEventListener('click', () => invoke('discord-auth:open-developer-portal'));
    window.khaos.onState(render);
  }

  async function initializeDiscordAuthUi() {
    bind();
    render(await invoke('app:get-state'));
  }

  initializeDiscordAuthUi().catch((error) => notify(`Discord login UI failed: ${error.message}`));
})();
