'use strict';

(function bootstrapAttendanceStability(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function attendanceStabilityFactory() {
  const STATUSES = ['attending', 'maybe', 'unavailable', 'late'];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

  function linkedMembers(members = []) {
    return members.filter((member) => member.active !== false && (member.userId || member.discordUserId));
  }

  function attendanceFor(attendance = [], sessionId, member = {}) {
    return attendance.find((item) => item.sessionId === sessionId && (
      member.userId && item.userId === member.userId ||
      member.discordUserId && item.discordUserId === member.discordUserId
    )) || null;
  }

  function rowsHtml(members, attendance, sessionId) {
    return linkedMembers(members).map((member) => {
      const existing = attendanceFor(attendance, sessionId, member);
      return `<div class="dnd-attendance-row" data-member-id="${escapeHtml(member.id)}"><div><strong>${escapeHtml(member.displayName)}</strong><span>${escapeHtml(member.role)}</span></div><select data-attendance-status>${STATUSES.map((status) => `<option value="${status}" ${(existing?.status || 'maybe') === status ? 'selected' : ''}>${status}</option>`).join('')}</select><input data-attendance-note value="${escapeHtml(existing?.note || '')}" maxlength="500" placeholder="Optional note"></div>`;
    }).join('');
  }

  function install(win) {
    if (!win?.document || win.__khaosDndAttendanceStability) return win?.__khaosDndAttendanceStability || null;
    const state = win.__khaosDndOwnerWorkflows?.state;
    if (!state) {
      const retry = win.setTimeout(() => install(win), 25);
      return { retry };
    }
    const doc = win.document;

    function patch() {
      const editor = doc.querySelector('.dnd-attendance-editor');
      const select = editor?.querySelector('#dndOwnerAttendanceSession');
      if (!editor || !select || !state.payload) return;
      const campaignId = doc.getElementById('dndCampaignSelect')?.value || '';
      const sessions = (state.payload.state.sessions || []).filter((item) => item.campaignId === campaignId && ['planned', 'active'].includes(item.status));
      if (!sessions.length) return;
      if (!sessions.some((item) => item.id === state.attendanceSessionId)) state.attendanceSessionId = select.value || sessions[0].id;
      select.value = state.attendanceSessionId;
      const members = (state.payload.state.members || []).filter((item) => item.campaignId === campaignId);
      const attendance = state.payload.state.attendance || [];
      const list = editor.querySelector('.dnd-owner-list');
      const linked = linkedMembers(members);
      const unlinked = members.filter((member) => member.active !== false && !member.userId && !member.discordUserId);
      if (list) list.innerHTML = linked.length ? rowsHtml(members, attendance, state.attendanceSessionId) : '<p class="dnd-empty">Link a Nexus user or Discord user to a campaign member before recording attendance.</p>';
      let note = editor.querySelector('.dnd-attendance-identity-note');
      if (!note && unlinked.length) {
        note = doc.createElement('div');
        note.className = 'callout dnd-attendance-identity-note';
        editor.querySelector('.form-actions')?.before(note);
      }
      if (note) {
        note.textContent = unlinked.length ? `${unlinked.length} member(s) are not shown because attendance requires a linked Nexus or Discord identity.` : '';
        note.hidden = !unlinked.length;
      }
    }

    doc.addEventListener('change', (event) => {
      if (event.target?.id !== 'dndOwnerAttendanceSession') return;
      state.attendanceSessionId = event.target.value;
      win.setTimeout(patch, 0);
    }, true);

    const observer = new win.MutationObserver((records) => {
      if (records.some((record) => [...(record.addedNodes || [])].some((node) => node.nodeType === 1 && (node.matches?.('.dnd-attendance-editor') || node.querySelector?.('.dnd-attendance-editor'))))) win.setTimeout(patch, 0);
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    patch();
    const api = { patch, observer };
    win.__khaosDndAttendanceStability = api;
    return api;
  }

  return { STATUSES, linkedMembers, attendanceFor, rowsHtml, install };
});
