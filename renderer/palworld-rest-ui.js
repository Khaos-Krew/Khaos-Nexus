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
      <div class="palworld-api-heading"><div><span class="eyebrow">Palworld 1.0 management</span><h4>REST API connection</h4></div><span class="tag good">Recommended</span></div>
      <div class="form-grid four">
        <label>Connection type<select id="serverConnectionType"><option value="rest">Palworld REST API</option><option value="rcon">Legacy RCON</option></select></label>
        <label>Protocol<select id="serverProtocol"><option value="http">HTTP</option><option value="https">HTTPS / reverse proxy</option></select></label>
        <label>API username<input id="serverApiUsername" value="admin" autocomplete="username" placeholder="admin"></label>
        <label>API base path<input id="serverApiPath" value="/v1/api" placeholder="/v1/api"></label>
      </div>
      <div class="palworld-security-note"><strong>Security:</strong> Pocketpair recommends keeping this API off the public internet. Use your host’s protected endpoint, firewall rules, VPN, or a secured reverse proxy whenever possible.</div>`;
    editor.insertBefore(block, details);
    updateEditorMode();
  }

  function palworldServers() {
    return (current?.config?.servers || []).filter((server) => String(server.game).toLowerCase() === 'palworld');
  }

  function updateEditorMode(server = null) {
    const isPalworld = $('serverGame')?.value === 'palworld';
    $('palworldRestFields')?.classList.toggle('hidden', !isPalworld);
    const mode = $('serverConnectionType')?.value || server?.connectionType || 'rest';
    const rest = isPalworld && mode !== 'rcon';
    const portInput = $('serverPort');
    const portLabel = portInput?.closest('label');
    if (portLabel) {
      const text = rest ? 'REST API port' : 'RCON port';
      for (const node of [...portLabel.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE) node.textContent = text;
      }
    }
    const passwordLabel = $('serverPassword')?.closest('label');
    if (passwordLabel) {
      for (const node of [...passwordLabel.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE) node.textContent = rest ? 'AdminPassword / API password' : 'RCON password';
      }
    }
    if (rest && portInput && !portInput.value) portInput.placeholder = '8212';
  }

  function populateRestFields(server = {}) {
    ensureEditorFields();
    $('serverConnectionType').value = server.connectionType === 'rcon' ? 'rcon' : 'rest';
    $('serverProtocol').value = server.protocol === 'https' ? 'https' : 'http';
    $('serverApiUsername').value = server.username || 'admin';
    $('serverApiPath').value = server.apiPath || '/v1/api';
    updateEditorMode(server);
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
      <div class="panel-heading"><div><span class="eyebrow">Palworld REST API</span><h3>Palworld Operations Center</h3><p>Read server state, save the world, message players, moderate accounts, and perform controlled shutdowns.</p></div><span class="severity good" id="palworldApiState">Ready</span></div>
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
        <section class="danger-zone"><h4>Controlled shutdown</h4><div class="form-grid"><label>Delay in seconds<input id="palworldShutdownSeconds" type="number" min="5" max="3600" value="30"></label><label>Type server name to confirm<input id="palworldShutdownConfirm" placeholder="Exact server name"></label></div><label>Shutdown message<input id="palworldShutdownMessage" value="Server maintenance is starting."></label><button class="button danger" id="palworldShutdownButton">Schedule Shutdown</button></section>
        <section class="danger-zone"><h4>Emergency force stop</h4><p>This does not wait for players and should only be used when graceful shutdown is impossible.</p><label>Type FORCE STOP<input id="palworldForceStopConfirm" placeholder="FORCE STOP"></label><button class="button danger" id="palworldForceStopButton">Force Stop Server</button></section>
      </div>`;
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
      ? servers.map((server) => `<option value="${escapeHtml(server.id)}">${escapeHtml(server.name)} — ${server.connectionType === 'rcon' ? 'Legacy RCON' : 'REST'} ${escapeHtml(server.host)}:${server.port}</option>`).join('')
      : '<option value="">No Palworld server configured</option>';
    if (servers.some((server) => server.id === previous)) select.value = previous;
    const active = selectedServer();
    $('palworldApiState').textContent = !active ? 'Not Configured' : active.connectionType === 'rcon' ? 'Legacy RCON' : active.enabled === false ? 'Disabled' : 'REST Ready';
    $('palworldApiState').className = `severity ${active && active.connectionType !== 'rcon' ? 'good' : 'bad'}`;
    panelButtonsEnabled(Boolean(active && active.connectionType !== 'rcon'));
  }

  function panelButtonsEnabled(enabled) {
    document.querySelectorAll('#palworldOperations button').forEach((button) => { button.disabled = !enabled; });
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
    notify(`Palworld ${action} completed for ${server.name}.`);
    return response;
  }

  function bind() {
    $('serverGame')?.addEventListener('change', updateEditorMode);
    $('serverConnectionType')?.addEventListener('change', updateEditorMode);

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
        connectionType: $('serverConnectionType').value,
        protocol: $('serverProtocol').value,
        username: $('serverApiUsername').value,
        apiPath: $('serverApiPath').value,
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
      notify('Palworld server saved with REST API settings.');
    }, true);

    $('serverList')?.addEventListener('click', async (event) => {
      const test = event.target.closest('[data-server-test]');
      if (!test) return;
      const server = current?.config?.servers?.find((item) => item.id === test.dataset.serverTest);
      if (!server || server.game !== 'palworld' || server.connectionType === 'rcon') return;
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
    window.khaos.onState(render);
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
