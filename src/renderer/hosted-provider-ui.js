'use strict';

(() => {
  const api = window.nexusAdmin;
  const content = document.getElementById('content');
  const modulesButton = document.querySelector('nav button[data-view="modules"]');
  const refresh = document.getElementById('refresh');
  if (!api?.sentinalProviderConfig || !api?.sentinalSyncProviders || !api?.sentinalValidateProvider || !content || !modulesButton) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let injecting = false;

  function validationHtml(result, moduleId) {
    const item = result?.results?.[0];
    if (!item) return `<strong class="bad">NO RESULT</strong><br>${esc(result?.message || 'Hosted backend returned no validation result.')}`;
    const label = item.ok ? 'PASS' : item.skipped ? 'SKIPPED' : 'FAIL';
    const kind = item.ok ? 'good' : item.skipped ? 'warn' : 'bad';
    return `<strong class="${kind}">${esc(label)} • ${esc(item.name || moduleId)}</strong><br>${esc(item.code || '')}${item.providerKind ? ` • ${esc(item.providerKind)}` : ''}${Number.isFinite(item.latencyMs) ? ` • ${esc(item.latencyMs)} ms` : ''}<br>${esc(item.message || '')}`;
  }

  async function inject() {
    if (injecting || !modulesButton.classList.contains('active') || document.getElementById('hostedProviderPanel')) return;
    injecting = true;
    try {
      const state = await api.state();
      if (!modulesButton.classList.contains('active')) return;
      let remote = null;
      try { remote = await api.sentinalProviderConfig(); } catch (error) { remote = { ok: false, message: error.message || String(error) }; }

      const localModules = (state.modules?.modules || []).filter((item) => item.enabled !== false);
      const remoteModules = remote?.backendModules || [];
      const remoteConfigured = remoteModules.filter((item) => item.enabled !== false && item.configured).length;
      const remoteConnected = remoteModules.filter((item) => item.enabled !== false && item.connected).length;
      const secretCount = Array.isArray(remote?.configuredSecrets) ? remote.configuredSecrets.length : 0;
      const available = remote?.ok !== false;
      const anchor = document.getElementById('providerValidationPanel') || content.querySelector('.section-head');
      if (!anchor) return;

      const panel = document.createElement('article');
      panel.id = 'hostedProviderPanel';
      panel.className = 'card';
      panel.innerHTML = `
        <div class="section-head">
          <div><h3>Hosted Sentinal Provider Sync</h3><p>Push the saved module connection settings and provider credentials from Windows protected storage to the paired Railway Sentinal backend.</p></div>
          <span class="badge ${available ? 'good' : 'warn'}">${available ? 'Paired' : 'Unavailable'}</span>
        </div>
        <div class="grid">
          <div><strong>${esc(remoteConfigured)}/${esc(remoteModules.filter((item) => item.enabled !== false).length || localModules.length)}</strong><p class="field-note">hosted providers configured</p></div>
          <div><strong>${esc(remoteConnected)}</strong><p class="field-note">hosted providers reporting live</p></div>
          <div><strong>${esc(secretCount)}</strong><p class="field-note">encrypted provider credentials stored remotely</p></div>
        </div>
        <p class="field-note"><strong>Save local module settings and Credentials first.</strong> Stored secret values are decrypted only in the Electron main process, sent over the authenticated HTTPS pairing channel, encrypted on Railway, and are never exposed to this renderer.</p>
        ${remote?.updatedAt ? `<p class="field-note">Last hosted sync: ${esc(new Date(remote.updatedAt).toLocaleString())}</p>` : ''}
        ${!available ? `<div class="env-hint bad">${esc(remote?.message || remote?.code || 'Pair Hosted Sentinal before syncing providers.')}</div>` : ''}
        <div class="actions"><button id="syncHostedProviders" class="primary" ${available ? '' : 'disabled'}>Sync to Hosted Sentinal</button></div>
        <hr>
        <div class="section-head"><div><h3>Hosted read-only acceptance</h3><p>This probes the Railway backend Sentinal actually uses. It never saves, restarts, shuts down, moderates players, or sends raw console commands.</p></div><span class="badge">Read-only</span></div>
        <div class="form-row"><label class="field"><span>Module</span><select id="hostedValidationModule">${localModules.map((item) => `<option value="${esc(item.id)}" ${item.id === 'palworld' ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label></div>
        <div class="actions"><button id="validateHostedProvider" class="secondary" ${available && localModules.length ? '' : 'disabled'}>Validate hosted provider</button></div>
        <div id="hostedValidationResult" class="env-hint">Palworld is the recommended first live server acceptance target.</div>`;
      anchor.insertAdjacentElement('afterend', panel);

      document.getElementById('syncHostedProviders').onclick = async () => {
        const button = document.getElementById('syncHostedProviders');
        const original = button.textContent;
        button.disabled = true;
        button.textContent = 'Syncing…';
        try {
          const result = await api.sentinalSyncProviders();
          if (result?.ok === false) throw new Error(result.message || result.code || 'Hosted provider sync failed.');
          window.alert('Hosted Sentinal provider configuration synchronized. Provider credentials remain protected and are not shown in the app.');
          panel.remove();
          await inject();
        } catch (error) {
          window.alert(error.message || String(error));
          button.disabled = false;
          button.textContent = original;
        }
      };

      document.getElementById('validateHostedProvider').onclick = async () => {
        const button = document.getElementById('validateHostedProvider');
        const output = document.getElementById('hostedValidationResult');
        const moduleId = document.getElementById('hostedValidationModule').value;
        button.disabled = true;
        output.textContent = 'Running hosted read-only provider probe…';
        try {
          const result = await api.sentinalValidateProvider(moduleId);
          output.innerHTML = validationHtml(result, moduleId);
        } catch (error) {
          output.innerHTML = `<strong class="bad">VALIDATION ERROR</strong><br>${esc(error.message || error)}`;
        } finally {
          button.disabled = false;
        }
      };
    } finally {
      injecting = false;
    }
  }

  const observer = new MutationObserver(() => { if (modulesButton.classList.contains('active')) queueMicrotask(() => inject().catch(() => {})); });
  observer.observe(content, { childList: true, subtree: true });
  modulesButton.addEventListener('click', () => setTimeout(() => inject().catch(() => {}), 50));
  refresh?.addEventListener('click', () => setTimeout(() => inject().catch(() => {}), 150));
})();
