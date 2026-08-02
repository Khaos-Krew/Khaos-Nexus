'use strict';

(function bootstrapDndRefreshGuard(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function dndRefreshGuardFactory() {
  const EDITABLE_SELECTOR = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
  const READ_ONLY_CHANNELS = new Set([
    'dnd:get',
    'dnd:guild-resources',
    'dnd:test-resource'
  ]);

  function isMutationChannel(channel) {
    const value = String(channel || '');
    return value.startsWith('dnd:') && !READ_ONLY_CHANNELS.has(value);
  }

  function isEditableControl(target, workspace) {
    if (!target?.matches?.(EDITABLE_SELECTOR) || !workspace?.contains?.(target)) return false;
    if (target.id === 'dndCampaignSelect') return false;
    if (target.matches('[data-dnd-source]')) return false;
    if (target.readOnly) return false;
    return true;
  }

  function shouldBlockWorkspaceRender(state, html) {
    if (!state?.dirty || state.allowRender) return false;
    return String(html ?? '') !== String(state.lastHtml ?? '');
  }

  function findInnerHtmlDescriptor(win) {
    let prototype = win?.Element?.prototype || null;
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'innerHTML');
      if (descriptor?.get && descriptor?.set) return descriptor;
      prototype = Object.getPrototypeOf(prototype);
    }
    return null;
  }

  function install(win) {
    if (!win?.document || win.__khaosDndRefreshGuard) return win?.__khaosDndRefreshGuard || null;

    const state = {
      dirty: false,
      pendingHtml: null,
      lastHtml: '',
      selectedCampaignId: '',
      allowRender: false,
      patchedRoot: null,
      descriptor: null,
      retry: null,
      originalInvoke: null
    };

    const workspace = () => win.document.getElementById('view-dnd');

    function notify(message) {
      if (typeof win.toast === 'function') win.toast(message);
    }

    function removeNotice() {
      win.document.getElementById('dndRefreshGuardNotice')?.remove();
    }

    function rawSet(root, html) {
      if (!root || !state.descriptor?.set) return false;
      state.allowRender = true;
      try {
        const value = String(html ?? '');
        state.descriptor.set.call(root, value);
        state.lastHtml = value;
      } finally {
        state.allowRender = false;
      }
      return true;
    }

    function discardPending() {
      const root = workspace();
      const pending = state.pendingHtml;
      state.dirty = false;
      state.pendingHtml = null;
      root?.removeAttribute('data-dnd-draft-state');
      removeNotice();
      if (pending !== null) rawSet(root, pending);
      notify('Unsaved D&D edits were discarded and the latest campaign data was restored.');
    }

    function clearAfterSuccessfulMutation() {
      const root = workspace();
      state.dirty = false;
      state.pendingHtml = null;
      root?.removeAttribute('data-dnd-draft-state');
      removeNotice();
    }

    function showNotice() {
      const root = workspace();
      if (!root || state.pendingHtml === null || win.document.getElementById('dndRefreshGuardNotice')) return;
      const notice = win.document.createElement('div');
      notice.id = 'dndRefreshGuardNotice';
      notice.className = 'callout dnd-refresh-guard-notice';
      notice.setAttribute('role', 'status');

      const copy = win.document.createElement('div');
      const title = win.document.createElement('strong');
      title.textContent = 'Unsaved D&D selections are protected';
      const detail = win.document.createElement('span');
      detail.textContent = 'New campaign data arrived in the background. Save your changes or discard them before switching campaigns or tabs.';
      copy.append(title, detail);

      const actions = win.document.createElement('div');
      actions.className = 'form-actions';
      const keep = win.document.createElement('button');
      keep.type = 'button';
      keep.className = 'button';
      keep.dataset.dndRefreshGuard = 'keep';
      keep.textContent = 'Keep editing';
      const discard = win.document.createElement('button');
      discard.type = 'button';
      discard.className = 'button danger';
      discard.dataset.dndRefreshGuard = 'discard';
      discard.textContent = 'Discard edits and refresh';
      actions.append(keep, discard);
      notice.append(copy, actions);
      root.prepend(notice);
    }

    function markDirty(target) {
      const root = workspace();
      if (!isEditableControl(target, root)) return;
      if (!state.dirty) state.selectedCampaignId = win.document.getElementById('dndCampaignSelect')?.value || '';
      state.dirty = true;
      root.setAttribute('data-dnd-draft-state', 'dirty');
    }

    function blockNavigation(event) {
      if (!state.dirty) return false;
      const target = event.target;
      const campaignSelect = target?.id === 'dndCampaignSelect' ? target : null;
      const navigation = target?.closest?.('[data-dnd-tab], [data-dnd-action="new-campaign"]');
      if (!campaignSelect && !navigation) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (campaignSelect) campaignSelect.value = state.selectedCampaignId;
      showNotice();
      notify('Save or discard the current D&D edits before changing campaigns or tabs.');
      return true;
    }

    function patchWorkspace(root) {
      if (!root || state.patchedRoot === root) return Boolean(root);
      const descriptor = findInnerHtmlDescriptor(win);
      if (!descriptor) return false;
      state.descriptor = descriptor;
      state.lastHtml = String(descriptor.get.call(root) || '');
      try {
        Object.defineProperty(root, 'innerHTML', {
          configurable: true,
          enumerable: descriptor.enumerable,
          get() {
            return descriptor.get.call(root);
          },
          set(value) {
            const html = String(value ?? '');
            if (html === state.lastHtml) return;
            if (shouldBlockWorkspaceRender(state, html)) {
              state.pendingHtml = html;
              showNotice();
              return;
            }
            descriptor.set.call(root, html);
            state.lastHtml = html;
            state.pendingHtml = null;
          }
        });
        state.patchedRoot = root;
        return true;
      } catch (error) {
        console.error('[Khaos Nexus] Could not install the bounded D&D refresh guard.', error);
        return false;
      }
    }

    function wrapInvoke() {
      if (!win.khaos?.invoke || state.originalInvoke) return;
      state.originalInvoke = win.khaos.invoke.bind(win.khaos);
      win.khaos.invoke = async function guardedDndInvoke(channel, payload) {
        const result = await state.originalInvoke(channel, payload);
        if (isMutationChannel(channel)) clearAfterSuccessfulMutation();
        return result;
      };
    }

    function attach() {
      const root = workspace();
      if (!root || !win.khaos?.invoke) {
        state.retry = win.setTimeout(attach, 25);
        return;
      }
      if (!patchWorkspace(root)) {
        state.retry = win.setTimeout(attach, 50);
        return;
      }
      wrapInvoke();

      win.document.addEventListener('input', (event) => markDirty(event.target), true);
      win.document.addEventListener('change', (event) => {
        if (blockNavigation(event)) return;
        markDirty(event.target);
      }, true);
      win.document.addEventListener('click', (event) => {
        const action = event.target?.closest?.('[data-dnd-refresh-guard]')?.dataset.dndRefreshGuard;
        if (action === 'keep') {
          event.preventDefault();
          event.stopImmediatePropagation();
          removeNotice();
          return;
        }
        if (action === 'discard') {
          event.preventDefault();
          event.stopImmediatePropagation();
          discardPending();
          return;
        }
        blockNavigation(event);
      }, true);

      win.__khaosDndRefreshGuard = {
        state,
        markDirty,
        discardPending,
        clearAfterSuccessfulMutation,
        disconnect() {
          if (state.retry) win.clearTimeout(state.retry);
          if (state.originalInvoke) win.khaos.invoke = state.originalInvoke;
          removeNotice();
        }
      };
    }

    attach();
    return win.__khaosDndRefreshGuard;
  }

  return {
    EDITABLE_SELECTOR,
    READ_ONLY_CHANNELS,
    isMutationChannel,
    isEditableControl,
    shouldBlockWorkspaceRender,
    findInnerHtmlDescriptor,
    install
  };
});
