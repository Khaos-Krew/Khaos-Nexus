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
        <div><span class="eyebrow">Secure Android Companion</span><h2>Khaos Nexus Mobile</h2><p>Pair a read-only Android command deck to this PC. Discord, GitHub, RCON, Palworld, Rust, and hosting-provider credentials never leave the desktop.</p></div>
        <div class="mobile-hero-badge"><span>APK TRACK</span><strong>PHASE 1</strong><small>HTTPS • pinned • read-only</small></div>
      </div>

      <div id="mobileSummary" class="mobile-summary-grid"></div>

      <div class="mobile-layout">
        <section class="panel mobile-control-panel">
          <div class="panel-heading"><div><span class="eyebrow">Desktop gateway</span><h3>HTTPS Security Boundary</h3></div><span class="severity" id="mobileTransportBadge">Disabled</span></div>
          <div class="mobile-safety-callout"><strong>Secrets stay on this PC</strong><span>The phone receives only public-safe status. Every request uses a hashed device credential, P-256 signature, timestamp, one-time nonce, rate limit, and pinned desktop certificate.</span></div>
          <label class="toggle-row"><span><strong>Enable Mobile Gateway</strong><small>Starts the local HTTPS service only while the Owner module and this setting are enabled.</small></span><input id="mobileGatewayEnabled" type="checkbox"></label>
          <div class="form-grid three">
            <label>HTTPS port<input id="mobileGatewayPort" type="number" min="1024" max="65535"></label>
            <label>Access route<select id="mobileRemoteMode"><option value="disabled">Local network only</option><option value="private-network">Private network / VPN</option></select></label>
            <label class="toggle-row compact"><span><strong>Biometric Owner confirmation</strong><small>Reserved for guarded Phase 3 actions.</small></span><input id="mobileBiometric" type="checkbox"></label>
          </div>
          <label class="toggle-row"><span><strong>Listen on local network</strong><small>Required for a physical phone on the same trusted network. Do not expose this port directly to the public internet.</small></span><input id="mobileLanPairing" type="checkbox"></label>
          <div class="form-actions"><button class="button primary" id="mobileSaveSettings">Save & Apply Gateway</button><button class="button danger" id="mobileRotateCertificate">Rotate Certificate</button></div>
          <div id="mobileTransportDetails" class="mobile-transport-details"></div>
        </section>

        <aside class="panel mobile-pair-panel">
          <div class="panel-heading"><div><span class="eyebrow">One-time enrollment</span><h3>Pair Android Device</h3></div></div>
          <label>Requested device role<select id="mobilePairRole"><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="owner">Owner</option></select></label>
          <div id="mobilePairingCard" class="mobile-pairing-card"></div>
          <div class="form-actions"><button class="button primary" id="mobileCreatePairing">Create Pairing Code</button><button class="button" id="mobileCancelPairing">Cancel</button></div>
          <p class="privacy-note">The QR code includes the private-network endpoint, five-minute code, and certificate fingerprint. The phone still waits for explicit desktop approval before receiving a credential.</p>
        </aside>
      </div>

      <section class="panel mobile-device-panel">
        <div class="panel-heading"><div><span class="eyebrow">Owner approval</span><h3>Pending Pairing Request</h3></div><span class="tag" id="mobilePendingBadge">None</span></div>
        <div id="mobilePendingPairing"></div>
      </section>

      <section class="panel mobile-device-panel">
        <div class="panel-heading"><div><span class="eyebrow">Trusted Android devices</span><h3>Paired Device Registry</h3></div><span class="tag" id="mobileDeviceCount">0 devices</span></div>
        <div id="mobileDeviceList" class="mobile-device-list"></div>
      </section>

      <section class="mobile-roadmap">
        <article class="mobile-phase complete"><span>01</span><div><strong>Security & API contract</strong><small>Pairing, roles, hashed credentials, revocation, protected responses, and signed requests.</small></div></article>
        <article class="mobile-phase complete"><span>02</span><div><strong>Desktop HTTPS gateway</strong><small>Certificate pinning, one-time pairing, rate limits, replay protection, and live event stream.</small></div></article>
        <article class="mobile-phase active"><span>03</span><div><strong>Read-only Compose APK</strong><small>Command Deck, Discord, servers, modules, logs, status panels, and update state.</small></div></article>
        <article class="mobile-phase"><span>04</span><div><strong>Safe Operator actions</strong><small>Bot controls, health checks, save world, panel refresh, Safe Recovery, and verified backups.</small></div></article>
        <article class="mobile-phase"><span>05</span><div><strong>Stable signed release</strong><small>Permanent external signing key, device testing, signature verification, and checksums.</small></div></article>
      </section>`;
    document.querySelector('main.content')?.appendChild(view);
    bindShell();
  }

  function openMobile() {
    document.querySelectorAll('.view').forEach((element) => element.classList.toggle('active', element.id === 'view-mobile-companion'));
    document.querySelectorAll('.nav-item').forEach((element) => element.classList.toggle('active', element.dataset.view === 'mobile-companion'));
    if ($('viewTitle')) $('viewTitle').textContent = 'Mobile Companion';
    if ($('viewSubtitle')) $('viewSubtitle').textContent = 'Secure pairing and read-only Android command deck.';
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
      <article><span>Transport</span><strong>${gateway.transportReady ? 'Online' : escapeHtml(gateway.transportStatus || 'Disabled')}</strong><small>HTTPS only</small></article>
      <article><span>Trusted devices</span><strong>${active}</strong><small>${devices.length - active} revoked</small></article>
      <article><span>Live sessions</span><strong>${Number(gateway.activeSessions || 0)}</strong><small>Signed event streams</small></article>
      <article><span>APK status</span><strong>${mobile.payload?.plan?.apkReady ? 'Owner test' : 'Not built'}</strong><small>${escapeHtml(mobile.payload?.plan?.currentPhase || 'Phase 1')}</small></article>`;
    $('mobileTransportBadge').textContent = gateway.transportReady ? 'Online' : (gateway.transportStatus || 'Disabled');
    $('mobileTransportBadge').classList.toggle('good', Boolean(gateway.transportReady));
  }

  function renderSettings() {
    const gateway = mobile.payload?.gateway || {};
    $('mobileGatewayEnabled').checked = Boolean(gateway.enabled);
    $('mobileGatewayPort').value = gateway.port || 43120;
    $('mobileRemoteMode').value = gateway.remoteAccessMode || 'disabled';
    $('mobileBiometric').checked = gateway.requireBiometricForOwnerActions !== false;
    $('mobileLanPairing').checked = Boolean(gateway.allowLanPairing);
    const endpoints = (gateway.endpoints || []).map((endpoint) => `<code>${escapeHtml(endpoint)}</code>`).join('');
    $('mobileTransportDetails').innerHTML = `
      <div><span>Certificate SHA-256</span><code>${escapeHtml(gateway.certificateFingerprint || 'Generated when the gateway starts')}</code></div>
      <div><span>Certificate expires</span><strong>${gateway.certificateExpiresAt ? new Date(gateway.certificateExpiresAt).toLocaleString() : 'Not generated'}</strong></div>
      <div><span>Reachable endpoints</span><div class="mobile-endpoints">${endpoints || '<small>No active endpoint</small>'}</div></div>
      ${gateway.lastError ? `<div class="mobile-gateway-error"><span>Gateway error</span><strong>${escapeHtml(gateway.lastError)}</strong></div>` : ''}`;
    const editable = canOwn();
    for (const id of ['mobileGatewayEnabled', 'mobileGatewayPort', 'mobileRemoteMode', 'mobileBiometric', 'mobileLanPairing', 'mobileSaveSettings', 'mobilePairRole', 'mobileCreatePairing', 'mobileCancelPairing', 'mobileRotateCertificate']) {
      if ($(id)) $(id).disabled = !editable;
    }
    $('mobileCreatePairing').disabled = !editable || !gateway.transportReady;
  }

  function renderPairing() {
    const gateway = mobile.payload?.gateway || {};
    const session = gateway.pairingSession;
    if (!session) {
      $('mobilePairingCard').innerHTML = '<span class="mobile-pair-placeholder">No active pairing code</span>';
      return;
    }
    const qr = gateway.qrDataUrl ? `<img class="mobile-pair-qr" src="${escapeHtml(gateway.qrDataUrl)}" alt="Android pairing QR code">` : '';
    $('mobilePairingCard').innerHTML = `${qr}<span class="mobile-pair-label">ONE-TIME CODE</span><strong>${escapeHtml(session.code || '------')}</strong><small>${escapeHtml(session.requestedRole)} • expires ${new Date(session.expiresAt).toLocaleTimeString()}</small>`;
  }

  function renderPending() {
    const pending = mobile.payload?.gateway?.pendingPairing;
    $('mobilePendingBadge').textContent = pending ? escapeHtml(pending.status) : 'None';
    if (!pending) {
      $('mobilePendingPairing').innerHTML = '<div class="mobile-empty"><strong>No phone is waiting for approval</strong><span>Create a pairing code, scan it on Android, then verify the device name and key fingerprint here.</span></div>';
      return;
    }
    const canDecide = pending.status === 'pending' && canOwn();
    $('mobilePendingPairing').innerHTML = `
      <article class="mobile-pending-card">
        <div><span>Device</span><strong>${escapeHtml(pending.name)}</strong><small>Requested role: ${escapeHtml(pending.requestedRole)}</small></div>
        <div><span>Device key SHA-256</span><code>${escapeHtml(pending.publicKeyFingerprint)}</code><small>${escapeHtml(pending.keyAlgorithm || 'EC-P256')} • expires ${new Date(pending.expiresAt).toLocaleTimeString()}</small></div>
        <div class="mobile-device-actions">${canDecide ? `<button class="button primary" data-mobile-approve="${escapeHtml(pending.id)}">Approve</button><button class="button danger" data-mobile-reject="${escapeHtml(pending.id)}">Reject</button>` : `<strong>${escapeHtml(pending.status)}</strong>`}</div>
      </article>`;
  }

  function renderDevices() {
    const devices = mobile.payload?.gateway?.devices || [];
    $('mobileDeviceCount').textContent = `${devices.length} device${devices.length === 1 ? '' : 's'}`;
    if (!devices.length) {
      $('mobileDeviceList').innerHTML = '<div class="mobile-empty"><strong>No Android devices paired</strong><span>Approved phones appear here. Plaintext device credentials are never stored by the desktop.</span></div>';
      return;
    }
    $('mobileDeviceList').innerHTML = devices.map((device) => `
      <article class="mobile-device-card ${device.enabled ? '' : 'revoked'}">
        <div class="mobile-device-icon">◈</div>
        <div><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(device.role)} • ${device.enabled ? 'active' : 'revoked'}</span><small>Key ${escapeHtml(device.publicKeyFingerprint || 'legacy')} • Created ${relativeTime(device.createdAt)} • Last seen ${relativeTime(device.lastSeenAt)}</small></div>
        <div class="mobile-device-actions">${device.enabled ? `<button class="button danger" data-mobile-revoke="${escapeHtml(device.id)}">Revoke</button>` : ''}<button class="button" data-mobile-remove="${escapeHtml(device.id)}">Remove Record</button></div>
      </article>`).join('');
  }

  function render() {
    if (!mobile.payload) return;
    renderSummary();
    renderSettings();
    renderPairing();
    renderPending();
    renderDevices();
  }

  async function refresh() {
    mobile.payload = await invoke('mobile-gateway:get');
    render();
  }

  function bindShell() {
    $('mobileSaveSettings').addEventListener('click', async () => {
      mobile.payload = await invoke('mobile-gateway:save-settings', {
        enabled: $('mobileGatewayEnabled').checked,
        port: Number($('mobileGatewayPort').value),
        remoteAccessMode: $('mobileRemoteMode').value,
        allowLanPairing: $('mobileLanPairing').checked,
        requireBiometricForOwnerActions: $('mobileBiometric').checked
      });
      render();
      notify('Mobile Gateway settings applied.');
    });

    $('mobileCreatePairing').addEventListener('click', async () => {
      mobile.payload = await invoke('mobile-gateway:create-pairing', { requestedRole: $('mobilePairRole').value });
      render();
      notify('One-time Android pairing code created.');
    });

    $('mobileCancelPairing').addEventListener('click', async () => {
      mobile.payload = await invoke('mobile-gateway:cancel-pairing');
      render();
      notify('Android pairing cancelled.');
    });

    $('mobileRotateCertificate').addEventListener('click', async () => {
      const confirmation = prompt('Certificate rotation revokes every paired phone. Type ROTATE MOBILE CERTIFICATE to continue.');
      if (!confirmation) return;
      mobile.payload = await invoke('mobile-gateway:regenerate-certificate', confirmation);
      render();
      notify('Mobile Gateway certificate rotated. Pair phones again.');
    });

    $('mobilePendingPairing').addEventListener('click', async (event) => {
      const approve = event.target.closest('[data-mobile-approve]');
      const reject = event.target.closest('[data-mobile-reject]');
      if (approve && confirm('Approve this Android device with the displayed role and key fingerprint?')) {
        mobile.payload = await invoke('mobile-gateway:approve-pairing', approve.dataset.mobileApprove);
        render();
        notify('Android device approved.');
      }
      if (reject) {
        const reason = prompt('Optional rejection reason:', 'Rejected by the Khaos Nexus Owner.') || '';
        mobile.payload = await invoke('mobile-gateway:reject-pairing', { requestId: reject.dataset.mobileReject, reason });
        render();
        notify('Android device rejected.');
      }
    });

    $('mobileDeviceList').addEventListener('click', async (event) => {
      const revoke = event.target.closest('[data-mobile-revoke]');
      const remove = event.target.closest('[data-mobile-remove]');
      if (revoke && confirm('Revoke this Android device immediately? Its live event stream will close.')) {
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
    window.khaos.on?.('mobile-gateway:update', (payload) => {
      mobile.payload = payload;
      render();
    });
    await refresh();
    mobile.initialized = true;
  }

  initialize().catch((error) => notify(`Mobile Companion failed to initialize: ${error.message}`));
})();
