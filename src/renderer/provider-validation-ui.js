'use strict';

(() => {
  const api = window.nexusAdmin;
  const content = document.getElementById('content');
  const navButton = document.querySelector('nav button[data-view="modules"]');
  const refreshButton = document.getElementById('refresh');
  if (!api?.validateProviders || !content || !navButton) return;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  async function inject() {
    if (!navButton.classList.contains('active') || document.getElementById('providerValidationPanel')) return;
    const state = await api.state();
    const modules = (state.modules?.modules || []).filter((item) => item.enabled);
    const anchor = content.querySelector('.section-head');
    if (!anchor) return;

    const panel = document.createElement('article');
    panel.id = 'providerValidationPanel';
    panel.className = 'card';
    panel.innerHTML = `
      <div class="section-head">
        <div><h3>Live Provider Validation</h3><p>Runs one predefined read-only viewer probe. It never saves, restarts, shuts down, moderates players, or runs raw console commands.</p></div>
        <span class="badge">Read-only</span>
      </div>
      <div class="form-row">
        <label class="field"><span>Module</span><select id="providerValidationModule">${modules.map((item) => `<option value="${esc(item.id)}" ${item.id === 'palworld' ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>
      </div>
      <div class="actions"><button id="runProviderValidation" class="primary">Validate selected provider</button></div>
      <div id="providerValidationResult" class="env-hint">Choose a configured module. Palworld is the first recommended live acceptance target.</div>`;
    anchor.insertAdjacentElement('afterend', panel);

    document.getElementById('runProviderValidation').onclick = async () => {
      const button = document.getElementById('runProviderValidation');
      const output = document.getElementById('providerValidationResult');
      const moduleId = document.getElementById('providerValidationModule').value;
      button.disabled = true;
      output.textContent = 'Running read-only provider probe…';
      try {
        const report = await api.validateProviders(moduleId);
        const result = report.results?.[0];
        if (!result) throw new Error('Nexus Backend returned no provider validation result.');
        const status = result.ok ? 'PASS' : result.skipped ? 'SKIPPED' : 'FAIL';
        output.innerHTML = `<strong class="${result.ok ? 'good' : result.skipped ? 'warn' : 'bad'}">${esc(status)} • ${esc(result.name || moduleId)}</strong><br>${esc(result.code)}${result.providerKind ? ` • ${esc(result.providerKind)}` : ''}${Number.isFinite(result.latencyMs) ? ` • ${esc(result.latencyMs)} ms` : ''}<br>${esc(result.message || '')}`;
      } catch (error) {
        output.innerHTML = `<strong class="bad">VALIDATION ERROR</strong><br>${esc(error.message || error)}`;
      } finally {
        button.disabled = false;
      }
    };
  }

  navButton.addEventListener('click', () => queueMicrotask(() => inject().catch(() => {})));
  refreshButton?.addEventListener('click', () => setTimeout(() => inject().catch(() => {}), 100));
  if (navButton.classList.contains('active')) inject().catch(() => {});
})();
