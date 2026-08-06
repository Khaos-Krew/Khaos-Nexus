'use strict';

(function bootstrapGroupRuntime(root) {
  if (!root?.document || root.__khaosDndGroupRuntime) return;
  const doc = root.document;
  const state = { payload: null, campaignId: '', busy: false, scheduled: false, attempts: 0 };
  const invoke = (channel, payload) => root.khaos.invoke(channel, payload);
  const clean = (value, max = 4000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
  const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[c]);
  const notify = (message) => typeof root.toast === 'function' ? root.toast(message) : undefined;
  const campaignId = () => clean(doc.getElementById('dndCampaignSelect')?.value || state.campaignId, 100);
  const activeSession = () => state.payload?.sessions?.find((item) => item.status === 'active') || null;
  const activeRound = () => state.payload?.rounds?.find((item) => ['collecting','locked','resolving'].includes(item.status)) || null;
  const openDecision = () => state.payload?.decisions?.find((item) => item.status === 'open') || null;
  const schedule = () => { if (!state.scheduled) { state.scheduled = true; root.requestAnimationFrame(() => { state.scheduled = false; render(); }); } };
  const setBusy = (value) => { state.busy = Boolean(value); schedule(); };
  async function refresh(force = false) {
    const selected = campaignId();
    if (!selected) return;
    if (!force && state.payload && state.campaignId === selected) return;
    state.campaignId = selected;
    state.payload = await invoke('dnd:group-runtime-get', { campaignId: selected });
    schedule();
  }
  function sessionPanel() {
    const session = activeSession();
    const seats = state.payload?.seats || [];
    const run = state.payload?.runs?.find((item) => item.status === 'active');
    const scene = state.payload?.scenes?.find((item) => item.status === 'active');
    if (!session) return `<form data-group-form="session" class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Two to six participants</span><h4>Group Session</h4></div></div>${!run || !scene ? '<div class="dnd-runtime-callout warning"><strong>Start a run and scene first</strong><span>Group coordination attaches to authoritative campaign state.</span></div>' : ''}<label>Participant seats <small>comma-separated IDs</small><input name="seatIds" value="${esc(seats.filter((item)=>item.type==='human_player').map((item)=>item.id).join(', '))}" required></label><div class="form-grid"><label>Pace<select name="pace"><option value="asynchronous">Asynchronous</option><option value="live">Live</option><option value="mixed">Mixed</option></select></label><label>Resolution<select name="resolutionPolicy"><option value="all_required">All required</option><option value="majority">Majority</option><option value="party_leader">Party leader</option><option value="deadline">Deadline</option><option value="human_dm">Human DM</option></select></label><label>Absence policy<select name="absencePolicy"><option value="background">Background</option><option value="ai_conservative">AI conservative</option><option value="temporary_controller">Temporary controller</option><option value="leave_scene">Leave scene</option><option value="pause">Pause</option></select></label><label>Deadline hours<input name="deadlineHours" type="number" min="1" max="168" value="24"></label></div><button class="button primary" type="submit" ${!run || !scene ? 'disabled' : ''}>Start Private Group Session</button></form>`;
    return `<div class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">${esc(session.pace)} · ${esc(session.resolutionPolicy)}</span><h4>Active Group</h4></div><span class="tag">${session.participants.length} seats</span></div><div class="dnd-group-participants">${session.participants.map((item)=>`<article><strong>${esc(item.displayName)}</strong><span>${esc(item.seatType)} · ${esc(item.status)}${item.ready?' · ready':''}</span><button class="button" data-group-action="toggle-absence" data-seat-id="${esc(item.seatId)}" data-status="${item.status==='absent'?'active':'absent'}">${item.status==='absent'?'Return':'Absent'}</button></article>`).join('')}</div></div>`;
  }
  function roundPanel() {
    const session=activeSession(); if(!session) return '<p class="muted">Start a group session first.</p>';
    const round=activeRound();
    if(!round) return `<form data-group-form="round" class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Shared action collection</span><h4>Open Round</h4></div></div><label>Scene prompt<textarea name="prompt" rows="3" required></textarea></label><label>Deadline hours<input name="deadlineHours" type="number" min="1" max="168" value="${esc(session.defaultDeadlineHours||24)}"></label><button class="button primary" type="submit">Open Group Round</button></form>`;
    const participants=session.participants.filter((item)=>item.status!=='left');
    return `<div class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Round ${round.number} · ${esc(round.status)}</span><h4>${esc(round.prompt)}</h4></div><span class="tag">${round.actions.length}/${round.requiredSeatIds.length}</span></div>${['collecting','locked'].includes(round.status)?`<form data-group-form="action" class="dnd-runtime-stack"><label>Participant<select name="seatId">${participants.map((item)=>`<option value="${esc(item.seatId)}">${esc(item.displayName)}</option>`).join('')}</select></label><label>Declaration<textarea name="declaration" rows="3" required></textarea></label><div class="form-grid"><label>Audience<select name="audience"><option value="party">Party</option><option value="dm_only">DM only</option></select></label><label>Private guidance<input name="privateGuidance"></label></div><button class="button" type="submit">Submit Action</button></form>`:''}<div class="dnd-group-actions">${round.actions.map((item)=>`<article class="${item.audience==='dm_only'?'dnd-group-private':''}"><strong>${esc(item.status)}</strong><span>${esc(item.audience==='dm_only'?'Private declaration':item.declaration)}</span>${item.status!=='locked'?`<button class="button" data-group-action="lock" data-round-id="${esc(round.id)}" data-action-id="${esc(item.id)}">Lock</button>`:''}</article>`).join('')}</div>${round.status==='locked'?`<button class="button primary" data-group-action="resolve" data-round-id="${esc(round.id)}">Resolve with Veyra</button>`:''}${round.status==='resolving'?'<div class="dnd-runtime-callout">Veyra is preparing party-visible narration.</div>':''}</div>`;
  }
  function decisionPanel(){
    const session=activeSession(); if(!session) return '<p class="muted">No active group.</p>';
    const decision=openDecision();
    if(!decision)return `<form data-group-form="decision" class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">Party choice</span><h4>Start Vote</h4></div></div><label>Question<input name="question" required></label><label>Options <small>one per line</small><textarea name="options" rows="3" required></textarea></label><label>Policy<select name="policy"><option value="majority">Majority</option><option value="unanimous">Unanimous</option><option value="party_leader">Party leader</option></select></label><button class="button" type="submit">Open Vote</button></form>`;
    return `<div class="dnd-runtime-stack"><div class="panel-heading"><div><span class="eyebrow">${esc(decision.policy)}</span><h4>${esc(decision.question)}</h4></div><span class="tag">${decision.votes.length}/${decision.eligibleSeatIds.length}</span></div><form data-group-form="vote" class="form-grid"><label>Seat<select name="seatId">${session.participants.filter((item)=>decision.eligibleSeatIds.includes(item.seatId)).map((item)=>`<option value="${esc(item.seatId)}">${esc(item.displayName)}</option>`).join('')}</select></label><label>Option<select name="option">${decision.options.map((item)=>`<option value="${esc(item)}">${esc(item)}</option>`).join('')}</select></label><button class="button" type="submit">Cast Vote</button></form></div>`;
  }
  function deliveryPanel(){
    const deliveries=(state.payload?.deliveries||[]).filter((item)=>['review','approved'].includes(item.status)).slice().reverse();
    return `<div class="dnd-runtime-stack dnd-group-review"><div class="panel-heading"><div><span class="eyebrow">Nothing sends automatically</span><h4>Delivery Review Queue</h4></div><span class="tag">${deliveries.length}</span></div><div class="dnd-group-deliveries">${deliveries.map((item)=>`<article class="${item.audience!=='party'?'dnd-group-private':''}"><strong>${esc(item.audience)}</strong><span>${esc(item.content)}</span><span><button class="button" data-group-action="approve-delivery" data-delivery-id="${esc(item.id)}">Approve</button><button class="button danger" data-group-action="discard-delivery" data-delivery-id="${esc(item.id)}">Discard</button></span></article>`).join('')}</div></div>`;
  }
  function render(){
    const view=doc.getElementById('view-dnd'); if(!view||!state.payload)return;
    let mount=view.querySelector('[data-dnd-group-runtime]'); if(!mount){mount=doc.createElement('section');mount.dataset.dndGroupRuntime='1';view.appendChild(mount);}
    mount.innerHTML=`<article class="panel dnd-group-runtime"><div class="panel-heading"><div><span class="eyebrow">Private development slice</span><h3>Group Play Coordination</h3><p>Live or asynchronous action collection, absence handling, voting, and reviewed delivery drafts. No Discord message is sent automatically.</p></div><button class="button" data-group-action="refresh" ${state.busy?'disabled':''}>Refresh</button></div><div class="dnd-group-grid"><section>${sessionPanel()}</section><section>${roundPanel()}</section><section>${decisionPanel()}</section><section>${deliveryPanel()}</section></div><div class="dnd-runtime-callout warning"><strong>Release prohibited</strong><span>This remains a private stacked build with no updater, deployment, tag, or automatic Discord publication.</span></div></article>`;
  }
  async function submit(event){
    const form=event.target.closest('[data-group-form]');if(!form||state.busy)return;event.preventDefault();const data=new FormData(form),selected=campaignId(),session=activeSession(),round=activeRound(),run=state.payload?.runs?.find((item)=>item.status==='active'),scene=state.payload?.scenes?.find((item)=>item.status==='active');
    try{setBusy(true);
      if(form.dataset.groupForm==='session')await invoke('dnd:group-session-start',{campaignId:selected,runId:run.id,sceneId:scene.id,participants:clean(data.get('seatIds'),2000).split(',').map((seatId)=>({seatId:seatId.trim()})).filter((item)=>item.seatId),pace:data.get('pace'),resolutionPolicy:data.get('resolutionPolicy'),absencePolicy:data.get('absencePolicy'),defaultDeadlineHours:Number(data.get('deadlineHours')),clientSessionId:root.crypto?.randomUUID?.()||`${Date.now()}`});
      if(form.dataset.groupForm==='round')await invoke('dnd:group-round-open',{campaignId:selected,sessionId:session.id,prompt:data.get('prompt'),deadlineHours:Number(data.get('deadlineHours')),clientRoundId:root.crypto?.randomUUID?.()||`${Date.now()}`});
      if(form.dataset.groupForm==='action')await invoke('dnd:group-action-submit',{campaignId:selected,roundId:round.id,seatId:data.get('seatId'),declaration:data.get('declaration'),audience:data.get('audience'),privateGuidance:data.get('privateGuidance'),clientActionId:root.crypto?.randomUUID?.()||`${Date.now()}`});
      if(form.dataset.groupForm==='decision')await invoke('dnd:group-decision-start',{campaignId:selected,sessionId:session.id,roundId:round?.id||'',question:data.get('question'),options:clean(data.get('options'),4000).split(/\r?\n/).map((item)=>item.trim()).filter(Boolean),policy:data.get('policy'),clientDecisionId:root.crypto?.randomUUID?.()||`${Date.now()}`});
      if(form.dataset.groupForm==='vote')await invoke('dnd:group-vote-cast',{campaignId:selected,decisionId:openDecision().id,seatId:data.get('seatId'),option:data.get('option'),clientVoteId:root.crypto?.randomUUID?.()||`${Date.now()}`});
      await refresh(true);notify('Private group state updated.');
    }catch(error){notify(error.message||String(error));}finally{setBusy(false);}
  }
  async function click(event){
    const button=event.target.closest('[data-group-action]');if(!button||state.busy)return;const selected=campaignId(),session=activeSession();
    try{setBusy(true);
      if(button.dataset.groupAction==='refresh')await refresh(true);
      if(button.dataset.groupAction==='toggle-absence')await invoke('dnd:group-participant-status',{campaignId:selected,sessionId:session.id,seatId:button.dataset.seatId,status:button.dataset.status});
      if(button.dataset.groupAction==='lock')await invoke('dnd:group-action-lock',{campaignId:selected,roundId:button.dataset.roundId,actionId:button.dataset.actionId});
      if(button.dataset.groupAction==='resolve')await invoke('dnd:group-round-resolve',{campaignId:selected,roundId:button.dataset.roundId,clientTurnId:root.crypto?.randomUUID?.()||`${Date.now()}`});
      if(button.dataset.groupAction==='approve-delivery'||button.dataset.groupAction==='discard-delivery')await invoke('dnd:group-delivery-review',{campaignId:selected,deliveryId:button.dataset.deliveryId,action:button.dataset.groupAction==='discard-delivery'?'discard':'approve'});
      await refresh(true);
    }catch(error){notify(error.message||String(error));}finally{setBusy(false);}
  }
  doc.addEventListener('submit',submit);doc.addEventListener('click',click);doc.addEventListener('change',(event)=>{if(event.target?.id==='dndCampaignSelect'){state.payload=null;refresh(true).catch(()=>{});}});
  root.khaos?.on?.('dnd:group-runtime-update',(next)=>{state.payload=next;state.campaignId=next.selectedCampaignId||state.campaignId;schedule();});
  const observer=new MutationObserver(()=>{if(doc.getElementById('view-dnd')&&!doc.querySelector('[data-dnd-group-runtime]'))schedule();});observer.observe(doc.documentElement,{childList:true,subtree:true});
  root.__khaosDndGroupRuntime={refresh};const start=()=>refresh(true).catch(()=>{if(++state.attempts<20)root.setTimeout(start,250);});start();schedule();
})(typeof window!=='undefined'?window:null);
