'use strict';

(() => {
  const RECOVERY_PHRASE = 'UNLOCK KHAOS NEXUS';
  let latestState = null;
  let pollTimer = null;

  const byId = (id) => document.getElementById(id);

  function isLocked(state) {
    const access = state?.autonomy?.access;
    return Boolean(access?.enabled && access?.role === 'locked' && !access?.canView);
  }

  function ensureVersion(state) {
    const version = state?.app?.version;
    if (!version) return;
    const label = byId('versionLabel');
    if (label) label.textContent = `Version ${version}`;

    let chip = byId('nexusAlwaysVisibleVersion');
    if (!chip) {
      chip = document.createElement('span');
      chip.id = 'nexusAlwaysVisibleVersion';
      chip.className = 'nexus-version-chip';
      const topbar = document.querySelector('.topbar');
      if (topbar) topbar.appendChild(chip);
    }
    if (chip) chip.textContent = `v${version}`;
  }

  function setFallbackStatus(message) {
    const status = byId('nexusStabilityRecoveryStatus');
    if (status) status.textContent = String(message || '');
  }

  async function refreshState() {
    try {
      const state = await window.khaos.invoke('app:get-state');
      applyState(state);
      return state;
    } catch (error) {
      setFallbackStatus(error.message || String(error));
      return null;
    }
  }

  async function signIn() {
    setFallbackStatus('Opening Discord sign-in in your browser…');
    try {
      await window.khaos.invoke('discord-auth:login');
      const state = await refreshState();
      if (isLocked(state)) setFallbackStatus(state?.autonomy?.access?.reason || 'That Discord account is not authorized.');
    } catch (error) {
      setFallbackStatus(error.message || String(error));
    }
  }

  async function localRecovery() {
    const phrase = window.prompt(`Type ${RECOVERY_PHRASE} to disable desktop access control and restart Khaos Nexus.`) || '';
    if (phrase.trim().replace(/\s+/g, ' ').toUpperCase() !== RECOVERY_PHRASE) {
      setFallbackStatus('Recovery cancelled. The confirmation phrase did not match.');
      return;
    }
    setFallbackStatus('Disabling access control and restarting Khaos Nexus…');
    try {
      await window.khaos.invoke('access-recovery:disable', { phrase, reason: 'stability-fallback' });
    } catch (error) {
      setFallbackStatus(error.message || String(error));
    }
  }

  function ensureFallback(reason) {
    let fallback = byId('nexusStabilityRecovery');
    if (fallback) {
      const reasonElement = byId('nexusStabilityRecoveryReason');
      if (reasonElement) reasonElement.textContent = reason || 'Sign in with an authorized Discord account to continue.';
      fallback.hidden = false;
      return fallback;
    }

    fallback = document.createElement('section');
    fallback.id = 'nexusStabilityRecovery';
    fallback.className = 'nexus-stability-recovery';
    fallback.innerHTML = `
      <div class="nexus-stability-recovery-card">
        <span class="eyebrow">Fail-safe Local Recovery</span>
        <h2>Khaos Nexus is locked</h2>
        <p id="nexusStabilityRecoveryReason"></p>
        <div class="nexus-stability-recovery-actions">
          <button class="button primary" id="nexusStabilitySignIn">Sign In with Discord</button>
          <button class="button" id="nexusStabilityLocalRecovery">Emergency Local Recovery</button>
        </div>
        <small class="nexus-stability-recovery-status" id="nexusStabilityRecoveryStatus">These controls remain available even if another interface module fails.</small>
      </div>`;
    document.body.appendChild(fallback);
    byId('nexusStabilitySignIn')?.addEventListener('click', signIn);
    byId('nexusStabilityLocalRecovery')?.addEventListener('click', localRecovery);
    byId('nexusStabilityRecoveryReason').textContent = reason || 'Sign in with an authorized Discord account to continue.';
    return fallback;
  }

  function applyLockedState(state) {
    const locked = isLocked(state);
    document.body.classList.toggle('nexus-access-locked', locked);

    const overlay = byId('nexusAccessRecovery');
    const fallback = byId('nexusStabilityRecovery');

    if (!locked) {
      document.body.classList.remove('nexus-access-locked');
      if (overlay) {
        overlay.classList.add('hidden');
        overlay.style.removeProperty('display');
      }
      if (fallback) fallback.remove();
      return;
    }

    const reason = state?.autonomy?.access?.reason || 'Sign in with an authorized Discord account to continue.';
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.style.setProperty('display', 'grid', 'important');
      const reasonElement = byId('nexusAccessRecoveryReason');
      if (reasonElement) reasonElement.textContent = reason;
      if (fallback) fallback.remove();
    } else {
      ensureFallback(reason);
    }
  }

  function applyState(state) {
    latestState = state || latestState;
    if (!latestState) return;
    ensureVersion(latestState);
    applyLockedState(latestState);
  }

  function initialize() {
    window.khaos.onState(applyState);
    refreshState();
    pollTimer = window.setInterval(refreshState, 5000);
    window.addEventListener('beforeunload', () => {
      if (pollTimer) window.clearInterval(pollTimer);
    });
  }

  initialize();
})();
