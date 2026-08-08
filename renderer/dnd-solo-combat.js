'use strict';

(function bootstrapSoloCombat(root) {
  if (!root?.document || root.__khaosDndSoloCombat) return;
  const doc = root.document;
  const state = { payload: null, campaignId: '', busy: false, scheduled: false, attempts: 0 };
  const invoke = (channel, payload) => root.khaos.invoke(channel, payload);
  const clean = (value, max = 4000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
  const notify = (message) => typeof root.toast === 'function' ? root.toast(message) : undefined;
  const campaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value || state.campaignId, 100);
  const activeRun = () => state.payload?.runs?.find((item) => item.status === 'active') || null;
  const activeScene = () => state.payload?.scenes?.find((item) => item.status === 'active') || null;
  const activeCombat = () => state.payload?.activeCombat || null;
  const currentCombatant = () => {
    const combat = activeCombat();
    return combat?.combatants?.find((item) => item.id === combat.turnOrder?.[combat.currentIndex]) || null;
  };
  const schedule = () => { if (!state.scheduled) { state.scheduled = true; root.requestAnimationFrame(() => { state.scheduled = false; render(); }); } };
  const setBusy = (value) => { state.busy = Boolean(value); schedule(); };
  async function refresh(force = false) {
    const selected = campaignId();
    if (!selected) return;
    if (!force && state.payload && state.campaignId === selected) return;
    state.campaignId = selected;
    state.payload = await invoke('dnd:solo-combat-get', { campaignId: selected });
    schedule();
  }

  function soloPanel() {
    const adventure = state.payload?.adventures?.find((item) => item.status === 'active');
    const characters = state.payload?.characters || [];
    if (adventure) return `<div class="dnd-runtime-callout success"><strong>Solo adventure active</strong><span>Run ${esc(adventure.runId)} · player seat ${esc(adventure.playerSeatId)}</span></div>`;
    return `<form data-solo-form="start" class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Veyra-led solo play</span><h4>Solo Quick Start</h4></div></div><label>Player character<select name="characterId" required><option value="">Select a character</option>${characters.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · level ${esc(item.level || '?')} ${esc(item.className || '')}</option>`).join('')}</select></label><label>Opening location<input name="locationName" value="The Beginning" required></label><label>Opening description<textarea name="publicDescription" rows="3">Your adventure begins.</textarea></label><button class="button primary" type="submit">Start Solo Adventure</button></form>`;
  }

  function combatStartPanel() {
    const run = activeRun(), scene = activeScene();
    if (!run || !scene) return `<div class="dnd-runtime-callout warning"><strong>Start a campaign run and scene first</strong><span>Combat is attached to authoritative campaign state.</span></div>`;
    return `<form data-solo-form="combat-start" class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Deterministic rules</span><h4>Start Combat</h4></div></div><label>Enemy name<input name="enemyName" value="Hostile creature" required></label><div class="form-grid"><label>HP<input name="enemyHp" type="number" min="1" value="12"></label><label>Armor class<input name="enemyAc" type="number" min="1" value="12"></label><label>Initiative modifier<input name="enemyInitiative" type="number" value="0"></label></div><button class="button primary" type="submit">Roll Initiative</button></form>`;
  }

  function combatPanel() {
    const combat = activeCombat();
    if (!combat) return combatStartPanel();
    const actor = currentCombatant();
    const targets = combat.combatants.filter((item) => item.id !== actor?.id && !item.defeated && !item.deathSaves?.dead);
    const canDeathSave = actor?.characterId && actor.currentHp === 0 && !actor.deathSaves?.stable && !actor.deathSaves?.dead;
    return `<div class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Round ${esc(combat.round)} · turn ${esc(combat.turnNumber)}</span><h4>Combat</h4></div><span class="tag">${esc(actor?.name || 'No actor')}</span></div><div class="dnd-combat-order">${combat.turnOrder.map((id, index) => { const item = combat.combatants.find((entry) => entry.id === id); if (!item) return ''; return `<article class="${index === combat.currentIndex ? 'active' : ''}"><strong>${esc(item.initiative)}</strong><span>${esc(item.name)}${item.conditions?.length ? ` · ${esc(item.conditions.join(', '))}` : ''}</span><span class="dnd-combat-hp">${esc(item.currentHp)}/${esc(item.maxHp)} HP</span></article>`; }).join('')}</div>${actor && !canDeathSave ? `<form data-solo-form="attack" class="dnd-runtime-stack"><h5>Resolve attack</h5><label>Target<select name="targetId">${targets.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · AC ${esc(item.armorClass)}</option>`).join('')}</select></label><div class="form-grid"><label>Attack modifier<input name="attackModifier" type="number" value="5"></label><label>Damage dice count<input name="damageDiceCount" type="number" min="1" value="1"></label><label>Damage die sides<input name="damageDiceSides" type="number" min="2" value="8"></label><label>Damage modifier<input name="damageModifier" type="number" value="3"></label></div><label>Damage type<input name="damageType" value="slashing"></label><button class="button primary" type="submit">Attack</button></form>` : ''}<div class="dnd-combat-actions">${actor && !canDeathSave ? '<button class="button" data-solo-action="dodge">Dodge</button><button class="button" data-solo-action="dash">Dash</button>' : ''}${canDeathSave ? '<button class="button danger" data-solo-action="death-save">Roll Death Save</button>' : ''}<button class="button" data-solo-action="end-turn">End Turn</button><button class="button danger" data-solo-action="end-combat">End Combat</button></div></div>`;
  }

  function memoryPanel() {
    const memories = state.payload?.memories || [];
    return `<div class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Inspectable campaign truth</span><h4>Memory Ledger</h4></div><span class="tag">${memories.length}</span></div><form data-solo-form="memory" class="dnd-runtime-stack"><label>Memory<textarea name="text" rows="2" required></textarea></label><div class="form-grid"><label>Visibility<select name="visibility"><option value="party">Party</option><option value="selected_characters">Selected characters</option><option value="dm_only">DM only</option></select></label><label>Status<select name="status"><option value="correct">Correct</option><option value="incorrect">Incorrect</option><option value="outdated">Outdated</option><option value="forgotten">Forgotten</option></select></label></div><label>Character IDs <small>comma-separated for private memories</small><input name="characterIds"></label><button class="button" type="submit">Save Memory</button></form><div class="dnd-memory-list">${memories.slice().reverse().map((item) => `<article><strong>${esc(item.text)}</strong><small>${esc(item.visibility)} · ${esc(item.status)}</small></article>`).join('')}</div></div>`;
  }

  function render() {
    const view = doc.getElementById('view-dnd');
    if (!view || !state.payload) return;
    let mount = view.querySelector('[data-dnd-solo-combat]');
    if (!mount) { mount = doc.createElement('section'); mount.dataset.dndSoloCombat = '1'; view.appendChild(mount); }
    mount.innerHTML = `<article class="panel dnd-solo-combat"><div class="panel-heading"><div><span class="eyebrow">Production D&D runtime</span><h3>Solo Play & Combat Engine</h3><p>Deterministic campaign actions remain local and auditable. Veyra cannot directly change mechanical state.</p></div><button class="button" data-solo-action="refresh" ${state.busy ? 'disabled' : ''}>Refresh</button></div><div class="dnd-solo-grid"><section>${soloPanel()}</section><section>${combatPanel()}</section><section>${memoryPanel()}</section><section><div class="dnd-runtime-callout success"><strong>Production safeguards active</strong><span>Mechanical state stays deterministic and automatic Discord publication remains disabled.</span></div><p class="muted">Solo play supports campaign setup, inspectable memory, initiative, action economy, attacks, damage, concentration checks, death saves, and checkpointed combat completion.</p></section></div></article>`;
  }

  async function submit(event) {
    const form = event.target.closest('[data-solo-form]');
    if (!form || state.busy) return;
    event.preventDefault();
    const data = new FormData(form), selected = campaignId();
    try {
      setBusy(true);
      if (form.dataset.soloForm === 'start') await invoke('dnd:solo-adventure-start', { campaignId: selected, characterId: data.get('characterId'), locationName: data.get('locationName'), publicDescription: data.get('publicDescription') });
      if (form.dataset.soloForm === 'combat-start') await invoke('dnd:combat-start', { campaignId: selected, runId: activeRun().id, sceneId: activeScene().id, seatIds: activeScene().participantSeatIds || [], clientCombatId: root.crypto?.randomUUID?.() || `${Date.now()}`, enemies: [{ name: data.get('enemyName'), hp: Number(data.get('enemyHp')), maxHp: Number(data.get('enemyHp')), armorClass: Number(data.get('enemyAc')), initiativeModifier: Number(data.get('enemyInitiative')), actorType: 'enemy' }] });
      if (form.dataset.soloForm === 'attack') await invoke('dnd:combat-attack', { campaignId: selected, combatId: activeCombat().id, actorId: currentCombatant().id, targetId: data.get('targetId'), attackModifier: Number(data.get('attackModifier')), damageDiceCount: Number(data.get('damageDiceCount')), damageDiceSides: Number(data.get('damageDiceSides')), damageModifier: Number(data.get('damageModifier')), damageType: data.get('damageType'), idempotencyKey: root.crypto?.randomUUID?.() || `${Date.now()}` });
      if (form.dataset.soloForm === 'memory') await invoke('dnd:solo-memory-save', { campaignId: selected, runId: activeRun()?.id || '', text: data.get('text'), visibility: data.get('visibility'), status: data.get('status'), characterIds: clean(data.get('characterIds'), 1000).split(',').map((item) => item.trim()).filter(Boolean) });
      await refresh(true); notify('Solo/combat state updated.');
    } catch (error) { notify(error.message || String(error)); }
    finally { setBusy(false); }
  }

  async function click(event) {
    const button = event.target.closest('[data-solo-action]');
    if (!button || state.busy) return;
    const selected = campaignId(), combat = activeCombat(), actor = currentCombatant();
    try {
      setBusy(true);
      if (button.dataset.soloAction === 'refresh') await refresh(true);
      if (button.dataset.soloAction === 'dodge' || button.dataset.soloAction === 'dash') await invoke('dnd:combat-action', { campaignId: selected, combatId: combat.id, actorId: actor.id, action: button.dataset.soloAction, idempotencyKey: root.crypto?.randomUUID?.() || `${Date.now()}` });
      if (button.dataset.soloAction === 'death-save') await invoke('dnd:combat-death-save', { campaignId: selected, combatId: combat.id, combatantId: actor.id, idempotencyKey: root.crypto?.randomUUID?.() || `${Date.now()}` });
      if (button.dataset.soloAction === 'end-turn') await invoke('dnd:combat-end-turn', { campaignId: selected, combatId: combat.id, actorId: actor.id, idempotencyKey: root.crypto?.randomUUID?.() || `${Date.now()}` });
      if (button.dataset.soloAction === 'end-combat' && root.confirm('End combat and create a campaign checkpoint?')) await invoke('dnd:combat-end', { campaignId: selected, combatId: combat.id, confirmed: true, outcome: 'resolved' });
      await refresh(true);
    } catch (error) { notify(error.message || String(error)); }
    finally { setBusy(false); }
  }

  doc.addEventListener('submit', submit);
  doc.addEventListener('click', click);
  doc.addEventListener('change', (event) => { if (event.target?.id === 'dndCampaignSelect') { state.payload = null; refresh(true).catch(() => {}); } });
  root.khaos?.on?.('dnd:solo-combat-update', (next) => { state.payload = next; state.campaignId = next.selectedCampaignId || state.campaignId; schedule(); });
  const observer = new MutationObserver(() => { if (doc.getElementById('view-dnd') && !doc.querySelector('[data-dnd-solo-combat]')) schedule(); });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  root.__khaosDndSoloCombat = { refresh };
  const start = () => refresh(true).catch(() => { if (++state.attempts < 20) root.setTimeout(start, 250); });
  start(); schedule();
})(typeof window !== 'undefined' ? window : null);
