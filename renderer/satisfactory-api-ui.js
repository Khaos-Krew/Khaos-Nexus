'use strict';

(() => {
  if (window.__khaosSatisfactoryApiUiInstalled) return;
  window.__khaosSatisfactoryApiUiInstalled = true;

  const $ = (id) => document.getElementById(id);
  let currentState = null;
  let busy = false;

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || '').slice(0, 700);
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 5000);
  }

  function errorMessage(error) {
    return String(error?.message || error || 'Satisfactory operation failed.')
      .replace(/^Error invoking remote method '[^']+':\s*/i, '').slice(0, 1200);
  }

  function installStyle() {
    if (document.querySelector('link[href="satisfactory-api-ui.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'satisfactory-api-ui.css';
    document.head.appendChild(link);
  }

  function ensureGameOption() {
    const game = $('serverGame');
    if (!game || game.querySelector('option[value="satisfactory"]')) return;
    const option = document.createElement('option');
    option.value = 'satisfactory';
    option.textContent = 'Satisfactory Dedicated Server';
    game.appendChild(option);
  }

  function ensureFields() {
    if ($('satisfactoryApiFields')) return;
    const port = $('serverPort');
    const grid = port?.closest('.form-grid');
    if (!grid) return;
    const fields = document.createElement('div');
    fields.id = 'satisfactoryApiFields';
    fields.className = 'satisfactory-api-fields hidden';
    fields.innerHTML = `
      <div class="form-grid three">
        <label>Connection type<input value="Official HTTPS API + UDP query" disabled></label>
        <label>TLS certificate fingerprint<input id="satisfactoryTlsFingerprint" maxlength="95" readonly placeholder="Trust the current certificate after saving"></label>
        <div class="satisfactory-trust-control"><span>Self-signed certificates must be pinned before API use.</span><button class="button" id="satisfactoryTrustCertificateButton" type="button">Trust Current Certificate</button></div>
      </div>
      <div class="callout satisfactory-api-note">Generate a non-expiring application token from the server console with <code>server.GenerateAPIToken</code>. Khaos Nexus stores it in protected desktop storage. The official API uses HTTPS on the game port, normally 7777.</div>`;
    grid.insertAdjacentElement('afterend', fields);
  }

  function buildOperationPanel() {
    if ($('satisfactoryOperationsPanel')) return;
    const editor = $('serverEditor');
    if (!editor) return;
    const panel = document.createElement('article');
    panel.id = 'satisfactoryOperationsPanel';
    panel.className = 'panel satisfactory-operations-panel hidden';
    panel.innerHTML = `
      <div class="panel-heading">
        <div><span class="eyebrow">Official vanilla server API</span><h3>Satisfactory Server Operations</h3><p>Loading-aware status, player counts, options, saves, guarded console commands, and save-first shutdown.</p></div>
        <span class="tag" id="satisfactoryModuleState">Enabled</span>
      </div>
      <div class="satisfactory-operation-grid">
        <div class="satisfactory-operation-controls">
          <label>Satisfactory server<select id="satisfactoryOperationServer"></select></label>
          <div class="satisfactory-operation-row">
            <button class="button" id="satisfactoryStatusButton">Refresh Status</button>
            <button class="button" id="satisfactoryPlayersButton">Player Count</button>
            <button class="button" id="satisfactoryOptionsButton">Server Options</button>
            <button class="button" id="satisfactorySavesButton">List Saves</button>
          </div>
          <div class="satisfactory-operation-row">
            <label>Save name<input id="satisfactorySaveName" maxlength="200" placeholder="Blank creates a timestamped Khaos Nexus save"></label>
            <button class="button" id="satisfactorySaveButton">Save World</button>
          </div>
          <div class="satisfactory-operation-row satisfactory-danger-zone">
            <label>Owner console command<input id="satisfactoryRawCommand" maxlength="1000" placeholder="server.GenerateAPIToken"></label>
            <label>Raw confirmation<input id="satisfactoryRawConfirmation" maxlength="32" placeholder="RUN RAW COMMAND"></label>
            <button class="button danger" id="satisfactoryRawButton">Run Command</button>
          </div>
          <div class="satisfactory-operation-row satisfactory-danger-zone">
            <label>Shutdown confirmation<input id="satisfactoryShutdownConfirmation" maxlength="100" placeholder="Type the exact server name"></label>
            <button class="button danger" id="satisfactoryShutdownButton">Save & Shut Down</button>
          </div>
        </div>
        <pre class="satisfactory-operation-output" id="satisfactoryOperationOutput">Add an enabled Satisfactory server, trust its TLS certificate, and run a status check.</pre>
      </div>`;
    editor.insertAdjacentElement('afterend', panel);
  }

  function updateBaseCopy() {
    const intro = document.querySelector('#view-servers .section-intro p');
    if (intro) intro.textContent = 'Manage ARK, Palworld, Rust WebRCON, Satisfactory HTTPS API, and generic RCON connections directly from the desktop app.';
    const quick = [...document.querySelectorAll('.quick-card')].find((card) => /game servers/i.test(card.textContent || ''));
    const description = quick?.querySelector('span');
    if (description) description.textContent = 'ARK, Palworld, Rust, Satisfactory, and generic servers';
  }

  function selectedGame() { return String($('serverGame')?.value || '').toLowerCase(); }
  function satisfactorySelected() { return selectedGame() === 'satisfactory'; }

  function updateFormMode() {
    const game = selectedGame();
    const satisfactory = game === 'satisfactory';
    $('satisfactoryApiFields')?.classList.toggle('hidden', !satisfactory);
    if (satisfactory) {
      const portLabel = $('serverPort')?.closest('label');
      if (portLabel) portLabel.firstChild.textContent = 'HTTPS / query port';
      const passwordLabel = $('serverPassword')?.closest('label');
      if (passwordLabel) passwordLabel.firstChild.textContent = 'Application token';
      const advanced = $('serverEditor')?.querySelector('details');
      if (advanced) advanced.classList.add('hidden');
      if (!$('serverPort').value) $('serverPort').value = '7777';
    } else if (game !== 'rust') {
      const portLabel = $('serverPort')?.closest('label');
      if (portLabel) portLabel.firstChild.textContent = 'RCON port';
      const passwordLabel = $('serverPassword')?.closest('label');
      if (passwordLabel) passwordLabel.firstChild.textContent = 'RCON password';
      const advanced = $('serverEditor')?.querySelector('details');
      if (advanced) advanced.classList.remove('hidden');
    }
  }

  function enabledServers() {
    return (currentState?.config?.servers || []).filter((server) => String(server.game || '').toLowerCase() === 'satisfactory' && server.enabled !== false);
  }

  function moduleEnabled() {
    const runtime = currentState?.config?.moduleRuntime?.['satisfactory-server-operations'];
    return runtime ? Boolean(runtime.effectiveEnabled) : true;
  }

  function renderOperations() {
    const panel = $('satisfactoryOperationsPanel');
    const select = $('satisfactoryOperationServer');
    if (!panel || !select) return;
    const servers = enabledServers();
    const previous = select.value;
    select.replaceChildren();
    for (const server of servers) {
      const option = document.createElement('option');
      option.value = server.id;
      option.textContent = `${server.name} — HTTPS ${server.host}:${server.port}${server.tlsFingerprint ? ' — pinned' : ' — trust required'}`;
      select.appendChild(option);
    }
    if (servers.some((server) => server.id === previous)) select.value = previous;
    const enabled = moduleEnabled();
    panel.classList.toggle('hidden', servers.length === 0);
    $('satisfactoryModuleState').textContent = enabled ? 'Enabled' : 'Disabled by Owner';
    $('satisfactoryModuleState').classList.toggle('good', enabled);
    panel.querySelectorAll('button, input, select').forEach((element) => { element.disabled = !enabled || servers.length === 0 || busy; });
    if (!servers.length) $('satisfactoryOperationOutput').textContent = 'Add and enable a Satisfactory server to use the official API.';
  }

  async function refreshState() {
    currentState = await window.khaos.invoke('app:get-state');
    renderOperations();
    return currentState;
  }

  async function loadEditorServer(id) {
    const latest = await refreshState();
    const server = latest.config?.servers?.find((item) => item.id === id);
    if (!server || String(server.game || '').toLowerCase() !== 'satisfactory') {
      updateFormMode();
      return;
    }
    $('satisfactoryTlsFingerprint').value = server.tlsFingerprint || '';
    updateFormMode();
  }

  async function saveServer(event) {
    if (!satisfactorySelected()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const server = {
      id: $('serverId').value || undefined,
      name: $('serverName').value,
      game: 'satisfactory',
      enabled: $('serverEnabled').value === 'true',
      host: $('serverHost').value,
      port: Number($('serverPort').value || 7777),
      connectionType: 'https-api',
      protocol: 'https',
      tlsFingerprint: $('satisfactoryTlsFingerprint').value
    };
    try {
      busy = true;
      await window.khaos.invoke('server:save', { server, password: $('serverPassword').value });
      $('serverPassword').value = '';
      $('serverEditor').classList.add('hidden');
      notify('Satisfactory server saved. Trust its certificate before the first API operation.');
      await refreshState();
    } catch (error) {
      notify(errorMessage(error));
      window.khaos.reportRendererActionError?.({ source: 'satisfactory-ui', channel: 'server:save', operation: 'save-satisfactory-server', error });
    } finally {
      busy = false;
      renderOperations();
    }
  }

  function selectedServer() {
    const id = $('satisfactoryOperationServer')?.value;
    const server = enabledServers().find((item) => item.id === id);
    if (!server) throw new Error('Select an enabled Satisfactory server.');
    return server;
  }

  async function trustCertificate() {
    if (busy) return;
    try {
      const server = satisfactorySelected()
        ? currentState?.config?.servers?.find((item) => item.id === $('serverId').value)
        : selectedServer();
      if (!server?.id) throw new Error('Save the Satisfactory server before trusting its certificate.');
      busy = true;
      renderOperations();
      const result = await window.khaos.invoke('server:satisfactory-trust-certificate', { id: server.id });
      $('satisfactoryTlsFingerprint').value = result.fingerprint || '';
      notify(`Trusted ${result.server} certificate ${result.fingerprint}.`);
      await refreshState();
    } catch (error) { notify(errorMessage(error)); }
    finally { busy = false; renderOperations(); }
  }

  async function runAction(action, payload = {}) {
    if (busy) return;
    let server;
    try {
      server = selectedServer();
      busy = true;
      renderOperations();
      $('satisfactoryOperationOutput').textContent = `Running Satisfactory ${action} on ${server.name}…`;
      const response = await window.khaos.invoke('server:satisfactory-action', { id: server.id, action, payload });
      const data = response?.result?.data ?? response?.result ?? response;
      $('satisfactoryOperationOutput').textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      notify(`Satisfactory ${action} completed.`);
      await refreshState();
    } catch (error) {
      $('satisfactoryOperationOutput').textContent = errorMessage(error);
      notify(errorMessage(error));
    } finally {
      busy = false;
      renderOperations();
    }
  }

  function bind() {
    $('serverGame')?.addEventListener('change', updateFormMode);
    $('saveServerButton')?.addEventListener('click', saveServer, true);
    $('satisfactoryTrustCertificateButton')?.addEventListener('click', trustCertificate);
    document.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-server-edit]');
      const add = event.target.closest('#newServerButton');
      if (edit) setTimeout(() => loadEditorServer(edit.dataset.serverEdit).catch(() => updateFormMode()), 0);
      else if (add) setTimeout(() => {
        $('satisfactoryTlsFingerprint').value = '';
        updateFormMode();
      }, 0);
    });
    $('satisfactoryStatusButton')?.addEventListener('click', () => runAction('status'));
    $('satisfactoryPlayersButton')?.addEventListener('click', () => runAction('players'));
    $('satisfactoryOptionsButton')?.addEventListener('click', () => runAction('settings'));
    $('satisfactorySavesButton')?.addEventListener('click', () => runAction('backup'));
    $('satisfactorySaveButton')?.addEventListener('click', () => runAction('save', { saveName: $('satisfactorySaveName').value }));
    $('satisfactoryRawButton')?.addEventListener('click', () => runAction('raw', { command: $('satisfactoryRawCommand').value, confirmation: $('satisfactoryRawConfirmation').value }));
    $('satisfactoryShutdownButton')?.addEventListener('click', () => runAction('shutdown', { saveName: $('satisfactorySaveName').value, saveFirst: true, confirmation: $('satisfactoryShutdownConfirmation').value }));
  }

  function install() {
    installStyle();
    ensureGameOption();
    ensureFields();
    buildOperationPanel();
    updateBaseCopy();
    bind();
    updateFormMode();
    window.khaosStateHub.subscribe((next) => { currentState = next; renderOperations(); });
    refreshState().catch((error) => notify(errorMessage(error)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();