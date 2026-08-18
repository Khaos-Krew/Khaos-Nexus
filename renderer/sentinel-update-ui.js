'use strict';

(() => {
  if (window.__nexusSentinelUpdateUiInstalled) return;
  window.__nexusSentinelUpdateUiInstalled = true;

  const $ = (id) => document.getElementById(id);
  let lastUpdate = null;
  let rollback = { available: false };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  }

  function ensureUi() {
    const settings = document.querySelector('#view-settings .settings-list');
    if (!settings || $('sentinelUpdateSecurity')) return;
    const panel = document.createElement('div');
    panel.id = 'sentinelUpdateSecurity';
    panel.className = 'sentinel-update-security';
    const status = $('updateStatus');
    (status || settings.lastElementChild)?.insertAdjacentElement('afterend', panel);
    render();
  }

  function value(label, value, detail = '') {
    return `<div class="sentinel-update-cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
  }

  function render() {
    const host = $('sentinelUpdateSecurity');
    if (!host) return;
    const update = lastUpdate || {};
    const verified = update.verified ? 'SHA-256 verified' : update.status === 'downloaded' ? 'Verification required' : 'Verified before install';
    const rollbackLabel = rollback.available || update.rollbackAvailable ? 'Armed' : 'Created during update';
    const rollbackVersion = rollback.version || update.rollbackVersion || '';
    host.innerHTML = `
      <div class="sentinel-update-security-heading">
        <div><span class="eyebrow">Protected update pipeline</span><h3>Nexus Sentinel release channel</h3><p>Only dedicated Sentinel releases are accepted. Updates are staged, hash-verified, backed up, startup-health checked, and automatically rolled back if the new build fails.</p></div>
        <span class="tag ${update.verified ? 'good' : ''}">${escapeHtml(update.channel || 'sentinel')}</span>
      </div>
      <div class="sentinel-update-security-grid">
        ${value('Integrity', verified, update.verified ? 'Downloaded executable matches its trusted release digest.' : 'A missing or mismatched digest blocks installation.')}
        ${value('Pre-update backup', update.preUpdateBackup ? 'Verified' : 'Automatic', update.preUpdateBackup || 'Created immediately before installation.')}
        ${value('Rollback', rollbackLabel, rollbackVersion ? `Previous build ${rollbackVersion} is retained as the rollback target.` : 'The running app is snapshotted before replacement.')}
        ${value('Startup gate', 'Required', 'A new build must pass critical startup-health checks before it is accepted.')}
      </div>
      ${update.releaseNotes ? `<details class="sentinel-update-notes"><summary>Release notes</summary><pre>${escapeHtml(update.releaseNotes)}</pre></details>` : ''}`;
  }

  async function refreshRollback() {
    try { rollback = await window.khaos.invoke('update:rollback-status'); }
    catch { rollback = { available: false }; }
    render();
  }

  async function initialize() {
    ensureUi();
    const state = await window.khaos.invoke('app:get-state').catch(() => null);
    lastUpdate = state?.update || null;
    render();
    await refreshRollback();
    window.khaos.onUpdate?.((update) => { lastUpdate = update || null; ensureUi(); render(); if (update?.status === 'complete' || update?.rollbackAvailable) refreshRollback(); });
    window.khaos.onState?.((next) => { if (next?.update) { lastUpdate = next.update; ensureUi(); render(); } });
    window.khaos.onInvokeSuccess?.((event) => {
      if (String(event?.channel || '').startsWith('update:')) setTimeout(refreshRollback, 50);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => initialize().catch(() => {}), { once: true });
  else initialize().catch(() => {});
})();
