'use strict';

(() => {
  if (window.__khaosRustWebRconUiInstalled) return;
  window.__khaosRustWebRconUiInstalled = true;

  const $ = (id) => document.getElementById(id);
  let currentState = null;
  let busy = false;

  function notify(message) {
    const toast = $('toast');
    if (!toast) return;
    toast.textContent = String(message || '').slice(0, 500);
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  function errorMessage(error) {
    return String(error?.message || error || 'Rust operation failed.').replace(/^Error invoking remote method '[^']+':\s*/i, '').slice(0, 1000);
  }

  function installStyle() {
    if (document.querySelector('link[href="rust-webrcon-ui.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'rust-webrcon-ui.css';
    document.head.appendChild(link);
  }

  function ensureRustOption() {
    const game = $('serverGame');
    if (!game || game.querySelector('option[value="rust"]')) return;
    const option = document.createElement('option');
    option.value = 'rust';
    option.textContent = 'Rust Dedicated Server';
    game.appendChild(option);
  }

  function ensureRustFields() {
    if ($('rustWebRconFields')) return;
    const port = $('serverPort');
    const connectionGrid = port?.closest('.form-grid');
    if (!connectionGrid) return;

    const fields = document.createElement('div');
    fields.id = 'rustWebRconFields';
    fields.className = 'form-grid three rust-webrcon-fields hidden';

    const protocolLabel = document.createElement('label');
    protocolLabel.textContent = 'WebSocket protocol';
    const protocol = document.createElement('select');
    protocol.id = 'rustProtocol';
    for (const [value, label] of [['ws', 'ws — Standard WebRCON'], ['wss', 'wss — TLS reverse proxy']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      protocol.appendChild(option);
    }
    protocolLabel.appendChild(protocol);

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'RCON client name';
    const name = document.createElement('input');
    name.id = 'rustRconName';
    name.maxLength = 60;
    name.placeholder = 'Khaos Nexus';
    nameLabel.appendChild(name);

    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Connection type';
    const type = document.createElement('input');
    type.value = 'Rust WebRCON';
    type.disabled = true;
    typeLabel.appendChild(type);

    const note = document.createElement('div');
    note.className = 'callout rust-webrcon-note';
    note.textContent = 'Rust must be started with rcon.web 1. Standard ws traffic is not encrypted; use firewall restrictions or a trusted wss reverse proxy. Khaos Nexus never disables TLS certificate validation.';

    fields.append(protocolLabel, nameLabel, typeLabel, note);
    connectionGrid.insertAdjacentElement('afterend', fields);
  }

  function buildOperationPanel() {
    if ($('rustOperationsPanel')) return;
    const editor = $('serverEditor');
    if (!editor) return;

    const panel = document.createElement('article');
    panel.id = 'rustOperationsPanel';
    panel.className = 'panel rust-operations-panel hidden';
    panel.innerHTML = `
      <div class="panel-heading">
        <div><span class="eyebrow">Vanilla-safe adapter</span><h3>Rust WebRCON Operations</h3><p>Status, players, saves, announcements, moderation support, and guarded Owner console access.</p></div>
        <span class="tag" id="rustModuleState">Enabled</span>
      </div>
      <div class="rust-operation-grid">
        <div class="rust-operation-controls">
          <label>Rust server<select id="rustOperationServer"></select></label>
          <div class="rust-operation-row">
            <button class="button" id="rustStatusButton">Refresh Status</button>
            <button class="button" id="rustPlayersButton">Show Players</button>
            <button class="button" id="rustSaveButton">Save World</button>
          </div>
          <div class="rust-operation-row">
            <label>Server announcement<input id="rustAnnouncement" maxlength="500" placeholder="Maintenance begins in 10 minutes"></label>
            <button class="button" id="rustAnnounceButton">Broadcast</button>
          </div>
          <div class="rust-operation-row rust-danger-zone">
            <label>Owner raw command<input id="rustRawCommand" maxlength="1000" placeholder="serverinfo"></label>
            <label>Raw confirmation<input id="rustRawConfirmation" maxlength="32" placeholder="RUN RAW COMMAND"></label>
            <button class="button danger" id="rustRawButton">Run Raw</button>
          </div>
          <div class="rust-operation-row rust-danger-zone">
            <label>Shutdown confirmation<input id="rustShutdownConfirmation" maxlength="100" placeholder="Type the exact server name"></label>
            <button class="button danger" id="rustShutdownButton">Save & Shut Down</button>
          </div>
        </div>
        <pre class="rust-operation-output" id="rustOperationOutput">Choose an enabled Rust server, then run a status or player check.</pre>
      </div>`;
    editor.insertAdjacentElement('afterend', panel);
  }

  function updateBaseCopy() {
    const intro = document.querySelector('#view-servers .section-intro p');
    if (intro) intro.textContent = 'Manage ARK, Palworld, Rust WebRCON, and generic RCON connections directly from the desktop app.';
    const quick = [...document.querySelectorAll('.quick-card')].find((card) => /game servers/i.test(card.textContent || ''));
    const description = quick?.querySelector('span');
    if (description) description.textContent = 'ARK, Palworld, Rust WebRCON, and generic RCON';
  }

  function rustSelected() {
    return $('serverGame')?.value === 'rust';
  }

  function updateFormMode() {
    const rust = rustSelected();
    $('rustWebRconFields')?.classList.toggle('hidden', !rust);
    const portLabel = $('serverPort')?.closest('label');
    if (portLabel) portLabel.firstChild.textContent = rust ? 'WebRCON port' : 'RCON port';
    const passwordLabel = $('serverPassword')?.closest('label');
    if (passwordLabel) passwordLabel.firstChild.textContent = rust ? 'WebRCON password' : 'RCON password';
    const advanced = $('serverEditor')?.querySelector('details');
    if (advanced) advanced.classList.toggle('hidden', rust);
    if (rust) {
      if (!$('serverPort').value) $('serverPort').value = '28016';
      if (!$('rustRconName').value) $('rustRconName').value = 'Khaos Nexus';
    }
  }

  function enabledRustServers() {
    return (currentState?.config?.servers || []).filter((server) => String(server.game || '').toLowerCase() === 'rust' && server.enabled !== false);
  }

  function rustModuleEnabled() {
    const runtime = currentState?.config?.moduleRuntime?.['rust-server-operations'];
    return runtime ? Boolean(runtime.effectiveEnabled) : true;
  }

  function renderOperations() {
    const panel = $('rustOperationsPanel');
    const select = $('rustOperationServer');
    if (!panel || !select) return;
    const servers = enabledRustServers();
    const previous = select.value;
    select.replaceChildren();
    for (const server of servers) {
      const option = document.createElement('option');
      option.value = server.id;
      option.textContent = `${server.name} — ${server.protocol === 'wss' ? 'WSS' : 'WS'} ${server.host}:${server.port}`;
      select.appendChild(option);
    }
    if (servers.some((server) => server.id === previous)) select.value = previous;
    const enabled = rustModuleEnabled();
    panel.classList.toggle('hidden', servers.length === 0);
    $('rustModuleState').textContent = enabled ? 'Enabled' : 'Disabled by Owner';
    $('rustModuleState').classList.toggle('good', enabled);
    panel.querySelectorAll('button, input, select').forEach((element) => { element.disabled = !enabled || servers.length === 0 || busy; });
    if (!servers.length) $('rustOperationOutput').textContent = 'Add and enable a Rust server to use WebRCON operations.';
  }

  async function refreshState() {
    currentState = await window.khaos.invoke('app:get-state');
    renderOperations();
    return currentState;
  }

  async function loadEditorServer(id) {
    const latest = await refreshState();
    const server = latest.config?.servers?.find((item) => item.id === id);
    if (!server || String(server.game || '').toLowerCase() !== 'rust') {
      updateFormMode();
      return;
    }
    $('rustProtocol').value = server.protocol === 'wss' ? 'wss' : 'ws';
    $('rustRconName').value = server.rconName || 'Khaos Nexus';
    updateFormMode();
  }

  async function saveRustServer(event) {
    if (!rustSelected()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const server = {
      id: $('serverId').value || undefined,
      name: $('serverName').value,
      game: 'rust',
      enabled: $('serverEnabled').value === 'true',
      host: $('serverHost').value,
      port: Number($('serverPort').value),
      connectionType: 'webrcon',
      protocol: $('rustProtocol').value,
      rconName: $('rustRconName').value
    };
    try {
      busy = true;
      await window.khaos.invoke('server:save', { server, password: $('serverPassword').value });
      $('serverPassword').value = '';
      $('serverEditor').classList.add('hidden');
      notify('Rust WebRCON server saved.');
      await refreshState();
    } catch (error) {
      notify(errorMessage(error));
      window.khaos.reportRendererActionError?.({ source: 'rust-ui', channel: 'server:save', operation: 'save-rust-server', error });
    } finally {
      busy = false;
      renderOperations();
    }
  }

  function selectedServer() {
    const id = $('rustOperationServer')?.value;
    const server = enabledRustServers().find((item) => item.id === id);
    if (!server) throw new Error('Select an enabled Rust server.');
    return server;
  }

  async function runAction(action, payload = {}) {
    if (busy) return;
    let server;
    try {
      server = selectedServer();
      busy = true;
      renderOperations();
      $('rustOperationOutput').textContent = `Running Rust ${action} on ${server.name}…`;
      const response = await window.khaos.invoke('server:rust-action', { id: server.id, action, payload });
      const data = response?.result?.data ?? response?.result ?? response;
      $('rustOperationOutput').textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      notify(`Rust ${action} completed.`);
      await refreshState();
    } catch (error) {
      $('rustOperationOutput').textContent = errorMessage(error);
      notify(errorMessage(error));
    } finally {
      busy = false;
      renderOperations();
    }
  }

  function bind() {
    $('serverGame')?.addEventListener('change', updateFormMode);
    $('saveServerButton')?.addEventListener('click', saveRustServer, true);

    document.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-server-edit]');
      const add = event.target.closest('#newServerButton');
      if (edit) setTimeout(() => loadEditorServer(edit.dataset.serverEdit).catch(() => updateFormMode()), 0);
      else if (add) setTimeout(() => {
        $('rustProtocol').value = 'ws';
        $('rustRconName').value = 'Khaos Nexus';
        updateFormMode();
      }, 0);
    });

    $('rustStatusButton')?.addEventListener('click', () => runAction('status'));
    $('rustPlayersButton')?.addEventListener('click', () => runAction('players'));
    $('rustSaveButton')?.addEventListener('click', () => runAction('save'));
    $('rustAnnounceButton')?.addEventListener('click', () => runAction('announce', { message: $('rustAnnouncement').value }));
    $('rustRawButton')?.addEventListener('click', () => runAction('raw', { command: $('rustRawCommand').value, confirmation: $('rustRawConfirmation').value }));
    $('rustShutdownButton')?.addEventListener('click', () => runAction('shutdown', { confirmation: $('rustShutdownConfirmation').value }));
  }

  function install() {
    installStyle();
    ensureRustOption();
    ensureRustFields();
    buildOperationPanel();
    updateBaseCopy();
    bind();
    updateFormMode();
    window.khaos.onState((next) => {
      currentState = next;
      renderOperations();
    });
    refreshState().catch((error) => notify(errorMessage(error)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();