'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  let current = null;

  function notify(message) {
    const element = $('toast');
    if (!element) return;
    element.textContent = String(message);
    element.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => element.classList.remove('show'), 4200);
  }

  async function invoke(channel, payload) {
    try { return await window.khaos.invoke(channel, payload); }
    catch (error) { notify(error.message || String(error)); throw error; }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function pretty(value) {
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  }

  function ensureStyles() {
    if (document.querySelector('link[href="palworld-rest-ui.css"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'palworld-rest-ui.css';
    document.head.appendChild(link);
  }

  function ensureEditorFields() {
    const editor = $('serverEditor');
    if (!editor || $('palworldRestFields')) return;
    const details = editor.querySelector('details');
    const block = document.createElement('div');
    block.id = 'palworldRestFields';
    block.className = 'palworld-rest-fields';
    block.innerHTML = `
      <div class="palworld-api-heading"><div><span class="eyebrow">Palworld primary control</span><h4>REST API connection</h4></div><span class="tag good">Required</span></div>
      <div class="form-grid three">
        <label>Protocol<select id="serverProtocol"><option value="http">HTTP</option><option value="https">HTTPS / reverse proxy</option></select></label>
        <label>API username<input id="serverApiUsername" value="admin" autocomplete="username" placeholder="admin"></label>
        <label>API base path<input id="serverApiPath" value="/v1/api" placeholder="/v1/api"></label>
      </div>
      <div class="palworld-security-note"><strong>REST is authoritative:</strong> Khaos Nexus uses the Palworld REST API for normal status, player, save, moderation, and shutdown operations. The server password field is the protected Palworld AdminPassword used for REST authentication.</div>
      <div class="palworld-api-heading"><div><span class="eyebrow">Compatibility / testing</span><h4>Optional RCON endpoint</h4></div><span class="tag">Optional</span></div>
      <label class="toggle-row"><span><strong>Enable optional RCON compatibility/testing</strong><small>REST remains required and authoritative. RCON is only a secondary endpoint for compatibility tests and commands you explicitly run.</small></span><input id="serverRconEnabled" type="checkbox"></label>
      <div class="form-grid two" id="serverRconFields">
        <label>RCON host override<input id="serverRconHost" placeholder="Blank = use REST host"></label>
        <label>RCON port<input id="serverRconPort" type="number" min="1" max="65535" value="25575" placeholder="25575"></label>
      </div>
      <div class="palworld-security-note"><strong>Compatibility note:</strong> Optional RCON reuses the same protected Palworld AdminPassword. Keep it disabled unless your host exposes RCON and you want to test that path.</div>`;
    editor.insertBefore(block, details);
    updateEditorMode();
  }

  function palworldServers() {
    return (current?.config?.servers || []).filter((server) => String(server.game).toLowerCase() === 'palworld');
  }

  function updateRconEditorState() {
    const enabled = Boolean($('serverRconEnabled')?.checked);
    $('serverRconFields')?.classList.toggle('disabled', !enabled);
    ['serverRconHost', 'serverRconPort'].forEach((id) => {
      if ($(id)) $(id).disabled = !enabled;
    });
  }

  function updateEditorMode() {
    const isPalworld = $('serverGame')?.value === 'palworld';
    $('palworldRestFields')?.classList.toggle('hidden', !isPalworld);
    const portInput = $('serverPort');
    const portLabel = portInput?.closest('label');
    if (portLabel && isPalworld) {
      for (const node of [...portLabel.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE) node.textContent = 'REST API port';
      }
    }
    const passwordLabel = $('serverPassword')?.closest('label');
    if (passwordLabel && isPalworld) {
      for (const node of [...passwordLabel.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE) node.textContent = 'AdminPassword / API password';
      }
    }
    if (isPalworld && portInput && !portInput.value) portInput.placeholder = '8212';
    updateRconEditorState();
  }

  function populateRestFields(server = {}) {
    ensureEditorFields();
    $('serverProtocol').value = server.protocol === 'https' ? 'https' : 'http';
    $('serverApiUsername').value = server.username || 'admin';
    $('serverApiPath').value = server.apiPath || '/v1/api';
    $('serverRconEnabled').checked = Boolean(server.rconEnabled);
    $('serverRconHost').value = server.rconHost || '';
    $('serverRconPort').value = server.rconPort || 25575;
    updateEditorMode();
    if (server.restNeedsVerification) notify('This server was migrated from legacy RCON. Verify the REST host/port before using production controls.');
  }

  function normalizeAddress(hostValue, portValue) {
    let host = String(hostValue || '').trim();
    let port = Number(portValue || 0);
    try {
      if (/^https?:\/\//i.test(host)) {
        const parsed = new URL(host);
        host = parsed.hostname;
        if (!port && parsed.port) port = Number(parsed.port);
      } else {
        const match = host.match(/^([^:]+):(\d+)$/);
        if (match) {
          host = match[1];
          if (!port) port = Number(match[2]);
        }
      }
    } catch {}
    return { host, port };
  }

  function ensureOperations() {
    const view = $('view-servers');
    if (!view || $('palworldOperations')) return;
    const panel = document.createElement('article');
    panel.id = 'palworldOperations';
    panel.className = 'panel palworld-operations';
    panel.innerHTML = `
      <div class="panel-heading"><div><span class="eyebrow">Palworld REST API</span><h3>Palworld Operations Center</h3><p>REST is the required production control path. Optional RCON can be tested independently below.</p></div><span class="severity good" id="palworldApiState">Ready</span></div>
      <div class="palworld-toolbar">
        <label>Palworld server<select id="palworldServerSelect"></select></label>
        <button class="button" data-pal-read="status">Overview</button>
        <button class="button" data-pal-read="players">Players</button>
        <button class="button" data-pal-read="settings">Settings</button>
        <button class="button" data-pal-read="metrics">Metrics</button>
        <button class="button" data-pal-read="game-data-summary">World Summary</button>
        <button class="button" data-pal-read="game-data-export">Export Snapshot</button>
      </div>
      <pre class="palworld-output" id="palworldOutput">Select a configured Palworld REST server and run an operation.</pre>
      <div class="palworld-action-grid">
        <section><h4>World operations</h4><label>Announcement<textarea id="palworldAnnouncement" rows="3" placeholder="Message shown to connected players"></textarea></label><div class="form-actions"><button class="button primary" id="palworldAnnounceButton">Announce</button><button class="button" id="palworldSaveButton">Save World</button></div></section>
        <section><h4>Player moderation</h4><label>Player name or user ID<input id="palworldPlayerId" placeholder="steam_... or connected player name"></label><label>Optional reason<input id="palworldModerationMessage" placeholder="Reason shown to the player"></label><div class="form-actions"><button class="button" id="palworldKickButton">Kick</button><button class="button danger" id="palworldBanButton">Ban</button><button class="button" id="palworldUnbanButton">Unban</button></div></section>
        <section class="danger-zone"><h4>Controlled REST shutdown</h4><div class="form-grid"><label>Delay in seconds<input id="palworldShutdownSeconds" type="number" min="5" max="3600" value="30"></label><label>Type server name to confirm<input id="palworldShutdownConfirm" placeholder="Exact server name"></label></div><label>Shutdown message<input id="palworldShutdownMessage" value="Server maintenance is starting."></label><button class="button danger" id="palworldShutdownButton">Schedule Shutdown</button></section>
        <section class="danger-zone"><h4>Emergency REST force stop</h4><p>This does not wait for players and should only be used when graceful shutdown is impossible.</p><label>Type FORCE STOP<input id="palworldForceStopConfirm" placeholder="FORCE STOP"></label><button class="button danger" id="palworldForceStopButton">Force Stop Server</button></section>
      </div>
      <section class="danger-zone" id="palworldRconConsole">
        <div class="panel-heading"><div><span class="eyebrow">Optional secondary transport</span><h4>RCON Compatibility Test</h4><p>Use this to verify the RCON endpoint exposed by your host. These tests never replace REST as the primary connection.</p></div><span class="severity" id="palworldRconState">Disabled</span></div>
        <div class="form-actions">
          <button class="button" data-pal-rcon="Info">RCON Info</button>
          <button class="button" data-pal-rcon="ShowPlayers">RCON Players</button>
          <button class="button" data-pal-rcon="Save">RCON Save</button>
        </div>
        <div class="form-grid two">
          <label>RCON command<input id="palworldRconCommand" placeholder="Example: Broadcast Nexus RCON test"></label>
          <label>Confirmation for destructive/raw commands<input id="palworldRconConfirm" placeholder="Exact server name when required"></label>
        </div>
        <button class="button danger" id="palworldRconRun">Run RCON Command</button>
        <pre class="palworld-output" id="palworldRconOutput">Enable optional RCON on the selected Palworld server to test it.</pre>
      </section>`;
    view.appendChild(panel);
  }

  function selectedServer() {
    const id = $('palworldServerSelect')?.value;
    return palworldServers().find((server) => server.id === id);
  }

  function render(next) {
    current = next;
    ensureEditorFields();
    ensureOperations();
    const select = $('palworldServerSelect');
    if (!select) return;
    const previous = select.value;
    const servers = palworldServers();
    select.innerHTML = servers.length
      ? servers.map((server) => `<option value="${escapeHtml(server.id)}">${escapeHtml(server.name)} — REST ${escapeHtml(server.host)}:${server.port}${server.rconEnabled ? ` + RCON ${escapeHtml(server.rconHost || server.host)}:${server.rconPort || 25575}` : ''}</option>`).join('')
      : '<option value="">No Palworld server configured</option>';
    if (servers.some((server) => server.id === previous)) select.value = previous;
    const active = selectedServer();
    $('palworldApiState').textContent = !active ? 'Not Configured' : active.enabled === false ? 'Disabled' : active.restNeedsVerification ? 'Verify REST' : 'REST Required';
    $('palworldApiState').className = `severity ${active && active.enabled !== false && !active.restNeedsVerification ? 'good' : 'bad'}`;
    restButtonsEnabled(Boolean(active));
    const rconReady = Boolean(active?.rconEnabled);
    $('palworldRconState').textContent = !active ? 'No Server' : rconReady ? `RCON ${active.rconHost || active.host}:${active.rconPort || 25575}` : 'Disabled';
    $('palworldRconState').className = `severity ${rconReady ? 'good' : ''}`;
    rconButtonsEnabled(rconReady);
  }

  function restButtonsEnabled(enabled) {
    document.querySelectorAll('#palworldOperations > .palworld-toolbar button, #palworldOperations > .palworld-action-grid button').forEach((button) => { button.disabled = !enabled; });
  }

  function rconButtonsEnabled(enabled) {
    document.querySelectorAll('#palworldRconConsole button').forEach((button) => { button.disabled = !enabled; });
    ['palworldRconCommand', 'palworldRconConfirm'].forEach((id) => { if ($(id)) $(id).disabled = !enabled; });
  }

  async function runAction(action, payload = {}) {
    const server = selectedServer();
    if (!server) throw new Error('Select a Palworld REST server first.');
    $('palworldOutput').textContent = `Running ${action} on ${server.name}…`;
    const response = await invoke('server:palworld-action', { id: server.id, action, payload });
    if (response?.canceled) {
      $('palworldOutput').textContent = 'Export canceled.';
      return response;
    }
    $('palworldOutput').textContent = pretty(response?.result ?? response);
    notify(`Palworld REST ${action} completed for ${server.name}.`);
    return response;
  }

  async function runRcon(command, confirmation = '') {
    const server = selectedServer();
    if (!server) throw new Error('Select a Palworld server first.');
    if (!server.rconEnabled) throw new Error('Enable optional RCON for this Palworld server first.');
    const text = String(command || '').trim();
    if (!text) throw new Error('Enter an RCON command first.');
    $('palworldRconOutput').textContent = `Running RCON ${text} on ${server.name}…`;
    const response = await invoke('server:palworld-rcon-command', {
      id: server.id,
      command: text,
      confirmation: String(confirmation || '').trim()
    });
    $('palworldRconOutput').textContent = pretty(response?.result ?? response);
    notify(`Palworld RCON ${response?.kind || 'command'} completed for ${server.name}.`);
    return response;
  }

  function bind() {
    $('serverGame')?.addEventListener('change', updateEditorMode);
    $('serverRconEnabled')?.addEventListener('change', updateRconEditorState);

    document.addEventListener('click', (event) => {
      const add = event.target.closest('#newServerButton');
      const edit = event.target.closest('[data-server-edit]');
      if (add) setTimeout(() => populateRestFields({}), 0);
      if (edit) {
        const server = current?.config?.servers?.find((item) => item.id === edit.dataset.serverEdit);
        setTimeout(() => populateRestFields(server || {}), 0);
      }
    });

    $('saveServerButton')?.addEventListener('click', async (event) => {
      if ($('serverGame')?.value !== 'palworld') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const address = normalizeAddress($('serverHost').value, $('serverPort').value);
      const server = {
        id: $('serverId').value || undefined,
        name: $('serverName').value,
        game: 'palworld',
        enabled: $('serverEnabled').value === 'true',
        host: address.host,
        port: address.port,
        connectionType: 'rest',
        protocol: $('serverProtocol').value,
        username: $('serverApiUsername').value,
        apiPath: $('serverApiPath').value,
        rconEnabled: $('serverRconEnabled').checked,
        rconHost: $('serverRconHost').value,
        rconPort: Number($('serverRconPort').value || 25575),
        statusCommand: $('statusCommand').value,
        playersCommand: $('playersCommand').value,
        saveCommand: $('saveCommand').value,
        broadcastCommand: $('broadcastCommand').value,
        kickCommand: $('kickCommand').value,
        banCommand: $('banCommand').value
      };
      await invoke('server:save', { server, password: $('serverPassword').value });
      $('serverEditor').classList.add('hidden');
      render(await invoke('app:get-state'));
      notify(`Palworld server saved. REST required${server.rconEnabled ? '; optional RCON enabled.' : '.'}`);
    }, true);

    $('serverList')?.addEventListener('click', async (event) => {
      const test = event.target.closest('[data-server-test]');
      if (!test) return;
      const server = current?.config?.servers?.find((item) => item.id === test.dataset.serverTest);
      if (!server || server.game !== 'palworld') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const result = await invoke('server:test', server.id);
      notify(`Palworld REST connection succeeded: ${String(result?.result || 'online').slice(0, 180)}`);
    }, true);

    document.querySelectorAll('[data-pal-read]').forEach((button) => button.addEventListener('click', () => runAction(button.dataset.palRead)));
    $('palworldAnnounceButton').addEventListener('click', () => runAction('announce', { message: $('palworldAnnouncement').value }));
    $('palworldSaveButton').addEventListener('click', () => runAction('save'));
    $('palworldKickButton').addEventListener('click', () => runAction('kick', { player: $('palworldPlayerId').value, message: $('palworldModerationMessage').value }));
    $('palworldBanButton').addEventListener('click', () => runAction('ban', { player: $('palworldPlayerId').value, message: $('palworldModerationMessage').value }));
    $('palworldUnbanButton').addEventListener('click', () => runAction('unban', { player: $('palworldPlayerId').value }));
    $('palworldShutdownButton').addEventListener('click', () => runAction('shutdown', {
      waittime: $('palworldShutdownSeconds').value,
      message: $('palworldShutdownMessage').value,
      confirmation: $('palworldShutdownConfirm').value
    }));
    $('palworldForceStopButton').addEventListener('click', () => runAction('stop', { confirmation: $('palworldForceStopConfirm').value }));
    document.querySelectorAll('[data-pal-rcon]').forEach((button) => button.addEventListener('click', () => runRcon(button.dataset.palRcon)));
    $('palworldRconRun').addEventListener('click', () => runRcon($('palworldRconCommand').value, $('palworldRconConfirm').value));
    $('palworldServerSelect').addEventListener('change', () => render(current));
    window.khaosStateHub.subscribe(render);
  }

  async function initialize() {
    ensureStyles();
    ensureEditorFields();
    ensureOperations();
    bind();
    render(await invoke('app:get-state'));
  }

  initialize().catch((error) => notify(`Palworld REST UI failed: ${error.message}`));
})();
