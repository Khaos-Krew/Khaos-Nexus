'use strict';

(() => {
  const api = window.nexusAdmin;
  const nav = document.querySelector('nav');
  const content = document.getElementById('content');
  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  const refresh = document.getElementById('refresh');
  if (!api || !nav || !content) return;

  const RANKS = [
    ['shadow-recruit', 'Shadow Recruit'], ['cipher-runner', 'Cipher Runner'], ['nexus-raider', 'Nexus Raider'],
    ['khaos-warden', 'Khaos Warden'], ['blackout-legend', 'Blackout Legend'], ['origin-founder', 'Origin Founder']
  ];
  const FINDING_LABELS = Object.freeze({
    status: 'Sentinal health',
    permissions: 'Discord permissions',
    commands: 'Command registration',
    channels: 'Discord layout',
    roles: 'Rank synchronization',
    rankDiscovery: 'Rank / SKU discovery',
    providerConfig: 'Hosted provider configuration'
  });
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
  const statusBadge = (ok, good = 'Ready', bad = 'Needs attention') => badge(ok ? good : bad, ok ? 'good' : 'warn');
  const settingsButton = () => nav.querySelector('[data-view="settings"]');
  let active = '';
  let busy = false;

  const ownerButton = document.createElement('button');
  ownerButton.textContent = 'Owner Test Center';
  ownerButton.dataset.adminOpsOwner = 'true';
  nav.insertBefore(ownerButton, nav.children[1] || null);

  const discordButton = document.createElement('button');
  discordButton.textContent = 'Discord Admin';
  discordButton.dataset.adminOpsDiscord = 'true';
  const discordBase = nav.querySelector('[data-view="discord"]');
  if (discordBase?.nextSibling) nav.insertBefore(discordButton, discordBase.nextSibling);
  else nav.appendChild(discordButton);

  function activate(button, viewTitle, viewSubtitle) {
    document.querySelectorAll('nav button').forEach((item) => item.classList.toggle('active', item === button));
    title.textContent = viewTitle;
    subtitle.textContent = viewSubtitle;
  }

  function setBusy(value) {
    busy = value;
    content.querySelectorAll('button').forEach((button) => { button.disabled = value || button.dataset.forceDisabled === 'true'; });
  }

  async function action(fn, successMessage, options = {}) {
    if (busy) return null;
    setBusy(true);
    try {
      const result = await fn();
      const completedAudit = options.allowFindings === true && result?.ok === false && result?.sections && typeof result.sections === 'object';
      if (result?.ok === false && !completedAudit) throw new Error(result.message || result.error || result.code || 'Operation failed.');
      if (successMessage) window.alert(successMessage);
      return result;
    } catch (error) {
      window.alert(error.message || String(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function sectionResult(label, value) {
    if (!value) return `<div class="admin-op-row"><strong>${esc(label)}</strong>${badge('Not checked')}</div>`;
    return `<div class="admin-op-row"><strong>${esc(label)}</strong>${statusBadge(value.ok !== false, 'Ready', 'Needs attention')}</div>`;
  }

  function rankDiscoveryDetail(section = {}) {
    const ranks = Array.isArray(section.ranks) ? section.ranks : [];
    const attentionRanks = ranks.filter((rank) => rank?.role?.status === 'missing' || rank?.role?.status === 'ambiguous' || (Number(rank?.level || 0) > 0 && rank?.skus?.status === 'missing'));
    const names = attentionRanks.map((rank) => rank.name).filter(Boolean);
    const count = Number(section.counts?.attention ?? attentionRanks.length ?? 0);
    if (!count) return 'Rank and Premium SKU discovery is ready.';
    return `${count} rank mapping${count === 1 ? '' : 's'} need attention${names.length ? `: ${names.join(', ')}` : ''}.`;
  }

  function findingDetail(id, section = {}) {
    if (section.message) return String(section.message);
    if (section.error) return String(section.error);
    if (id === 'rankDiscovery') return rankDiscoveryDetail(section);
    if (id === 'channels') {
      const count = (section.modules || []).filter((module) => module?.ok === false || module?.complete === false).length;
      return `${count || 'One or more'} enabled module layout${count === 1 ? '' : 's'} need reconciliation.`;
    }
    if (id === 'roles') {
      const count = (section.items || []).filter((item) => item?.ok === false).length;
      return `${count || 'One or more'} rank synchronization blocker${count === 1 ? '' : 's'} detected.`;
    }
    if (id === 'providerConfig') return section.backendMessage || 'Hosted provider configuration needs attention.';
    return section.code || `${FINDING_LABELS[id] || id} needs attention.`;
  }

  function acceptanceFindings(sections = {}) {
    return Object.entries(sections)
      .filter(([, section]) => section && section.ok === false)
      .map(([id, section]) => ({ id, label: FINDING_LABELS[id] || id, detail: findingDetail(id, section) }));
  }

  async function renderOwnerTest() {
    if (active !== 'owner') return;
    activate(ownerButton, 'Owner Test Center', 'Build status, test checklist and Owner feedback');
    content.innerHTML = '<div class="card"><p>Loading Owner Test information…</p></div>';
    const [snapshot, appState] = await Promise.all([api.ownerTest(), api.state()]);
    if (active !== 'owner') return;
    const checklist = snapshot.checklist || { items: [], counts: {} };
    const release = snapshot.currentRelease;
    const ci = snapshot.ci || { state: 'unknown', runs: [] };
    const updater = appState.updater || {};
    const ciKind = ci.state === 'passed' ? 'good' : ci.state === 'failed' ? 'bad' : 'warn';

    const checklistHtml = checklist.items.map((item) => `
      <article class="owner-test-item" data-item="${esc(item.id)}">
        <div class="owner-test-head"><div><strong>${esc(item.label)}</strong><small>${item.updatedAt ? `Updated ${esc(new Date(item.updatedAt).toLocaleString())}` : 'Not tested yet'}</small></div>${badge(item.status === 'working' ? 'Working' : item.status === 'failed' ? 'Failed' : 'Not tested', item.status === 'working' ? 'good' : item.status === 'failed' ? 'bad' : '')}</div>
        <input class="owner-test-note" maxlength="500" value="${esc(item.note || '')}" placeholder="Optional note about what you observed">
        <div class="actions"><button data-test-status="working" class="primary">✓ Working</button><button data-test-status="failed" class="danger">✕ Failed</button><button data-test-status="not-tested" class="secondary">Clear</button></div>
      </article>`).join('');

    const history = (snapshot.builds || []).length
      ? snapshot.builds.map((build) => `<div class="build-history-row"><div><strong>${esc(build.version || build.name)}</strong><small>${esc(build.publishedAt ? new Date(build.publishedAt).toLocaleString() : '')}</small></div><div>${badge(`${build.feedback?.counts?.working || 0} working`, 'good')} ${build.feedback?.counts?.failed ? badge(`${build.feedback.counts.failed} failed`, 'bad') : ''}</div></div>`).join('')
      : '<p>No Owner-Test release manifests are published yet. The first update-channel test build will populate this list.</p>';

    content.innerHTML = `
      <div class="grid owner-test-summary">
        <article class="card"><h3>Current build</h3><div class="metric">${esc(snapshot.currentVersion)}</div><p>${release ? esc(release.name) : 'Installed development/initial build'}</p>${release?.commitSha ? `<p class="mono small-text">${esc(release.commitSha)}</p>` : ''}</article>
        <article class="card"><h3>Automated validation</h3><div class="metric ${ciKind}">${esc(ci.state.toUpperCase())}</div><p>${ci.runs?.length || 0} workflow runs tied to this build.</p></article>
        <article class="card"><h3>Manual acceptance</h3><div class="metric">${esc(checklist.counts?.working || 0)}/${esc(checklist.items?.length || 0)}</div><p>${esc(checklist.counts?.failed || 0)} failed • ${esc(checklist.counts?.notTested || 0)} not tested</p></article>
        <article class="card"><h3>Update channel</h3><div class="metric">${esc((updater.channel || appState.settings?.updates?.channel || 'owner-test').toUpperCase())}</div><p>Updater: ${esc(updater.phase || 'idle')}</p></article>
      </div>
      <div class="section-head"><div><h3>What to test</h3><p>These results are stored per build. A failed item stays visible until you retest it.</p></div></div>
      <div class="owner-test-list">${checklistHtml}</div>
      <div class="section-head"><div><h3>Owner-Test build history</h3><p>Published prerelease builds with staged-update manifests.</p></div></div>
      <div class="card build-history">${history}</div>`;

    content.querySelectorAll('.owner-test-item').forEach((item) => {
      item.querySelectorAll('[data-test-status]').forEach((button) => {
        button.onclick = async () => {
          const note = item.querySelector('.owner-test-note')?.value || '';
          const result = await action(() => api.setOwnerTestFeedback(snapshot.currentVersion, item.dataset.item, button.dataset.testStatus, note));
          if (result) await renderOwnerTest();
        };
      });
    });
  }

  function configRankRows(local, remote) {
    const roles = remote?.rankRoles || local?.rankRoles || {};
    const skus = remote?.rankSkus || local?.rankSkus || {};
    return RANKS.map(([id, name]) => `
      <div class="rank-config-row" data-rank="${id}"><strong>${esc(name)}</strong><input data-rank-role value="${esc(roles[id] || '')}" placeholder="Discord role ID"><input data-rank-skus value="${esc((skus[id] || []).join(', '))}" placeholder="Discord SKU IDs, comma separated"></div>`).join('');
  }

  function moduleToggleRows(appState, remote) {
    return Object.entries(appState.settings?.modules || {}).map(([id, moduleConfig]) => {
      const overridden = remote?.moduleEnabled?.[id];
      const enabled = typeof overridden === 'boolean' ? overridden : moduleConfig.enabled !== false;
      const live = (appState.modules?.modules || []).find((item) => item.id === id);
      return `<label class="admin-module-toggle"><input type="checkbox" data-admin-module="${esc(id)}" ${enabled ? 'checked' : ''}><span><strong>${esc(live?.name || id)}</strong><small>${live?.configured ? live.connected ? 'Provider connected' : 'Provider ready' : 'Provider setup needed'}</small></span></label>`;
    }).join('');
  }

  function rankDiscoveryRows(discovery = {}) {
    const ranks = Array.isArray(discovery.ranks) ? discovery.ranks : [];
    if (!ranks.length) return '<p>Rank and Premium SKU discovery has not returned data yet.</p>';
    return ranks.map((rank) => {
      const roleStatus = rank.role?.status || 'not-checked';
      const skuStatus = rank.skus?.status || 'not-checked';
      const roleGood = roleStatus === 'configured' || roleStatus === 'discovered';
      const skuGood = skuStatus === 'configured' || skuStatus === 'discovered' || skuStatus === 'free-default';
      return `<div class="admin-op-row"><span><strong>${esc(rank.name || rank.id)}</strong><small>Role: ${esc(roleStatus)} • SKU: ${esc(skuStatus)}</small></span>${badge(roleGood && skuGood ? 'Ready' : 'Attention', roleGood && skuGood ? 'good' : 'warn')}</div>`;
    }).join('');
  }

  async function renderDiscordAdmin(scanOverride = null) {
    if (active !== 'discord') return;
    activate(discordButton, 'Discord Admin', 'Nexus Sentinal health, permissions, ranks, channels, panels and repair');
    content.innerHTML = '<div class="card"><p>Reading Nexus Sentinal administration state…</p></div>';
    const [appState, scan] = await Promise.all([api.state(), scanOverride ? Promise.resolve(scanOverride) : api.sentinalScan()]);
    if (active !== 'discord') return;
    const sections = scan?.sections || {};
    const status = sections.status || appState.sentinal?.sentinal || appState.sentinal || {};
    const permissions = sections.permissions || {};
    const commands = sections.commands || {};
    const channels = sections.channels || {};
    const roles = sections.roles || {};
    const rankDiscovery = sections.rankDiscovery || {};
    const providerConfig = sections.providerConfig || {};
    const findings = acceptanceFindings(sections);
    const remoteSettings = scan?.settings || {};
    const adminUrl = appState.settings?.discord?.sentinalAdminUrl || '';
    const permissionRows = (permissions.permissions || []).map((item) => `<div class="admin-op-row"><span>${esc(item.label)}</span>${badge(item.granted ? 'Granted' : 'Missing', item.granted ? 'good' : 'bad')}</div>`).join('') || '<p>Permission audit unavailable.</p>';
    const channelIssues = (channels.modules || []).filter((module) => !module.complete || module.ok === false);
    const roleChanges = (roles.items || []).filter((item) => item.action === 'reconcile').length;
    const roleBlocks = (roles.items || []).filter((item) => item.ok === false).length;
    const scanSummary = scan?.sections
      ? findings.length
        ? `<article class="card"><div class="section-head"><div><h3>Scan completed — attention needed</h3><p>The read-only scan completed successfully. No repair was applied. Resolve the findings below, then scan again.</p></div>${badge(`${findings.length} finding${findings.length === 1 ? '' : 's'}`, 'warn')}</div>${findings.map((finding) => `<div class="admin-op-row"><span><strong>${esc(finding.label)}</strong><small>${esc(finding.detail)}</small></span>${badge('Attention', 'warn')}</div>`).join('')}</article>`
        : '<article class="card"><div class="section-head"><div><h3>Scan completed</h3><p>All Discord + Nexus acceptance sections reported ready. No changes were made.</p></div><span class="badge good">Ready</span></div></article>'
      : scan?.ok === false
        ? `<article class="card"><h3>Scan unavailable</h3><p class="bad">${esc(scan.message || scan.error || scan.code || 'Sentinal scan could not be completed.')}</p></article>`
        : '';

    content.innerHTML = `
      ${scanSummary}
      <div class="grid admin-summary">
        <article class="card"><h3>Nexus Sentinal</h3><div class="metric ${status.discordReady ? 'good' : 'bad'}">${status.discordReady ? 'ONLINE' : 'OFFLINE'}</div><p>${esc(status.guild?.name || status.message || adminUrl || 'Not configured')}</p><p>${status.websocketPingMs != null ? `${esc(status.websocketPingMs)} ms gateway` : ''}</p></article>
        <article class="card"><h3>Permissions</h3><div class="metric ${permissions.ok ? 'good' : 'warn'}">${permissions.ok ? 'READY' : 'CHECK'}</div><p>${(permissions.permissions || []).filter((item) => item.granted).length}/${(permissions.permissions || []).length} required permissions</p></article>
        <article class="card"><h3>Discord layout</h3><div class="metric ${channelIssues.length ? 'warn' : 'good'}">${channelIssues.length}</div><p>enabled modules need layout attention</p></article>
        <article class="card"><h3>Rank synchronization</h3><div class="metric ${roleBlocks ? 'bad' : roleChanges ? 'warn' : 'good'}">${roleChanges}</div><p>${roleChanges} changes pending • ${roleBlocks} blockers</p></article>
      </div>
      <div class="admin-action-bar"><button id="adminScan" class="secondary">Scan</button><button id="syncCommands" class="secondary">Sync commands</button><button id="repairChannels" class="secondary">Reconcile channels</button><button id="refreshPanels" class="secondary">Refresh module panels</button><button id="syncRanks" class="secondary">Apply rank sync</button><button id="repairNexus" class="primary">Repair Nexus</button></div>
      <div class="grid">
        <article class="card"><h3>Permission checker</h3>${permissionRows}${permissions.botHighestRole ? `<p class="field-note">Sentinal highest role: ${esc(permissions.botHighestRole.name)}</p>` : ''}</article>
        <article class="card"><h3>Command synchronization</h3>${(commands.commands || []).map((item) => `<div class="admin-op-row"><code>/${esc(item.name)}</code>${badge(item.registered ? 'Registered' : 'Missing', item.registered ? 'good' : 'warn')}</div>`).join('') || '<p>Command state unavailable.</p>'}<p class="field-note">Synchronization upserts Nexus commands and preserves unrelated application commands.</p></article>
      </div>
      <div class="section-head"><div><h3>Acceptance discovery</h3><p>Read-only checks for Discord rank roles, Premium App SKUs, and the hosted provider runtime.</p></div></div>
      <div class="grid">
        <article class="card"><h3>Rank / SKU discovery</h3>${rankDiscoveryRows(rankDiscovery)}<p class="field-note">Discovered roles: ${esc(rankDiscovery.counts?.discoveredRoles || 0)} • discovered SKUs: ${esc(rankDiscovery.counts?.discoveredSkus || 0)} • attention: ${esc(rankDiscovery.counts?.attention || 0)}</p></article>
        <article class="card"><h3>Hosted provider configuration</h3>${sectionResult('Hosted runtime', providerConfig)}<p>${providerConfig.configured ? 'Hosted provider configuration is stored and available to Sentinal.' : 'No hosted game-provider configuration has been synchronized yet.'}</p><p class="field-note">Encrypted credential storage: ${providerConfig.secretEncryptionReady === false ? 'Unavailable' : 'Ready or not required'} • configured credentials: ${esc((providerConfig.configuredSecrets || []).length)}</p></article>
      </div>
      <div class="section-head"><div><h3>Hosted/local Sentinal connection</h3><p>Remote admin endpoints must use HTTPS. Loopback HTTP is allowed for local testing.</p></div></div>
      <article class="card"><label class="field"><span>Sentinal admin URL</span><input id="sentinalAdminUrl" value="${esc(adminUrl)}" placeholder="https://your-sentinal-service.example"></label><p class="field-note">The matching NEXUS_SENTINAL_ADMIN_TOKEN stays in protected Credentials storage.</p><div class="actions"><button id="saveAdminUrl" class="primary">Save connection</button></div></article>
      <div class="section-head"><div><h3>Supporter ranks & entitlements</h3><p>Map Discord Premium App SKU IDs to existing Discord rank roles. Preview is read-only; Apply rank sync changes only mapped rank roles.</p></div></div>
      <div class="card"><div class="rank-config-head"><strong>Rank</strong><strong>Discord role ID</strong><strong>Premium SKU IDs</strong></div>${configRankRows(appState.settings?.discord || {}, remoteSettings)}<div class="actions"><button id="saveRankMap" class="primary">Save mappings</button></div><p class="field-note">Entitlements seen: ${esc(roles.entitlementCount || 0)} • linked accounts: ${esc(roles.linkedAccountCount || 0)}</p></div>
      <div class="section-head"><div><h3>Module availability</h3><p>These toggles control which modules Sentinal reconciles and presents. Disabling a module does not delete its Discord history or channels.</p></div></div>
      <div class="card admin-module-list">${moduleToggleRows(appState, remoteSettings)}<div class="actions"><button id="saveModuleState" class="primary">Save module availability</button></div></div>
      <div class="grid admin-details">
        <article class="card"><h3>Channel/category reconcile</h3>${sectionResult('Layout state', channels)}<p>${channelIssues.length ? `${esc(channelIssues.length)} module layouts have missing or mismatched elements.` : 'All enabled module layouts match their expected structure.'}</p></article>
        <article class="card"><h3>Permanent module panels</h3>${statusBadge(status.discordReady, 'Sentinal ready to refresh panels', 'Sentinal unavailable')}<p>Panel refresh edits/recreates the persistent module message; it does not post a new message every scan.</p></article>
        <article class="card"><h3>Repair Nexus</h3><p>Runs the safe reconciliation sequence: permissions → command sync → enabled channel layouts → persistent module panels → mapped rank roles → final health.</p><p><strong>No game-server restart, shutdown, kick, ban, or raw console action is part of this repair.</strong></p></article>
      </div>`;

    document.getElementById('adminScan').onclick = async () => { const result = await action(() => api.sentinalScan(), '', { allowFindings: true }); if (result) renderDiscordAdmin(result); };
    document.getElementById('syncCommands').onclick = async () => { const result = await action(() => api.sentinalSyncCommands(), 'Sentinal commands synchronized.'); if (result) renderDiscordAdmin(); };
    document.getElementById('repairChannels').onclick = async () => { const result = await action(() => api.sentinalReconcileChannels(''), 'Enabled module layouts reconciled.'); if (result) renderDiscordAdmin(); };
    document.getElementById('refreshPanels').onclick = async () => { const result = await action(() => api.sentinalRefreshConsoles(''), 'Persistent Sentinal module panels refreshed.'); if (result) renderDiscordAdmin(); };
    document.getElementById('syncRanks').onclick = async () => {
      if (!confirm('Apply the current entitlement-to-rank plan to Discord members? Only configured Nexus rank roles can be added/removed.')) return;
      const result = await action(() => api.sentinalReconcileRoles(), 'Discord rank roles reconciled.'); if (result) renderDiscordAdmin();
    };
    document.getElementById('repairNexus').onclick = async () => {
      if (!confirm('Run the safe Nexus Discord repair sequence? This repairs commands, module layout/panels and mapped rank roles. It does not restart game servers.')) return;
      const result = await action(() => api.sentinalRepair(), 'Nexus repair sequence completed.'); if (result) renderDiscordAdmin(result);
    };
    document.getElementById('saveAdminUrl').onclick = async () => {
      const next = JSON.parse(JSON.stringify(appState.settings || {})); next.discord ||= {}; next.discord.sentinalAdminUrl = document.getElementById('sentinalAdminUrl').value.trim();
      const saved = await action(() => api.saveSettings(next), 'Sentinal admin connection saved.'); if (saved) renderDiscordAdmin();
    };
    document.getElementById('saveRankMap').onclick = async () => {
      const rankRoles = {}; const rankSkus = {};
      content.querySelectorAll('.rank-config-row').forEach((row) => {
        rankRoles[row.dataset.rank] = row.querySelector('[data-rank-role]').value.trim();
        rankSkus[row.dataset.rank] = row.querySelector('[data-rank-skus]').value.split(',').map((item) => item.trim()).filter(Boolean);
      });
      const next = JSON.parse(JSON.stringify(appState.settings || {})); next.discord ||= {}; next.discord.rankRoles = rankRoles; next.discord.rankSkus = rankSkus;
      const saved = await action(() => api.saveSettings(next), 'Rank mappings saved and synchronized to Nexus Sentinal.'); if (saved) renderDiscordAdmin();
    };
    document.getElementById('saveModuleState').onclick = async () => {
      const next = JSON.parse(JSON.stringify(appState.settings || {}));
      content.querySelectorAll('[data-admin-module]').forEach((input) => { if (next.modules?.[input.dataset.adminModule]) next.modules[input.dataset.adminModule].enabled = input.checked; });
      const saved = await action(() => api.saveSettings(next), 'Module availability saved and synchronized to Nexus Sentinal.'); if (saved) renderDiscordAdmin();
    };
  }

  ownerButton.onclick = () => { settingsButton()?.click(); active = 'owner'; renderOwnerTest().catch((error) => { content.innerHTML = `<div class="card"><p class="bad">${esc(error.message || error)}</p></div>`; }); };
  discordButton.onclick = () => { settingsButton()?.click(); active = 'discord'; renderDiscordAdmin().catch((error) => { content.innerHTML = `<div class="card"><p class="bad">${esc(error.message || error)}</p></div>`; }); };
  nav.querySelectorAll('button[data-view]').forEach((item) => item.addEventListener('click', () => { active = ''; }));
  refresh?.addEventListener('click', () => setTimeout(() => {
    if (active === 'owner') renderOwnerTest().catch(() => {});
    if (active === 'discord') renderDiscordAdmin().catch(() => {});
  }, 250));
})();
