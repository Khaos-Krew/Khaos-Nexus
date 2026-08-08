'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  let currentState = null;
  let currentUpdate = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function titleCase(value) {
    return String(value || '').replace(/(^|[-_\s])\w/g, (char) => char.toUpperCase());
  }

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || 'Done.');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  async function invoke(channel, payload) {
    try {
      return await window.khaos.invoke(channel, payload);
    } catch (error) {
      notify(error.message || String(error));
      throw error;
    }
  }

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let amount = bytes;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit += 1;
    }
    return `${amount >= 100 || unit === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unit]}`;
  }

  function relativeTime(value) {
    if (!value) return 'Never';
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return 'Unknown';
    const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
    if (seconds < 10) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(value).toLocaleString();
  }

  function ensureBranding() {
    document.body.classList.add('nexus-v8');
    const brandImage = document.querySelector('.brand img');
    if (brandImage) {
      brandImage.src = '../assets/icon.png';
      brandImage.alt = 'Khaos Nexus wolf and dragon crest';
    }
    const subtitle = document.querySelector('.brand div span');
    if (subtitle) subtitle.textContent = 'Autonomous Command Network';
  }

  function ensureUpdateBanner() {
    if ($('nexusUpdateBanner')) return;
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;
    const banner = document.createElement('section');
    banner.id = 'nexusUpdateBanner';
    banner.className = 'nexus-update-banner hidden';
    banner.innerHTML = `
      <div class="nexus-update-glyph" id="nexusUpdateGlyph">↻</div>
      <div class="nexus-update-copy"><span id="nexusUpdateKicker">Application Update</span><strong id="nexusUpdateHeadline">Checking release channel</strong><small id="nexusUpdateDetail">Khaos Nexus will report when a published version is ready.</small></div>
      <div class="nexus-update-actions" id="nexusUpdateBannerActions"></div>`;
    topbar.insertAdjacentElement('afterend', banner);
  }

  function ensureCommandDeck() {
    if ($('nexusCommandDeck')) return;
    const dashboard = $('view-dashboard');
    if (!dashboard) return;
    const deck = document.createElement('section');
    deck.id = 'nexusCommandDeck';
    deck.className = 'nexus-command-deck';
    deck.innerHTML = `
      <div class="nexus-deck-brand"><img src="../assets/icon.png" alt=""><div><strong>Nexus Operations Deck</strong><span>Where chaos meets control.</span></div></div>
      <div class="nexus-deck-cell" id="nexusDeckBot"><span>Discord Runtime</span><strong>Loading</strong><small>Supervised process</small></div>
      <div class="nexus-deck-cell" id="nexusDeckServers"><span>Game Network</span><strong>Loading</strong><small>Configured targets</small></div>
      <div class="nexus-deck-cell" id="nexusDeckAccess"><span>Operator Access</span><strong>Loading</strong><small>Desktop authorization</small></div>
      <div class="nexus-deck-cell" id="nexusDeckUpdate"><span>Release Channel</span><strong>Loading</strong><small>Stable updates</small></div>`;
    const localBanner = dashboard.querySelector('.local-banner');
    if (localBanner) localBanner.insertAdjacentElement('afterend', deck);
    else dashboard.insertAdjacentElement('afterbegin', deck);
  }

  function ensureUpdateCenter() {
    if ($('nexusUpdateCenter')) return;
    const settings = $('view-settings');
    const settingsList = settings?.querySelector('.settings-list');
    if (!settings || !settingsList) return;

    const center = document.createElement('article');
    center.id = 'nexusUpdateCenter';
    center.className = 'panel nexus-update-center';
    center.innerHTML = `
      <div class="panel-heading">
        <div><span class="eyebrow">Stable Release Channel</span><h3>In-App Update Center</h3><p>Check, download, verify, install, and restart without leaving Khaos Nexus.</p></div>
        <span class="severity" id="nexusUpdateBadge">Idle</span>
      </div>
      <div class="nexus-update-grid">
        <div class="nexus-update-stat"><span>Installed</span><strong id="nexusInstalledVersion">—</strong><small>Current application</small></div>
        <div class="nexus-update-stat"><span>Latest</span><strong id="nexusLatestVersion">—</strong><small>Published stable release</small></div>
        <div class="nexus-update-stat"><span>Update mode</span><strong id="nexusUpdateMode">—</strong><small id="nexusUpdateModeDetail">Detecting package type</small></div>
        <div class="nexus-update-stat"><span>Last checked</span><strong id="nexusLastUpdateCheck">Never</strong><small>Automatic checks every 6 hours</small></div>
      </div>
      <div class="nexus-progress-track"><div class="nexus-progress-bar" id="nexusUpdateProgress"></div></div>
      <div class="form-actions">
        <button class="button" id="nexusUpdateCheck">Check Now</button>
        <button class="button primary hidden" id="nexusUpdateDownload">Download Update</button>
        <button class="button primary hidden" id="nexusUpdateInstall">Install & Restart</button>
        <button class="button hidden" id="nexusUpdateRelease">View Release</button>
      </div>
      <pre class="nexus-release-notes" id="nexusReleaseNotes">No release notes loaded. Check for updates to refresh the stable channel.</pre>`;
    settings.insertBefore(center, settingsList);

    for (const id of ['checkUpdatesButton', 'downloadUpdateButton', 'installUpdateButton', 'updateStatus']) {
      $(id)?.classList.add('legacy-update-ui-hidden');
    }
  }

  function ensureUi() {
    ensureBranding();
    ensureUpdateBanner();
    ensureCommandDeck();
    ensureUpdateCenter();
  }

  function setDeckCell(id, value, detail, tone = '') {
    const cell = $(id);
    if (!cell) return;
    cell.className = `nexus-deck-cell ${tone}`.trim();
    const strong = cell.querySelector('strong');
    const small = cell.querySelector('small');
    if (strong) strong.textContent = value;
    if (small) small.textContent = detail;
  }

  function renderCommandDeck(state) {
    const bot = state?.bot || {};
    const botStatus = bot.status || 'stopped';
    const botTone = botStatus === 'online' ? 'good' : ['error', 'crashed'].includes(botStatus) ? 'bad' : ['starting', 'connecting', 'restarting'].includes(botStatus) ? 'warn' : '';
    setDeckCell('nexusDeckBot', titleCase(botStatus), bot.ready?.username || 'Discord bot process', botTone);

    const servers = Array.isArray(state?.config?.servers) ? state.config.servers : [];
    const enabled = servers.filter((server) => server.enabled !== false);
    const health = Object.values(state?.autonomy?.serverHealth || {});
    const offline = health.filter((entry) => entry.status === 'offline').length;
    const palworld = enabled.filter((server) => String(server.game).toLowerCase() === 'palworld').length;
    setDeckCell('nexusDeckServers', offline ? `${offline} Need Attention` : `${enabled.length} Ready`, `${palworld} Palworld • ${enabled.length} enabled`, offline ? 'bad' : enabled.length ? 'good' : '');

    const access = state?.autonomy?.access || {};
    const role = access.role || 'local-admin';
    const roleTone = role === 'locked' ? 'bad' : role === 'viewer' ? 'warn' : 'good';
    setDeckCell('nexusDeckAccess', titleCase(role), access.enabled ? 'Access enforcement active' : 'Local administration mode', roleTone);

    const update = currentUpdate || state?.update || {};
    const updateStatus = update.status || 'idle';
    const updateTone = ['available', 'downloaded'].includes(updateStatus) ? 'good' : updateStatus === 'error' ? 'bad' : ['checking', 'downloading', 'installing'].includes(updateStatus) ? 'warn' : '';
    const updateValue = updateStatus === 'available' ? `v${update.version} Ready`
      : updateStatus === 'downloaded' ? 'Restart Ready'
        : updateStatus === 'current' ? 'Up to Date'
          : titleCase(updateStatus);
    setDeckCell('nexusDeckUpdate', updateValue, update.mode === 'portable' ? 'Portable self-update' : 'Installed release channel', updateTone);
  }

  function updateModeLabel(mode) {
    if (mode === 'portable') return ['Portable', 'Verified self-replacement'];
    if (mode === 'installed') return ['Installed', 'NSIS one-click update'];
    return ['Development', 'Update install disabled'];
  }

  function updateCopy(update) {
    const status = update.status || 'idle';
    if (status === 'checking') return ['Checking GitHub Releases', 'Looking for the latest published stable build.'];
    if (status === 'available') return [`Khaos Nexus v${update.version} is available`, 'Download the verified update without leaving the application.'];
    if (status === 'downloading') return [`Downloading v${update.version || ''}`.trim(), `${update.progress ?? 0}% complete • ${formatBytes(update.transferred)} of ${formatBytes(update.total)}`];
    if (status === 'downloaded') return [`Khaos Nexus v${update.version} is ready`, update.verified ? 'Download verified. Install and restart when ready.' : 'Download complete. Install and restart when ready.'];
    if (status === 'installing') return ['Installing the update', 'Khaos Nexus will close and reopen automatically.'];
    if (status === 'current') return ['Khaos Nexus is up to date', `Version ${update.currentVersion || update.version || 'current'} is the latest stable release.`];
    if (status === 'error') return ['Update check needs attention', update.error || 'The update service returned an error.'];
    if (status === 'development') return ['Development mode', 'Packaged applications can use the in-app update channel.'];
    return ['Stable update channel ready', 'Check GitHub Releases now or leave automatic checks enabled.'];
  }

  function actionButton(label, action, primary = false) {
    return `<button class="button ${primary ? 'primary' : ''}" data-nexus-update-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`;
  }

  function renderUpdate(update = {}) {
    currentUpdate = { ...update };
    const status = update.status || 'idle';
    const [headline, detail] = updateCopy(update);
    const percentage = Number.isFinite(Number(update.progress)) ? Math.max(0, Math.min(100, Number(update.progress))) : 0;
    const [modeLabel, modeDetail] = updateModeLabel(update.mode);

    if ($('nexusInstalledVersion')) $('nexusInstalledVersion').textContent = `v${update.currentVersion || currentState?.app?.version || '—'}`;
    if ($('nexusLatestVersion')) $('nexusLatestVersion').textContent = update.version ? `v${update.version}` : 'Not checked';
    if ($('nexusUpdateMode')) $('nexusUpdateMode').textContent = modeLabel;
    if ($('nexusUpdateModeDetail')) $('nexusUpdateModeDetail').textContent = modeDetail;
    if ($('nexusLastUpdateCheck')) $('nexusLastUpdateCheck').textContent = relativeTime(update.lastCheckedAt);
    if ($('nexusUpdateProgress')) $('nexusUpdateProgress').style.width = `${percentage}%`;
    if ($('nexusReleaseNotes')) $('nexusReleaseNotes').textContent = update.releaseNotes || `${headline}\n\n${detail}`;

    const badge = $('nexusUpdateBadge');
    if (badge) {
      badge.textContent = titleCase(status);
      badge.className = `severity ${['available', 'downloaded', 'current'].includes(status) ? 'good' : status === 'error' ? 'bad' : ''}`;
    }

    $('nexusUpdateDownload')?.classList.toggle('hidden', status !== 'available');
    $('nexusUpdateInstall')?.classList.toggle('hidden', status !== 'downloaded');
    $('nexusUpdateRelease')?.classList.toggle('hidden', !update.releaseUrl);
    if ($('nexusUpdateCheck')) $('nexusUpdateCheck').disabled = ['checking', 'downloading', 'installing'].includes(status);

    const banner = $('nexusUpdateBanner');
    if (banner) {
      const visible = ['available', 'downloading', 'downloaded', 'installing', 'error'].includes(status);
      banner.className = `nexus-update-banner ${visible ? '' : 'hidden'} ${status}`.trim();
      $('nexusUpdateHeadline').textContent = headline;
      $('nexusUpdateDetail').textContent = detail;
      $('nexusUpdateGlyph').textContent = status === 'error' ? '!' : status === 'downloaded' ? '✓' : status === 'downloading' ? '↓' : status === 'installing' ? '↻' : '↑';
      const actions = $('nexusUpdateBannerActions');
      if (actions) {
        if (status === 'available') actions.innerHTML = actionButton('Download', 'download', true);
        else if (status === 'downloaded') actions.innerHTML = actionButton('Install & Restart', 'install', true);
        else if (status === 'error') actions.innerHTML = `${actionButton('Retry', 'check')}${update.releaseUrl ? actionButton('Releases', 'release') : ''}`;
        else actions.innerHTML = '';
      }
    }

    if (currentState) renderCommandDeck(currentState);
  }

  function renderState(state) {
    currentState = state;
    ensureUi();
    renderCommandDeck(state);
    renderUpdate(state?.update || currentUpdate || {});
  }

  async function runUpdateAction(action) {
    if (action === 'check') {
      notify('Checking the Khaos Nexus stable release channel…');
      const result = await invoke('update:check');
      renderUpdate(result || currentUpdate || {});
      return;
    }
    if (action === 'download') {
      notify('Update download started.');
      await invoke('update:download');
      return;
    }
    if (action === 'install') {
      const version = currentUpdate?.version ? ` v${currentUpdate.version}` : '';
      if (!confirm(`Install Khaos Nexus${version} now? A verified pre-update backup will be created, then the application will restart.`)) return;
      notify('Preparing the update and verified backup…');
      await invoke('update:install');
      return;
    }
    if (action === 'release') {
      await invoke('update:open-release', currentUpdate?.releaseUrl || null);
    }
  }

  function bind() {
    document.addEventListener('click', (event) => {
      const delegated = event.target.closest('[data-nexus-update-action]');
      if (delegated) runUpdateAction(delegated.dataset.nexusUpdateAction).catch(() => {});
    });
    $('nexusUpdateCheck')?.addEventListener('click', () => runUpdateAction('check').catch(() => {}));
    $('nexusUpdateDownload')?.addEventListener('click', () => runUpdateAction('download').catch(() => {}));
    $('nexusUpdateInstall')?.addEventListener('click', () => runUpdateAction('install').catch(() => {}));
    $('nexusUpdateRelease')?.addEventListener('click', () => runUpdateAction('release').catch(() => {}));
    window.khaosStateHub.subscribe(renderState);
    window.khaos.onUpdate((update) => renderUpdate(update));
  }

  async function initialize() {
    ensureUi();
    bind();
    renderState(await invoke('app:get-state'));
  }

  initialize().catch((error) => notify(`The v0.8 interface failed to initialize: ${error.message}`));
})();
