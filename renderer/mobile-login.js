'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  let mounted = false;

  function toast(message) {
    const value = $('toast');
    if (!value) return;
    value.textContent = String(message || 'Done.');
    value.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => value.classList.remove('show'), 4200);
  }

  async function invoke(channel, payload) {
    try { return await window.khaos.invoke(channel, payload); }
    catch (error) { toast(error.message || String(error)); throw error; }
  }

  function mount() {
    if (mounted || $('mobileAccountLogin')) return true;
    const view = $('view-mobile-companion');
    const anchor = view?.querySelector('.mobile-layout');
    if (!view || !anchor) return false;

    const panel = document.createElement('section');
    panel.id = 'mobileAccountLogin';
    panel.className = 'panel mobile-device-panel';
    panel.innerHTML = `
      <div class="panel-heading">
        <div><span class="eyebrow">Primary Android sign-in</span><h3>Nexus Account Login</h3></div>
        <span class="tag" id="mobileLoginBadge">Not configured</span>
      </div>
      <div class="mobile-safety-callout">
        <strong>No QR or pairing code required</strong>
        <span>The Android app verifies this desktop's certificate first, then signs in with your Nexus username and password. The password is never stored on the phone; Nexus issues a revocable encrypted device session instead.</span>
      </div>
      <div class="form-grid three">
        <label>Username<input id="mobileLoginUsername" autocomplete="username" maxlength="64" placeholder="owner"></label>
        <label>New password<input id="mobileLoginPassword" type="password" autocomplete="new-password" maxlength="256" placeholder="10+ characters"></label>
        <label>Confirm password<input id="mobileLoginConfirm" type="password" autocomplete="new-password" maxlength="256" placeholder="Repeat password"></label>
      </div>
      <div class="form-actions"><button class="button primary" id="mobileLoginSave">Save Mobile Login</button></div>
      <p class="privacy-note">The desktop stores only a salted scrypt verifier inside Nexus encrypted secrets storage. Existing one-time pairing remains available as a recovery path, but the new Android app uses account login by default.</p>`;
    anchor.insertAdjacentElement('afterend', panel);
    $('mobileLoginSave')?.addEventListener('click', save);
    mounted = true;
    refresh().catch(() => {});
    return true;
  }

  async function refresh() {
    if (!mounted) return;
    const login = await invoke('mobile-login:get');
    $('mobileLoginBadge').textContent = login?.configured ? 'Configured' : 'Not configured';
    $('mobileLoginBadge').classList.toggle('good', Boolean(login?.configured));
    if (login?.username && !$('mobileLoginUsername').value) $('mobileLoginUsername').value = login.username;
  }

  async function save() {
    const username = $('mobileLoginUsername')?.value?.trim() || '';
    const password = $('mobileLoginPassword')?.value || '';
    const confirm = $('mobileLoginConfirm')?.value || '';
    if (!username) return toast('Enter a mobile login username.');
    if (password.length < 10) return toast('Use a password with at least 10 characters.');
    if (password !== confirm) return toast('The two passwords do not match.');

    const button = $('mobileLoginSave');
    if (button) button.disabled = true;
    try {
      const result = await invoke('mobile-login:set', { username, password });
      $('mobileLoginPassword').value = '';
      $('mobileLoginConfirm').value = '';
      $('mobileLoginBadge').textContent = result?.configured ? 'Configured' : 'Not configured';
      $('mobileLoginBadge').classList.toggle('good', Boolean(result?.configured));
      toast('Mobile account login saved.');
    } finally {
      if (button) button.disabled = false;
    }
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (mount() || attempts > 120) clearInterval(timer);
  }, 100);
})();
