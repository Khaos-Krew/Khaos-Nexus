'use strict';

(function bootstrapDndAiHomebrew(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndAiHomebrewFactory() {
  const CONTENT_TYPES = ['class', 'subclass', 'species', 'background', 'feat', 'spell', 'item', 'monster', 'rule-module', 'other'];
  const TARGET_TIERS = ['none', 'tier-1', 'tier-2', 'tier-3', 'tier-4'];
  const POWER_LEVELS = ['low', 'standard', 'high'];
  const AUTHORIZATIONS = ['user-owned', 'licensed', 'public-domain', 'summary-only', 'short-excerpt'];
  const clean = (value, maximum = 1000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, maximum);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const selected = (value, expected) => value === expected ? 'selected' : '';

  function defaultInput(campaignId = '', ruleset = '') {
    return {
      campaignId,
      contentType: 'other',
      system: ruleset || 'D&D 5e-compatible',
      titleHint: '',
      concept: '',
      targetTier: 'none',
      powerLevel: 'standard',
      constraints: '',
      inspirations: [{ label: '', authorization: 'user-owned', permissionConfirmed: false, summary: '', designSignals: '' }]
    };
  }

  function install(win) {
    if (!win?.document || win.__khaosDndAiHomebrew) return win?.__khaosDndAiHomebrew || null;
    const doc = win.document;
    const state = {
      active: false,
      busy: false,
      payload: null,
      preview: null,
      input: defaultInput(),
      attachTimer: null,
      observer: null,
      recovering: false
    };
    const invoke = (channel, payload) => win.khaos.invoke(channel, payload);
    const notify = (message) => typeof win.toast === 'function' ? win.toast(message) : console.info(message);
    const campaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value || state.payload?.selectedCampaignId, 100);

    function campaign() {
      return (state.payload?.campaigns || []).find((item) => item.id === campaignId()) || null;
    }

    function ensureTab(rootElement) {
      const tabs = rootElement.querySelector('.dnd-tabs');
      if (!tabs) return null;
      let button = tabs.querySelector('[data-dnd-ai-homebrew-tab]');
      if (!button) {
        button = doc.createElement('button');
        button.type = 'button';
        button.className = 'dnd-tab';
        button.dataset.dndAiHomebrewTab = 'homebrew';
        button.textContent = 'AI Homebrew';
        tabs.appendChild(button);
      }
      button.classList.toggle('active', state.active);
      return button;
    }

    function optionList(values, current, labels = {}) {
      return values.map((value) => `<option value="${escapeHtml(value)}" ${selected(value, current)}>${escapeHtml(labels[value] || value)}</option>`).join('');
    }

    function inspirationRow(item, index) {
      const limit = item.authorization === 'short-excerpt' ? 700 : 1800;
      return `<article class="dnd-ai-homebrew-inspiration" data-inspiration-index="${index}"><div class="panel-heading"><div><span class="eyebrow">Authorized inspiration ${index + 1}</span><h4>${escapeHtml(item.label || 'New inspiration')}</h4></div><button class="button danger" type="button" data-ai-homebrew-action="remove-inspiration" data-index="${index}" ${state.input.inspirations.length <= 1 ? 'disabled' : ''}>Remove</button></div><div class="form-grid"><label>Label<input name="inspirationLabel${index}" maxlength="180" value="${escapeHtml(item.label)}" placeholder="My campaign faction concept"></label><label>Authorization<select name="inspirationAuthorization${index}">${optionList(AUTHORIZATIONS, item.authorization, { 'user-owned': 'User-owned', licensed: 'Licensed', 'public-domain': 'Public domain', 'summary-only': 'Summary only', 'short-excerpt': 'Permitted short excerpt' })}</select></label></div><label>Bounded summary or permitted excerpt<textarea name="inspirationSummary${index}" rows="4" maxlength="${limit}" placeholder="Describe high-level themes, mechanics, or a permitted short excerpt.">${escapeHtml(item.summary)}</textarea><small>${limit} characters maximum. Full books, scans, OCR, and reconstruction requests are prohibited.</small></label><label>Design signals<textarea name="inspirationSignals${index}" rows="2" maxlength="3600" placeholder="armored inventor, risk-reward heat, team support">${escapeHtml(item.designSignals)}</textarea><small>Up to 12 short signals, separated by commas or lines.</small></label><label class="toggle-row"><span><strong>I may submit this material</strong><small>I confirm this is user-owned, licensed, public-domain, a high-level summary, or a permitted short excerpt.</small></span><input name="inspirationPermission${index}" type="checkbox" ${item.permissionConfirmed ? 'checked' : ''}></label></article>`;
    }

    function collectInput() {
      const form = doc.getElementById('dndAiHomebrewForm');
      if (!form) return state.input;
      const inspirations = state.input.inspirations.map((_item, index) => ({
        label: form.elements[`inspirationLabel${index}`]?.value || '',
        authorization: form.elements[`inspirationAuthorization${index}`]?.value || 'user-owned',
        permissionConfirmed: Boolean(form.elements[`inspirationPermission${index}`]?.checked),
        summary: form.elements[`inspirationSummary${index}`]?.value || '',
        designSignals: form.elements[`inspirationSignals${index}`]?.value || ''
      }));
      state.input = {
        campaignId: campaignId(),
        contentType: form.elements.contentType.value,
        system: form.elements.system.value,
        titleHint: form.elements.titleHint.value,
        concept: form.elements.concept.value,
        targetTier: form.elements.targetTier.value,
        powerLevel: form.elements.powerLevel.value,
        constraints: form.elements.constraints.value,
        inspirations
      };
      return state.input;
    }

    function previewHtml() {
      if (!state.preview) return '<div class="callout">Preview validates copyright authorization and shows the exact bounded request before anything is sent to Khaos Nexus AI.</div>';
      const metrics = state.preview.metrics || {};
      return `<article class="dnd-ai-homebrew-preview"><div class="panel-heading"><div><span class="eyebrow">Validated request preview</span><h4>${Number(metrics.requestCharacters || 0).toLocaleString()} request characters</h4></div><div class="dnd-ai-homebrew-metrics"><span class="tag success">${Number(metrics.inspirations || 0)} inspirations</span><span class="tag">${Number(metrics.inspirationCharacters || 0)} / ${Number(metrics.inspirationLimit || 6000)}</span></div></div><details open><summary>Exact request sent to the AI service</summary><pre>${escapeHtml(JSON.stringify(state.preview.request || {}, null, 2))}</pre></details><p class="dnd-ai-homebrew-policy">Raw inspiration is used only for this explicit request and is not saved in local proposals, audits, diagnostics, public state, or Discord runtime data.</p></article>`;
    }

    function generatorHtml() {
      const input = state.input;
      const service = state.payload?.service || {};
      return `<article class="panel dnd-ai-homebrew-generator"><div class="panel-heading"><div><span class="eyebrow">Original content proposal</span><h3>Generate AI Homebrew</h3></div><span class="tag ${service.reachable ? 'success' : 'warning'}">${service.reachable ? 'AI service connected' : 'AI service unavailable'}</span></div><div class="callout warning"><strong>Copyright boundary:</strong> Submit original ideas or authorized high-level inspiration only. Do not upload sourcebooks, scans, OCR, full stat blocks, or requests to copy or reconstruct published content.</div><form id="dndAiHomebrewForm"><div class="form-grid three"><label>Content type<select name="contentType">${optionList(CONTENT_TYPES, input.contentType)}</select></label><label>System<input name="system" maxlength="120" value="${escapeHtml(input.system)}"></label><label>Title hint<input name="titleHint" maxlength="180" value="${escapeHtml(input.titleHint)}" placeholder="Emberforged Aegis"></label></div><label>Original concept<textarea name="concept" rows="6" maxlength="6000" required placeholder="Describe the original theme, intended play experience, core mechanics, and campaign role.">${escapeHtml(input.concept)}</textarea></label><div class="form-grid"><label>Target tier<select name="targetTier">${optionList(TARGET_TIERS, input.targetTier)}</select></label><label>Power level<select name="powerLevel">${optionList(POWER_LEVELS, input.powerLevel)}</select></label></div><label>Constraints<textarea name="constraints" rows="3" maxlength="3000" placeholder="Action economy, resource limits, table complexity, setting restrictions…">${escapeHtml(input.constraints)}</textarea></label><fieldset><legend>Authorized inspiration</legend><div class="dnd-ai-homebrew-inspirations">${input.inspirations.map(inspirationRow).join('')}</div><button class="button" type="button" data-ai-homebrew-action="add-inspiration" ${input.inspirations.length >= 8 ? 'disabled' : ''}>Add Inspiration</button></fieldset>${previewHtml()}<div class="form-actions"><button class="button" type="button" data-ai-homebrew-action="refresh-service">Test AI Service</button><button class="button" type="button" data-ai-homebrew-action="preview">Preview Request</button><button class="button primary" type="submit" ${state.busy || !service.reachable ? 'disabled' : ''}>${state.busy ? 'Generating…' : service.reachable ? 'Generate Proposal' : 'Connect AI Service First'}</button></div></form></article>`;
    }

    function arrayList(title, values) {
      return values?.length ? `<section><h5>${escapeHtml(title)}</h5><ul>${values.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : '';
    }

    function proposalCard(proposal) {
      const result = proposal.result || {};
      const originality = result.originality || { status: 'original', concerns: [] };
      const needsReview = originality.status === 'needs-review';
      const mechanics = (result.mechanics || []).map((item) => `<article class="dnd-ai-homebrew-mechanic"><strong>${escapeHtml(item.name || 'Mechanic')}</strong><p>${escapeHtml(item.description || '')}</p>${item.activation ? `<small>Activation: ${escapeHtml(item.activation)}</small>` : ''}${item.limits ? `<small>Limits: ${escapeHtml(item.limits)}</small>` : ''}${item.scaling ? `<small>Scaling: ${escapeHtml(item.scaling)}</small>` : ''}</article>`).join('');
      const sections = (result.sections || []).map((item) => `<section><h5>${escapeHtml(item.heading || 'Rules')}</h5><p>${escapeHtml(item.rulesText || '')}</p></section>`).join('');
      return `<article class="panel dnd-ai-homebrew-proposal" data-proposal-id="${escapeHtml(proposal.id)}"><div class="panel-heading"><div><span class="eyebrow">${escapeHtml(result.contentType || 'other')} · ${escapeHtml(proposal.provider || 'Khaos Nexus AI')} / ${escapeHtml(proposal.model || 'service model')}</span><h3>${escapeHtml(result.title)}</h3><small>${escapeHtml(proposal.generatedAt || proposal.createdAt || '')}</small></div><span class="tag ${needsReview ? 'warning' : 'success'}">${escapeHtml(originality.status || 'original')}</span></div><p>${escapeHtml(result.summary)}</p>${arrayList('Design goals', result.designGoals)}${sections}${mechanics ? `<section><h5>Mechanics</h5><div class="dnd-ai-homebrew-mechanics">${mechanics}</div></section>` : ''}${arrayList('Balance assumptions', result.balance?.assumptions)}${arrayList('Balance risks', result.balance?.risks)}${arrayList('Playtest checks', result.balance?.playtestChecks)}${arrayList('Originality concerns', originality.concerns)}<details><summary>Provenance and generation details</summary><pre>${escapeHtml(JSON.stringify({ provenance: result.provenance, requestSummary: proposal.requestSummary }, null, 2))}</pre></details><div class="form-actions"><button class="button" data-ai-homebrew-action="copy-proposal" data-id="${escapeHtml(proposal.id)}">Copy Proposal</button><button class="button danger" data-ai-homebrew-action="delete-proposal" data-id="${escapeHtml(proposal.id)}">Delete</button><button class="button primary" data-ai-homebrew-action="convert-proposal" data-id="${escapeHtml(proposal.id)}">Convert to Homebrew Draft</button></div></article>`;
    }

    function proposalsHtml() {
      const proposals = state.payload?.proposals || [];
      return `<section class="dnd-ai-homebrew-history"><div class="panel-heading"><div><span class="eyebrow">Private local review queue</span><h2>AI Homebrew Proposals</h2></div><span class="tag">${proposals.length} proposals</span></div>${proposals.length ? proposals.map(proposalCard).join('') : '<article class="panel empty-state"><h3>No AI homebrew proposals</h3><p>Generate an original proposal, review it here, then explicitly convert it into the existing homebrew draft workflow.</p></article>'}</section>`;
    }

    function render() {
      if (!state.active) return;
      const rootElement = doc.getElementById('view-dnd');
      const panel = rootElement?.querySelector('.dnd-tab-panel');
      if (!rootElement || !panel) return;
      rootElement.querySelectorAll('.dnd-tabs button').forEach((item) => item.classList.remove('active'));
      ensureTab(rootElement)?.classList.add('active');
      panel.innerHTML = `<div class="dnd-ai-homebrew"><div class="dnd-ai-homebrew-hero"><div><span class="eyebrow">D&D AI-assisted creation</span><h2>AI Homebrew Studio</h2><p>Generate original, copyright-safe proposals through Khaos Nexus AI and route approved ideas into the existing draft, submit, review, and approval workflow.</p></div><div><span class="tag success">Proposal first</span> <span class="tag">Never auto-approved</span></div></div>${generatorHtml()}${proposalsHtml()}</div>`;
    }

    async function refresh(refreshService = false) {
      state.payload = await invoke('dnd:ai-homebrew-get', { campaignId: campaignId(), refreshService });
      const current = campaign();
      if (!state.input.campaignId || state.input.campaignId !== campaignId()) state.input = defaultInput(campaignId(), current?.ruleset || '');
      render();
      return state.payload;
    }

    function proposalById(id) {
      return (state.payload?.proposals || []).find((item) => item.id === id);
    }

    async function handleAction(button) {
      const action = button.dataset.aiHomebrewAction;
      if (action === 'add-inspiration') {
        collectInput();
        if (state.input.inspirations.length < 8) state.input.inspirations.push({ label: '', authorization: 'user-owned', permissionConfirmed: false, summary: '', designSignals: '' });
        state.preview = null;
        return render();
      }
      if (action === 'remove-inspiration') {
        collectInput();
        state.input.inspirations.splice(Number(button.dataset.index), 1);
        if (!state.input.inspirations.length) state.input.inspirations.push({ label: '', authorization: 'user-owned', permissionConfirmed: false, summary: '', designSignals: '' });
        state.preview = null;
        return render();
      }
      if (action === 'refresh-service') {
        await refresh(true);
        return notify(state.payload?.service?.reachable ? 'Khaos Nexus AI connection succeeded.' : state.payload?.service?.error || 'Khaos Nexus AI is unavailable.');
      }
      if (action === 'preview') {
        state.input = collectInput();
        state.preview = await invoke('dnd:ai-homebrew-preview', state.input);
        return render();
      }
      const id = button.dataset.id;
      const proposal = proposalById(id);
      if (!proposal) return;
      if (action === 'copy-proposal') {
        await win.navigator.clipboard.writeText(JSON.stringify(proposal.result, null, 2));
        return notify('AI homebrew proposal copied.');
      }
      if (action === 'delete-proposal') {
        if (!win.confirm(`Delete the AI proposal “${proposal.result.title}”?`)) return;
        const response = await invoke('dnd:ai-homebrew-delete', { proposalId: id, campaignId: campaignId() });
        state.payload = response.state;
        notify('AI homebrew proposal deleted.');
        return render();
      }
      if (action === 'convert-proposal') {
        const needsReview = proposal.result.originality?.status === 'needs-review';
        let acknowledgedOriginality = false;
        if (needsReview) {
          acknowledgedOriginality = win.confirm(`This proposal has originality concerns:\n\n${(proposal.result.originality.concerns || []).join('\n')}\n\nAcknowledge these concerns and still convert it into a draft for human review?`);
          if (!acknowledgedOriginality) return;
        }
        if (!win.confirm(`Convert “${proposal.result.title}” into a normal homebrew draft? It will not be submitted or approved automatically.`)) return;
        const response = await invoke('dnd:ai-homebrew-convert', { proposalId: id, confirmed: true, acknowledgedOriginality });
        state.payload = response.state;
        notify('AI proposal converted into a homebrew draft. Open Library to edit or submit it.');
        return render();
      }
    }

    async function generate(form) {
      if (state.busy) return;
      state.input = collectInput();
      state.preview = await invoke('dnd:ai-homebrew-preview', state.input);
      if (!win.confirm(`Send this validated request to Khaos Nexus AI?\n\n${state.preview.metrics.inspirations} inspiration record(s), ${state.preview.metrics.inspirationCharacters} authorized inspiration characters. Raw inspiration will not be saved in the desktop proposal.`)) {
        return render();
      }
      state.busy = true;
      render();
      try {
        const response = await invoke('dnd:ai-homebrew-generate', state.input);
        state.payload = response.state;
        state.preview = null;
        state.input = defaultInput(campaignId(), campaign()?.ruleset || '');
        notify('AI homebrew proposal generated for review.');
      } finally {
        state.busy = false;
        render();
      }
    }

    function attach() {
      const rootElement = doc.getElementById('view-dnd');
      if (!rootElement || !win.khaos?.invoke) {
        state.attachTimer = win.setTimeout(attach, 50);
        return;
      }
      ensureTab(rootElement);
      doc.addEventListener('click', async (event) => {
        const tab = event.target.closest?.('[data-dnd-ai-homebrew-tab]');
        if (tab) {
          event.preventDefault();
          event.stopImmediatePropagation();
          state.active = true;
          try { await refresh(true); } catch (error) { notify(error.message || String(error)); }
          return;
        }
        if (event.target.closest?.('#view-dnd .dnd-tabs button:not([data-dnd-ai-homebrew-tab])')) state.active = false;
        const button = event.target.closest?.('[data-ai-homebrew-action]');
        if (!button) return;
        event.preventDefault();
        try { await handleAction(button); } catch (error) { notify(error.message || String(error)); }
      }, true);
      doc.addEventListener('submit', async (event) => {
        if (event.target.id !== 'dndAiHomebrewForm') return;
        event.preventDefault();
        try { await generate(event.target); } catch (error) { state.busy = false; render(); notify(error.message || String(error)); }
      }, true);
      doc.addEventListener('change', (event) => {
        if (event.target.id === 'dndCampaignSelect' && state.active) {
          state.input = defaultInput(campaignId(), campaign()?.ruleset || '');
          state.preview = null;
          refresh().catch((error) => notify(error.message || String(error)));
        }
        if (/^inspirationAuthorization\d+$/.test(event.target.name || '')) {
          collectInput();
          state.preview = null;
          render();
        }
      }, true);
      if (typeof win.MutationObserver === 'function') {
        state.observer = new win.MutationObserver(() => {
          ensureTab(rootElement);
          if (!state.active || state.recovering) return;
          const panel = rootElement.querySelector('.dnd-tab-panel');
          if (panel?.querySelector('.dnd-ai-homebrew')) return;
          state.recovering = true;
          Promise.resolve(refresh()).catch(() => {}).finally(() => { state.recovering = false; });
        });
        state.observer.observe(rootElement, { childList: true, subtree: true });
      }
      win.__khaosDndAiHomebrew = { state, refresh, render };
    }

    attach();
    return win.__khaosDndAiHomebrew;
  }

  return { install, defaultInput };
});
