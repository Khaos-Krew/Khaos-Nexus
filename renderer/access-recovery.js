'use strict';

(() => {
  const RECOVERY_PHRASE = 'UNLOCK KHAOS NEXUS';
  let latestState = null;
  let loginRunning = false;
  let recoveryRunning = false;

  const $ = (id) => document.getElementById(id);

  function isLocked(state) {
    const access = state?.autonomy?.access;
    return Boolean(access?.enabled && access?.role === 'locked' && !access?.canView);
  }

  function ensureOverlay() {
    if ($('nexusAccessRecovery')) return;
    const overlay = document.createElement('section');
    overlay.id = 'nexusAccessRecovery';
    overlay.className = 'nexus-access-recovery hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'nexusAccessRecoveryTitle');
    overlay.innerHTML = `
      <div class="nexus-access-recovery-card">
        <div class="nexus-access-recovery-sigil"><img src="../assets/icon.png" alt=""></div>
        <span class="nexus-access-kicker">Local Access Recovery</span>
        <h1 id="nexusAccessRecoveryTitle">Khaos Nexus is locked</h1>
        <p id="nexusAccessRecoveryReason">Sign in with an authorized Discord account to continue.</p>
        <div class="nexus-access-actions">
          <button class="button primary" id="nexusAccessSignIn">Sign In with Discord</button>
          <button class="button" id="nexusAccessShowRecovery">Emergency Local Recovery</button>
        </div>
        <div class="nexus-access-recovery-form hidden" id="nexusAccessRecoveryForm">
          <div class="nexus-access-warning">
            This disables desktop access control on this PC and restarts Khaos Nexus. It does not remove credentials, servers, modules, or backups.
          </div>
          <label for="nexusAccessRecoveryPhrase">Type <strong>${RECOVERY_PHRASE}</strong></label>
          <input id="nexusAccessRecoveryPhrase" autocomplete="off" spellcheck="false" placeholder="${RECOVERY_PHRASE}">
          <div class="nexus-access-actions">
            <button class="button danger" id="nexusAccessConfirmRecovery" disabled>Disable Access Control & Restart</button>
            <button class="button" id="nexusAccessCancelRecovery">Cancel</button>
          </div>
        </div>
        <small id="nexusAccessRecoveryStatus">Only a person using this Windows PC can use local recovery.</small>
      </div>`;
    document.body.appendChild(overlay);
    bindOverlay();
  }

  function render(state) {
    latestState = state || latestState;
    ensureOverlay();
    const overlay = $('nexusAccessRecovery');
    const locked = isLocked(latestState);
    overlay.classList.toggle('hidden', !locked);
    document.body.classList.toggle('nexus-access-locked', locked);
    if (!locked) return;

    const access = latestState?.autonomy?.access || {};
    $('nexusAccessRecoveryReason').textContent = access.reason || 'Sign in with an authorized Discord account to continue.';
    $('nexusAccessSignIn').disabled = loginRunning;
    $('nexusAccessShowRecovery').disabled = loginRunning || recoveryRunning;
  }

  async function refreshState() {
    const state = await window.khaos.invoke('app:get-state');
    render(state);
    return state;
  }

  async function signIn() {
    if (loginRunning) return;
    loginRunning = true;
    $('nexusAccessRecoveryStatus').textContent = 'Opening Discord sign-in in your browser…';
    render(latestState);
    try {
      await window.khaos.invoke('discord-auth:login');
      const state = await refreshState();
      if (isLocked(state)) {
        $('nexusAccessRecoveryStatus').textContent = state?.autonomy?.access?.reason || 'That Discord account is not authorized.';
      } else {
        $('nexusAccessRecoveryStatus').textContent = 'Access restored.';
      }
    } catch (error) {
      $('nexusAccessRecoveryStatus').textContent = error.message || String(error);
    } finally {
      loginRunning = false;
      render(latestState);
    }
  }

  function showRecovery(show) {
    $('nexusAccessRecoveryForm').classList.toggle('hidden', !show);
    $('nexusAccessShowRecovery').classList.toggle('hidden', show);
    if (show) {
      $('nexusAccessRecoveryPhrase').value = '';
      $('nexusAccessConfirmRecovery').disabled = true;
      $('nexusAccessRecoveryPhrase').focus();
      $('nexusAccessRecoveryStatus').textContent = 'Confirm the phrase to recover local control.';
    } else {
      $('nexusAccessRecoveryStatus').textContent = 'Only a person using this Windows PC can use local recovery.';
    }
  }

  async function confirmRecovery() {
    if (recoveryRunning) return;
    const phrase = $('nexusAccessRecoveryPhrase').value;
    if (phrase.trim().replace(/\s+/g, ' ').toUpperCase() !== RECOVERY_PHRASE) return;
    recoveryRunning = true;
    $('nexusAccessConfirmRecovery').disabled = true;
    $('nexusAccessCancelRecovery').disabled = true;
    $('nexusAccessRecoveryStatus').textContent = 'Disabling access control and restarting Khaos Nexus…';
    try {
      await window.khaos.invoke('access-recovery:disable', { phrase, reason: 'locked-interface' });
    } catch (error) {
      recoveryRunning = false;
      $('nexusAccessCancelRecovery').disabled = false;
      $('nexusAccessRecoveryStatus').textContent = error.message || String(error);
      updateRecoveryButton();
    }
  }

  function updateRecoveryButton() {
    const valid = $('nexusAccessRecoveryPhrase').value.trim().replace(/\s+/g, ' ').toUpperCase() === RECOVERY_PHRASE;
    $('nexusAccessConfirmRecovery').disabled = !valid || recoveryRunning;
  }

  function bindOverlay() {
    $('nexusAccessSignIn').addEventListener('click', () => signIn());
    $('nexusAccessShowRecovery').addEventListener('click', () => showRecovery(true));
    $('nexusAccessCancelRecovery').addEventListener('click', () => showRecovery(false));
    $('nexusAccessConfirmRecovery').addEventListener('click', () => confirmRecovery());
    $('nexusAccessRecoveryPhrase').addEventListener('input', updateRecoveryButton);
    $('nexusAccessRecoveryPhrase').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !$('nexusAccessConfirmRecovery').disabled) confirmRecovery();
    });
  }

  async function initialize() {
    ensureOverlay();
    window.khaos.onState(render);
    await refreshState();
  }

  initialize().catch((error) => {
    ensureOverlay();
    $('nexusAccessRecovery').classList.remove('hidden');
    $('nexusAccessRecoveryStatus').textContent = `Access recovery failed to initialize: ${error.message || String(error)}`;
  });
})();
