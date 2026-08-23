'use strict';

(() => {
  const api = window.nexusAdmin;
  const content = document.getElementById('content');
  if (!api || !content || typeof api.sentinalPair !== 'function') return;

  function installPairingControls() {
    const urlInput = document.getElementById('sentinalAdminUrl');
    const saveButton = document.getElementById('saveAdminUrl');
    if (!urlInput || !saveButton || document.getElementById('sentinalPairCode')) return;
    const card = urlInput.closest('.card');
    if (!card) return;

    const label = document.createElement('label');
    label.className = 'field';
    label.innerHTML = '<span>One-time pairing code</span><input id="sentinalPairCode" autocomplete="off" maxlength="20" placeholder="NXA-XXXX-XXXX">';
    const note = card.querySelector('.field-note');
    if (note) note.insertAdjacentElement('afterend', label);
    else card.appendChild(label);

    const actions = saveButton.closest('.actions');
    const pairButton = document.createElement('button');
    pairButton.id = 'pairHostedSentinal';
    pairButton.className = 'secondary';
    pairButton.textContent = 'Pair Hosted Sentinal';
    actions?.insertBefore(pairButton, saveButton);

    const help = document.createElement('p');
    help.className = 'field-note';
    help.textContent = 'Run /nexus-pair in Discord, paste the HTTPS Admin URL and one-time code here, then Pair. The permanent admin credential is stored directly in encrypted Credentials storage.';
    card.appendChild(help);

    pairButton.onclick = async () => {
      const codeInput = document.getElementById('sentinalPairCode');
      const url = urlInput.value.trim();
      const code = codeInput?.value.trim() || '';
      if (!url || !code) return window.alert('Enter the HTTPS Admin URL and one-time code from /nexus-pair.');
      const original = pairButton.textContent;
      pairButton.disabled = true;
      pairButton.textContent = 'Pairing…';
      try {
        const state = await api.sentinalPair(url, code);
        if (state?.sentinal?.ok === false && state?.sentinal?.code !== 'SENTINAL_ADMIN_NOT_CONFIGURED') {
          throw new Error(state.sentinal.message || state.sentinal.code || 'Sentinal pairing completed but health verification failed.');
        }
        if (codeInput) codeInput.value = '';
        urlInput.value = state?.settings?.discord?.sentinalAdminUrl || url;
        window.alert('Hosted Nexus Sentinal paired. The admin token is stored in encrypted Credentials storage.');
        setTimeout(() => document.getElementById('adminScan')?.click(), 50);
      } catch (error) {
        window.alert(error.message || String(error));
      } finally {
        pairButton.disabled = false;
        pairButton.textContent = original;
      }
    };
  }

  const observer = new MutationObserver(installPairingControls);
  observer.observe(content, { childList: true, subtree: true });
  installPairingControls();
})();
