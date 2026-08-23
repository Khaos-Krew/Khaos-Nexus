'use strict';

const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const content = document.getElementById('content');
const health = document.getElementById('health');
const sideDot = document.getElementById('sideDot');
const sideStatus = document.getElementById('sideStatus');
const toast = document.getElementById('toast');
const refreshButton = document.getElementById('refresh');

let state = null;
let draft = null;
let currentView = 'overview';
let toastTimer = null;

const api = window.nexusAdmin;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const clone = (value) => JSON.parse(JSON.stringify(value));
const human = (value) => String(value || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

function notify(message, kind = 'good') {
  toast.textContent = message;
  toast.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3600);
}

function statusClass(ok) { return ok ? 'good' : 'bad'; }
function badge(text, kind = '') { return `<span class="badge ${kind}">${esc(text)}</span>`; }
function button(label, id, extra = '') { return `<button id="${esc(id)}" ${extra}>${esc(label)}</button>`; }
function card(titleText, body, extra = '') { return `<article class="card ${extra}"><h3>${esc(titleText)}</h3>${body}</article>`; }
function grid(items) { return `<div class="grid">${items.join('')}</div>`; }

function updateStatus() {
  const ok = Boolean(state?.backend?.ok);
  health.textContent = ok ? `Backend online • ${state.backendMode}` : 'Backend offline';
  health.className = `pill ${ok ? 'good' : 'bad'}`;
  sideDot.className = `dot ${ok ? 'online' : 'offline'}`;
  sideStatus.textContent = ok ? `Local backend • ${state.backendMode}` : state?.backendError || state?.backend?.message || 'Backend offline';
}

async function refreshState({ render = true, resetDraft = true } = {}) {
  state = await api.state();
  if (resetDraft || !draft) draft = clone(state.settings || {});
  updateStatus();
  if (render) show(currentView);
  return state;
}

function manifest(moduleId) {
  return (state?.modules?.modules || []).find((item) => item.id === moduleId) || null;
}

function pathParts(pathValue) {
  return String(pathValue || '').split('.').filter(Boolean).map((part) => /^\d+$/.test(part) ? Number(part) : part);
}

function setDraftValue(pathValue, value) {
  const parts = pathParts(pathValue);
  let target = draft;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (target[part] === undefined || target[part] === null) target[part] = typeof parts[index + 1] === 'number' ? [] : {};
    target = target[part];
  }
  target[parts.at(-1)] = value;
}

function bindDraftInputs(root = document) {
  root.querySelectorAll('[data-path]').forEach((element) => {
    const apply = () => {
      let value;
      if (element.type === 'checkbox') value = element.checked;
      else if (element.dataset.kind === 'number') value = Number(element.value || 0);
      else if (element.dataset.kind === 'list') value = element.value.split(',').map((item) => item.trim()).filter(Boolean);
      else value = element.value;
      setDraftValue(element.dataset.path, value);
    };
    element.addEventListener(element.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input', apply);
  });
}

async function saveDraft(message = 'Settings saved and backend restarted.') {
  try {
    state = await api.saveSettings(draft);
    draft = clone(state.settings || {});
    updateStatus();
    notify(message);
    show(currentView);
  } catch (error) {
    notify(error.message || String(error), 'bad');
  }
}

function textField(label, pathValue, value, options = {}) {
  const type = options.type || 'text';
  const kind = options.kind || '';
  const placeholder = options.placeholder || '';
  const note = options.note ? `<small class="field-note">${esc(options.note)}</small>` : '';
  return `<label class="field"><span>${esc(label)}</span><input type="${esc(type)}" value="${esc(value ?? '')}" data-path="${esc(pathValue)}"${kind ? ` data-kind="${esc(kind)}"` : ''}${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}>${note}</label>`;
}

function checkField(label, pathValue, checked, note = '') {
  return `<label class="check-field"><input type="checkbox" data-path="${esc(pathValue)}" ${checked ? 'checked' : ''}><span><strong>${esc(label)}</strong>${note ? `<small>${esc(note)}</small>` : ''}</span></label>`;
}

function selectField(label, pathValue, value, choices) {
  return `<label class="field"><span>${esc(label)}</span><select data-path="${esc(pathValue)}">${choices.map((choice) => `<option value="${esc(choice.value)}" ${String(choice.value) === String(value) ? 'selected' : ''}>${esc(choice.label)}</option>`).join('')}</select></label>`;
}

function renderOverview() {
  const modules = state?.modules?.modules || [];
  const enabled = modules.filter((item) => item.enabled).length;
  const ready = modules.filter((item) => item.enabled && item.configured).length;
  const connected = modules.filter((item) => item.connected).length;
  const actions = modules.reduce((sum, item) => sum + (item.availableActions || []).length, 0);
  const warningList = (state?.warnings || []).slice(0, 12);
  content.innerHTML = `${grid([
    card('Local Backend', `<div class="metric ${statusClass(state?.backend?.ok)}">${state?.backend?.ok ? 'ONLINE' : 'OFFLINE'}</div><p>${esc(state?.backendMode || 'unknown')} • port ${esc(draft?.backend?.port || 3210)}</p><div class="actions">${button('Restart backend', 'restartBackend', 'class="primary"')}${button('Open data folder', 'openData', 'class="secondary"')}</div>`),
    card('Game Modules', `<div class="metric">${enabled}</div><p>${ready} backend-ready • ${connected} server connections live</p>`),
    card('Backend Actions', `<div class="metric">${actions}</div><p>Available through the clean capability contract and Sentinal.</p>`),
    card('Desktop Direction', '<p><strong>Administration only.</strong></p><p>Game UX remains in Nexus Sentinal or Veyra; this app manages configuration, health, credentials, diagnostics and private integrations.</p>')
  ])}
  <div class="section-head"><div><h3>Readiness</h3><p>Items that still need setup before every module is fully operational.</p></div></div>
  <div class="card">${warningList.length ? `<ul class="warning-list">${warningList.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p class="good">No configuration warnings.</p>'}</div>`;
  document.getElementById('restartBackend').onclick = async () => {
    try { state = await api.restartBackend(); draft = clone(state.settings); updateStatus(); notify('Backend restarted.'); show('overview'); }
    catch (error) { notify(error.message || String(error), 'bad'); }
  };
  document.getElementById('openData').onclick = () => api.openDataFolder();
}

function renderDiscord() {
  const settings = draft.discord || {};
  content.innerHTML = `${grid([
    card('Sentinal Binding', `<p>These values control owner/operator authorization and give the desktop a canonical view of the Discord installation.</p>${textField('Discord Guild ID', 'discord.guildId', settings.guildId, { placeholder: 'Server ID' })}${textField('Owner User IDs', 'discord.ownerUserIds', (settings.ownerUserIds || []).join(', '), { kind: 'list', note: 'Comma-separated Discord user IDs.' })}${textField('Operator Role IDs', 'discord.operatorRoleIds', (settings.operatorRoleIds || []).join(', '), { kind: 'list', note: 'Comma-separated role IDs.' })}${textField('Max temporary lobbies per module', 'discord.maxTemporaryLobbiesPerModule', settings.maxTemporaryLobbiesPerModule, { type: 'number', kind: 'number' })}<div class="actions">${button('Save Discord settings', 'saveDiscord', 'class="primary"')}</div>`),
    card('Repair Workflow', '<p>Sentinal remains the Discord-facing control surface.</p><div class="command">/nexus repair</div><p>Running it without a module reconciles every enabled module category, channel layout, join-to-build voice lobby and persistent console.</p><div class="command">/market item:&lt;name&gt;</div><p>Warframe Market is a dedicated user-facing command.</p>')
  ])}`;
  bindDraftInputs(content);
  document.getElementById('saveDiscord').onclick = () => saveDraft('Discord and Sentinal settings saved.');
}

function directConnectionFields(moduleId, connection) {
  const base = `modules.${moduleId}.connection`;
  const fields = [];
  if ('host' in connection) fields.push(textField('Host', `${base}.host`, connection.host, { placeholder: 'Server hostname or IP' }));
  if ('port' in connection) fields.push(textField('Port', `${base}.port`, connection.port, { type: 'number', kind: 'number' }));
  if ('protocol' in connection) fields.push(selectField('Protocol', `${base}.protocol`, connection.protocol, [{ value: 'http', label: 'HTTP' }, { value: 'https', label: 'HTTPS' }, { value: 'ws', label: 'WebSocket' }, { value: 'wss', label: 'Secure WebSocket' }]));
  if ('apiPath' in connection) fields.push(textField('API path', `${base}.apiPath`, connection.apiPath));
  if ('username' in connection) fields.push(textField('Username', `${base}.username`, connection.username));
  if ('backupPath' in connection) fields.push(textField('Backup path', `${base}.backupPath`, connection.backupPath));
  if ('tlsFingerprint' in connection) fields.push(textField('TLS fingerprint', `${base}.tlsFingerprint`, connection.tlsFingerprint));
  if ('restartViaShutdown' in connection) fields.push(checkField('Restart via shutdown/supervisor', `${base}.restartViaShutdown`, connection.restartViaShutdown, 'Allows the backend to use the configured supervised restart path.'));
  if (connection.passwordEnv) fields.push(`<div class="env-hint">Credential key: <code>${esc(connection.passwordEnv)}</code> — set it under Credentials.</div>`);
  return fields.join('');
}

function clusterConnectionFields(moduleId, connection) {
  const servers = Array.isArray(connection.servers) ? connection.servers : [];
  return `<div class="server-list">${servers.map((server, index) => {
    const base = `modules.${moduleId}.connection.servers.${index}`;
    return `<div class="server-editor"><div class="server-title"><strong>${esc(server.name || `Server ${index + 1}`)}</strong></div>${textField('Name', `${base}.name`, server.name)}${textField('Host', `${base}.host`, server.host)}${textField('RCON port', `${base}.port`, server.port, { type: 'number', kind: 'number' })}${textField('Backup path', `${base}.backupPath`, server.backupPath || '')}${'modpack' in server ? textField('Modpack', `${base}.modpack`, server.modpack || '') : ''}${'mods' in server ? textField('Mods', `${base}.mods`, (server.mods || []).join(', '), { kind: 'list' }) : ''}${server.passwordEnv ? `<div class="env-hint">Credential key: <code>${esc(server.passwordEnv)}</code></div>` : ''}</div>`;
  }).join('')}</div>`;
}

function moduleConnection(moduleId, moduleConfig) {
  if (!moduleConfig.connection) return '';
  if (Array.isArray(moduleConfig.connection.servers)) return clusterConnectionFields(moduleId, moduleConfig.connection);
  return directConnectionFields(moduleId, moduleConfig.connection);
}

function renderModules() {
  const modules = Object.entries(draft.modules || {});
  content.innerHTML = `<div class="section-head"><div><h3>Backend Game Modules</h3><p>Enable modules here, bind their Sentinal console channel, and configure safe connection metadata. Passwords/tokens stay in protected storage.</p></div>${button('Save module configuration', 'saveModules', 'class="primary"')}</div><div class="module-stack">${modules.map(([moduleId, moduleConfig]) => {
    const live = manifest(moduleId);
    const status = !moduleConfig.enabled ? badge('Disabled') : live?.connected ? badge('Connected', 'good') : live?.configured ? badge(live.providerKind || 'Backend ready', 'good') : badge('Provider setup needed', 'warn');
    const actionCount = live ? `${(live.availableActions || []).length}/${(live.capabilities || []).length} actions` : 'not loaded';
    const platformFields = moduleId === 'warframe' ? `<div class="form-row">${selectField('World-state platform', `modules.${moduleId}.platform`, moduleConfig.platform || 'pc', [{ value: 'pc', label: 'PC' }, { value: 'ps4', label: 'PlayStation' }, { value: 'xb1', label: 'Xbox' }, { value: 'swi', label: 'Switch' }])}${selectField('Market platform', `modules.${moduleId}.marketPlatform`, moduleConfig.marketPlatform || 'pc', [{ value: 'pc', label: 'PC' }, { value: 'ps4', label: 'PlayStation' }, { value: 'xbox', label: 'Xbox' }, { value: 'switch', label: 'Switch' }])}</div>` : '';
    return `<article class="module-card"><div class="module-head"><div><h3>${esc(live?.name || human(moduleId))}</h3><div class="badges">${status}${badge(actionCount)}</div></div>${checkField('Enabled', `modules.${moduleId}.enabled`, moduleConfig.enabled, 'Available to the backend and repair workflow.')}</div><div class="form-row">${textField('Sentinal console channel ID', `modules.${moduleId}.channelId`, moduleConfig.channelId || '', { placeholder: 'Optional until /nexus repair binds it' })}</div>${platformFields}${moduleConnection(moduleId, moduleConfig)}</article>`;
  }).join('')}</div>`;
  bindDraftInputs(content);
  document.getElementById('saveModules').onclick = () => saveDraft('Module configuration saved and local backend restarted.');
}

function renderCredentials() {
  const entries = state.secrets || [];
  content.innerHTML = `<div class="section-head"><div><h3>Protected Credentials</h3><p>Secret values are never returned to this page. On Windows they are encrypted with the operating system protected-storage facility.</p></div>${state.secretEncryptionAvailable ? badge('Protected storage ready', 'good') : badge('Protected storage unavailable', 'bad')}</div><div class="credential-list">${entries.map((entry, index) => `<article class="card credential"><div class="credential-head"><div><h3>${esc(entry.name)}</h3><p>${entry.configured ? `Configured via ${esc(entry.source)}` : 'Not configured'}</p></div>${badge(entry.configured ? 'Configured' : 'Missing', entry.configured ? 'good' : 'warn')}</div><div class="secret-row"><input id="secret-${index}" type="password" autocomplete="new-password" placeholder="Enter new value"><button class="primary" data-set-secret="${esc(entry.name)}" data-index="${index}">Save secret</button>${entry.configured ? `<button class="danger" data-clear-secret="${esc(entry.name)}">Clear</button>` : ''}</div></article>`).join('')}</div>`;
  content.querySelectorAll('[data-set-secret]').forEach((element) => {
    element.onclick = async () => {
      const input = document.getElementById(`secret-${element.dataset.index}`);
      if (!input.value) return notify('Enter a secret value first.', 'warn');
      try {
        state = await api.setSecret(element.dataset.setSecret, input.value);
        draft = clone(state.settings);
        updateStatus();
        notify(`${element.dataset.setSecret} saved to protected storage.`);
        show('credentials');
      } catch (error) { notify(error.message || String(error), 'bad'); }
    };
  });
  content.querySelectorAll('[data-clear-secret]').forEach((element) => {
    element.onclick = async () => {
      try {
        state = await api.clearSecret(element.dataset.clearSecret);
        draft = clone(state.settings);
        updateStatus();
        notify(`${element.dataset.clearSecret} cleared.`);
        show('credentials');
      } catch (error) { notify(error.message || String(error), 'bad'); }
    };
  });
}

function renderDiagnostics() {
  content.innerHTML = `${grid([
    card('Diagnostics', `<p>Run a redacted health snapshot before reporting a problem. Secret values are never included.</p><div class="actions">${button('Run diagnostics', 'runDiag', 'class="primary"')}${button('Export JSON', 'exportDiag', 'class="secondary"')}${button('Open Nexus data folder', 'openDiagData', 'class="secondary"')}</div>`),
    card('Runtime', `<dl class="facts"><dt>Version</dt><dd>${esc(state.version)}</dd><dt>Install mode</dt><dd>${state.packaged ? 'Packaged Windows app' : 'Development'}</dd><dt>Backend mode</dt><dd>${esc(state.backendMode)}</dd><dt>Config</dt><dd class="mono small-text">${esc(state.configSource)}</dd></dl>`)
  ])}<div class="card"><pre id="diag" class="mono diagnostic-output">Press “Run diagnostics” to inspect the current state.</pre></div>`;
  document.getElementById('runDiag').onclick = async () => {
    const element = document.getElementById('diag');
    element.textContent = 'Running…';
    try { element.textContent = JSON.stringify(await api.diagnostics(), null, 2); }
    catch (error) { element.textContent = error.message || String(error); }
  };
  document.getElementById('exportDiag').onclick = async () => {
    try {
      const result = await api.exportDiagnostics();
      notify(result.saved ? `Diagnostics saved to ${result.filePath}` : 'Diagnostics export cancelled.', result.saved ? 'good' : 'warn');
    } catch (error) { notify(error.message || String(error), 'bad'); }
  };
  document.getElementById('openDiagData').onclick = () => api.openDataFolder();
}

function renderThora() {
  const thora = draft.thora || {};
  content.innerHTML = `${grid([
    card('Private Thora Bridge', `${checkField('Enable Thora integration', 'thora.enabled', thora.enabled, 'Thora stays private/local; Nexus only launches the canonical desktop executable.')}<label class="field"><span>Executable</span><input value="${esc(thora.executablePath || '')}" readonly></label><div class="actions">${button('Choose executable', 'chooseThora', 'class="secondary"')}${button('Save', 'saveThora', 'class="primary"')}${button('Launch Thora', 'launchThora', state.thora?.executableExists ? '' : 'disabled')}</div><p>${state.thora?.configured ? state.thora.executableExists ? '<span class="good">Executable found.</span>' : '<span class="warn">Configured path does not exist.</span>' : 'No Thora executable selected.'}</p>`),
    card('Boundary', '<p>Nexus does not copy Thora’s engine or household data into the game backend. This bridge only exposes local launch/status administration.</p>')
  ])}`;
  bindDraftInputs(content);
  document.getElementById('chooseThora').onclick = async () => {
    try { state = await api.chooseThora(); draft = clone(state.settings); notify('Thora executable updated.'); show('thora'); }
    catch (error) { notify(error.message || String(error), 'bad'); }
  };
  document.getElementById('saveThora').onclick = () => saveDraft('Thora integration settings saved.');
  document.getElementById('launchThora').onclick = async () => {
    try { await api.launchThora(); notify('Thora launch requested.'); }
    catch (error) { notify(error.message || String(error), 'bad'); }
  };
}

function renderSettings() {
  content.innerHTML = `${grid([
    card('Local Backend', `${textField('Backend port', 'backend.port', draft.backend?.port || 3210, { type: 'number', kind: 'number', note: 'Loopback only; the desktop never exposes this listener publicly.' })}${textField('Scheduler time zone', 'scheduler.timeZone', draft.scheduler?.timeZone || 'America/Chicago')}<div class="actions">${button('Save & restart backend', 'saveGeneral', 'class="primary"')}</div>`),
    card('Data Location', `<p>Nexus keeps writable configuration and state outside the installed application.</p><p class="mono small-text">${esc(state.dataPath)}</p><div class="actions">${button('Open folder', 'openSettingsData', 'class="secondary"')}</div>`),
    card('Build', `<dl class="facts"><dt>App version</dt><dd>${esc(state.version)}</dd><dt>Package</dt><dd>${state.packaged ? 'Installed build' : 'Development build'}</dd><dt>Config source</dt><dd class="mono small-text">${esc(state.configSource)}</dd></dl>`)
  ])}`;
  bindDraftInputs(content);
  document.getElementById('saveGeneral').onclick = () => saveDraft('General settings saved and backend restarted.');
  document.getElementById('openSettingsData').onclick = () => api.openDataFolder();
}

const views = {
  overview: { title: 'Overview', subtitle: 'Backend-first Nexus administration', render: renderOverview },
  discord: { title: 'Discord & Sentinal', subtitle: 'Discord ownership, access boundaries and repair workflow', render: renderDiscord },
  modules: { title: 'Backend Modules', subtitle: 'Game services, connections and Sentinal channel bindings', render: renderModules },
  credentials: { title: 'Credentials', subtitle: 'OS-protected integration secrets', render: renderCredentials },
  diagnostics: { title: 'Diagnostics', subtitle: 'Redacted health, runtime and recovery information', render: renderDiagnostics },
  thora: { title: 'Thora', subtitle: 'Private local assistant bridge', render: renderThora },
  settings: { title: 'Settings', subtitle: 'Local backend and application configuration', render: renderSettings }
};

function show(view) {
  currentView = views[view] ? view : 'overview';
  const definition = views[currentView];
  title.textContent = definition.title;
  subtitle.textContent = definition.subtitle;
  document.querySelectorAll('nav button').forEach((element) => element.classList.toggle('active', element.dataset.view === currentView));
  definition.render();
}

document.querySelectorAll('nav button').forEach((element) => { element.onclick = () => show(element.dataset.view); });
refreshButton.onclick = async () => {
  refreshButton.disabled = true;
  try { await refreshState({ render: true, resetDraft: true }); notify('Nexus status refreshed.'); }
  catch (error) { notify(error.message || String(error), 'bad'); }
  finally { refreshButton.disabled = false; }
};

refreshState().catch((error) => {
  content.innerHTML = `<div class="card"><h3>Startup error</h3><p class="bad">${esc(error.message || error)}</p></div>`;
  health.textContent = 'Startup error';
  health.className = 'pill bad';
});

setInterval(() => refreshState({ render: currentView === 'overview', resetDraft: false }).catch(() => {}), 30000);
