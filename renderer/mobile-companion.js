'use strict';

(() => {
  const mobile = { payload: null, initialized: false };
  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
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
    try { return await window.khaos.invoke(channel, payload); }
    catch (error) { notify(error.message || String(error)); throw error; }
  }

  function canOwn() {
    return ['owner', 'local-admin'].includes(mobile.payload?.role);
  }

  function ensureShell() {
    if ($('view-mobile-companion')) return;
    const settingsNav = document.querySelector('[data-view="settings"]');
    if (settingsNav) {
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.view = 'mobile-companion';
      button.innerHTML = '<span>◈</span>Mobile Companion';
      settingsNav.insertAdjacentElement('beforebegin', button);
    }

    const view = document.createElement('section');
    view.className = 'view';
    view.id = 'view-mobile-companion';
    view.innerHTML = `
      <div class="mobile-hero">
        <div><span class="eyebrow">Android Companion</span><h2>Khaos Nexus Mobile</h2><p>Build a signed Android command deck that pairs to this PC while protected Discord, GitHub, RCON, Palworld, and provider credentials remain on the desktop.</p></div>
        <div class="mobile-hero-badge"><span>APK TRACK</span><strong>FOUNDATION</strong><small>Security contract first</small></div>
      </div>

      <div id="mobileSummary" class="mobile-summary-grid"></div>

      <div class="mobile-layout">
        <section class="panel mobile-control-panel">
          <div class="panel-heading"><div><span class="eyebrow">Desktop gateway</span><h3>Connection Foundation</h3></div><span class="severity" id="mobileTransportBadge">Planned</span></div>
          <div class="mobile-safety-callout"><strong>Secrets stay on this PC</strong><span>The Android app receives public-safe state and typed action results. It never receives your bot token, GitHub token, RCON password, Palworld AdminPassword, or provider credentials.</span></div>
          <div class="form-grid three">
            <label>Future HTTPS port<input id="mobileGatewayPort" type="number" min="1024" max="65535"></label>
            <label>Remote access<select id="mobileRemoteMode"><option value="disabled">Disabled</option><option value="private-network">Private network only</option><option value="relay">Future encrypted relay</option></select></label>
            <label class="toggle-row compact"><span><strong>Biometric Owner confirmation</strong><small>Require Android biometric approval for Owner actions.</small></span><input id="mobileBiometric" type="checkbox"></label>
          </div>
          <label class="toggle-row"><span><strong>Allow local-network pairing</strong><small>Stored for the future HTTPS gateway. No LAN listener is opened in this foundation build.</small></span><input id="mobileLanPairing" type="checkbox"></label>
          <div class="form-actions"><button class="button primary" id="mobileSaveSettings">Save Foundation Settings</button></div>
          <p class="privacy-note">The gateway remains disabled until certificate generation, HTTPS transport, replay protection, rate limits, and the read-only Android client are all validated.</p>
        </section>

        <aside class="panel mobile-pair-panel">
          <div class="panel-heading"><div><span class="eyebrow">Pairing design preview</span><h3>One-Time Device Code</h3></div></div>
          <label>Requested device role<select id="mobilePairRole"><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="owner">Owner</option></select></label>
          <div id="mobilePairingCard" class="mobile-pairing-card"></div>
          <div class="form-actions"><button class="button primary" id="mobilePreviewPairing">Preview Pairing Code</button><button class="button" id="mobileCancelPairing">Cancel</button></div>
          <p class="privacy-note">Preview codes demonstrate the five-minute, single-use pairing contract. They cannot be claimed by a phone until the HTTPS transport phase is complete.</p>
        </aside>
      </div>

      <section class="panel mobile-device-panel">
        <div class="panel-heading"><div><span class="eyebrow">Trusted Android devices</span><h3>Paired Device Registry</h3></div><span class="tag" id="mobileDeviceCount">0 devices</span></div>
        <div id="mobileDeviceList" class="mobile-device-list"></div>
      </section>

      <section class="mobile-roadmap">
        <article class="mobile-phase complete"><span>01</span><div><strong>Security & API contract</strong><small>Pairing, roles, hashed credentials, revocation, protected responses, and Android product plan.</small></div></article>
        <article class="mobile-phase active"><span>02</span><div><strong>Desktop HTTPS gateway</strong><small>Certificate generation, certificate fingerprint, pairing claim, device sessions, rate limits, and event stream.</small></div></article>
        <article class="mobile-phase"><span>03</span><div><strong>Read-only Compose APK</strong><small>Pairing, Command Deck, Discord, servers, modules, logs, status panels, and update state.</small></div></article>
        <article class="mobile-phase"><span>04</span><div><strong>Safe Operator actions</strong><small>Bot controls, health checks, save world, status-panel refresh, Safe Recovery, and verified backups.</small></div></article>
        <article class="mobile-phase"><span>05</span><div><strong>Signed release channel</strong><small>Permanent signing key, tests, lint, signature verification, SHA-256 manifest, and installable APK release.</small></div></article>
      </section>`;
    document.querySelector('main.content')?.appendChild(view);
    bindShell();
  }

  function openMobile() {
    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-mobile-companion'));
    document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === 'mobile-companion'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Mobile Companion';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Plan and secure the installable Khaos Nexus Android command deck.';
    refresh().catch(() => {});
  }

  function relativeTime(value) {
    if (!value) return 'Never';
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return new Date(value).toLocaleString();
  }

  function renderSummary() {
    const gateway = mobile.payload?.gateway || {};
    const devices = gateway.devices || [];
    const active = devices.filter((device) => device.enabled && !device.revokedAt).length;
    $('mobileSummary').innerHTML = `
      <article><span>Transport</span><strong>${gateway.transportReady ? 'Ready' : 'Planned'}</strong><small>HTTPS required</small></article>
      <article><span>Trusted devices</span><strong>${active}</strong><small>${devices.length - active} revoked</small></article>
      <article><span>Desktop role</span><strong>${escapeHtml(mobile.payload?.role || 'locked')}</strong><small>Desktop remains authoritative</small></article>
      <article><span>APK status</span><strong>${mobile.payload?.plan?.apkReady ? 'Installable' : 'Not built'}</strong><small>${escapeHtml(mobile.payload?.plan?.currentPhase || 'Foundation')}</small></article>`;
    $('mobileTransportBadge').textContent = gateway.transportReady ? 'Ready' : 'Planned';
    $('mobileTransportBadge').classList.toggle('good', Boolean(gateway.transportReady));
  }

  function renderSettings() {
    const gateway = mobile.payload?.gateway || {};
    $('mobileGatewayPort').value = gateway.port || 43120;
    $('mobileRemoteMode').value = gateway.remoteAccessMode || 'disabled';
    $('mobileBiometric').checked = gateway.requireBiometricForOwnerActions !== false;
    $('mobileLanPairing').checked = Boolean(gateway.allowLanPairing);
    const editable = canOwn();
    for (const id of ['mobileGatewayPort', 'mobileRemoteMode', 'mobileBiometric', 'mobileLanPairing', 'mobileSaveSettings', 'mobilePairRole', 'mobilePreviewPairing', 'mobileCancelPairing']) {
      if ($(id)) $(id).disabled = !editable;
    }
  }

  function renderPairing() {
    const session = mobile.payload?.gateway?.pairingSession;
    if (!session) {
      $('mobilePairingCard').innerHTML = '<span class="mobile-pair-placeholder">No pairing preview active</span>';
      return;
    }
    const expires = new Date(session.expiresAt);
    $('mobilePairingCard').innerHTML = `<span class="mobile-pair-label">PREVIEW CODE</span><strong>${escapeHtml(session.code)}</strong><small>${escapeHtml(session.requestedRole)} • expires ${expires.toLocaleTimeString()}</small>`;
  }

  function renderDevices() {
    const devices = mobile.payload?.gateway?.devices || [];
    $('mobileDeviceCount').textContent = `${devices.length} device${devices.length === 1 ? '' : 's'}`;
    if (!devices.length) {
      $('mobileDeviceList').innerHTML = '<div class="mobile-empty"><strong>No Android devices paired</strong><span>The device registry is ready. Real pairing begins after the HTTPS gateway phase.</span></div>';
      return;
    }
    $('mobileDeviceList').innerHTML = devices.map((device) => `
      <article class="mobile-device-card ${device.enabled ? '' : 'revoked'}">
        <div class="mobile-device-icon">◈</div>
        <div><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(device.role)} • ${device.enabled ? 'active' : 'revoked'}</span><small>Created ${relativeTime(device.createdAt)} • Last seen ${relativeTime(device.lastSeenAt)}</small></div>
        <div class="mobile-device-actions">${device.enabled ? `<button class="button danger" data-mobile-revoke="${escapeHtml(device.id)}">Revoke</button>` : ''}<button class="button" data-mobile-remove="${escapeHtml(device.id)}">Remove Record</button></div>
      </article>`).join('');
  }

  function render() {
    if (!mobile.payload) return;
    renderSummary();
    renderSettings();
    renderPairing();
    renderDevices();
  }

  async function refresh() {
    mobile.payload = await invoke('mobile-gateway:get');
    render();
  }

  function bindShell() {
    $('mobileSaveSettings').addEventListener('click', async () => {
      mobile.payload = await invoke('mobile-gateway:save-settings', {
        port: Number($('mobileGatewayPort').value),
        remoteAccessMode: $('mobileRemoteMode').value,
        allowLanPairing: $('mobileLanPairing').checked,
        requireBiometricForOwnerActions: $('mobileBiometric').checked
      });
      render();
      notify('Mobile Companion foundation settings saved.');
    });

    $('mobilePreviewPairing').addEventListener('click', async () => {
      mobile.payload = await invoke('mobile-gateway:preview-pairing', { requestedRole: $('mobilePairRole').value });
      render();
      notify('Pairing design preview created.');
    });

    $('mobileCancelPairing').addEventListener('click', async () => {
      mobile.payload = await invoke('mobile-gateway:cancel-pairing');
      render();
      notify('Pairing preview cancelled.');
    });

    $('mobileDeviceList').addEventListener('click', async (event) => {
      const revoke = event.target.closest('[data-mobile-revoke]');
      const remove = event.target.closest('[data-mobile-remove]');
      if (revoke && confirm('Revoke this Android device immediately?')) {
        mobile.payload = await invoke('mobile-gateway:revoke-device', revoke.dataset.mobileRevoke);
        render();
        notify('Android device revoked.');
      }
      if (remove && confirm('Remove this Android device record?')) {
        mobile.payload = await invoke('mobile-gateway:remove-device', remove.dataset.mobileRemove);
        render();
        notify('Android device record removed.');
      }
    });
  }

  async function initialize() {
    ensureShell();
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-view="mobile-companion"]');
      if (button) openMobile();
    });
    await refresh();
    mobile.initialized = true;
  }

  initialize().catch((error) => notify(`Mobile Companion failed to initialize: ${error.message}`));
})();
