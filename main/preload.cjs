'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function errorText(value) {
  if (value instanceof Error) return `${value.code || ''} ${value.message || ''} ${value.stack || ''}`;
  if (value && typeof value === 'object') return `${value.code || ''} ${value.message || ''} ${value.stack || ''}`;
  return String(value || '');
}

function isExpectedAccessDenial(value) {
  const text = errorText(value).toLowerCase();
  if (!text) return false;
  if (/\baccess_denied\b|\bmodule_disabled\b/.test(text)) return true;
  const requiresRole = /requires\s+(viewer|operator|owner)\s+access/.test(text);
  const authorizationReason = /sign in with an authorized discord account|discord account is not approved|configured owner account|desktop access control|access control is enabled/.test(text);
  const expectedModuleState = /requires an enabled nexus module|disabled by the owner|temporarily disabled by the khaos nexus owner|inventoried but has no runnable desktop implementation|is blocked because .+ disabled/.test(text);
  return (requiresRole && authorizationReason) || expectedModuleState;
}

function reportPreloadFailure(error, stage, detail = {}) {
  try {
    ipcRenderer.send('startup-health:preload-failed', {
      stage: String(stage || 'unknown').slice(0, 100),
      message: String(error?.message || error || 'Unknown preload failure').slice(0, 1600),
      stack: String(error?.stack || '').slice(0, 12000),
      detail: detail && typeof detail === 'object' ? detail : {},
      time: new Date().toISOString()
    });
  } catch {}
}

try {
  const REPORT_EXCLUDED_CHANNELS = new Set([
    'stability:heartbeat',
    'monitor:capture-renderer',
    'renderer-errors:get',
    'renderer-errors:clear',
    'renderer-errors:copy-latest',
    'startup-health:get',
    'startup-health:renderer-ready'
  ]);
  const invokeSuccessListeners = new Set();
  let lastInteraction = null;
  let rendererReadyReported = false;

  function sendRendererHeartbeat() {
    ipcRenderer.invoke('stability:heartbeat').catch(() => {});
  }

  sendRendererHeartbeat();
  const rendererHeartbeatTimer = setInterval(sendRendererHeartbeat, 2000);
  process.once('exit', () => clearInterval(rendererHeartbeatTimer));

  function subscribe(channel, callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }

  function cleanText(value, max = 160) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function elementContext(element) {
    const target = element?.closest?.('button, [role="button"], a, input, select, textarea') || element;
    if (!target || typeof target !== 'object') return {};
    return {
      elementId: cleanText(target.id, 120),
      elementText: cleanText(target.getAttribute?.('aria-label') || target.title || target.textContent || target.value, 160),
      elementTag: cleanText(target.tagName, 40).toLowerCase(),
      operation: cleanText(
        target.dataset?.hostedSignal || target.dataset?.view || target.dataset?.viewLink || target.dataset?.commandView ||
        target.getAttribute?.('name') || target.id || target.textContent,
        140
      )
    };
  }

  function currentView() {
    try { return cleanText(document.querySelector?.('.view.active')?.id || 'unknown-view', 100).replace(/^view-/, ''); }
    catch { return 'unknown-view'; }
  }

  function reportRendererActionError(input = {}) {
    if (isExpectedAccessDenial(input.error || input.message || input.reason || input)) return { ignored: true, reason: 'expected-access-denial' };
    const error = input.error instanceof Error ? input.error : null;
    let interaction = input.interaction || lastInteraction || {};
    try { if (!Object.keys(interaction).length) interaction = elementContext(document.activeElement); } catch {}
    ipcRenderer.send('renderer-action:error', {
      source: input.source || 'manual',
      channel: cleanText(input.channel || '', 140),
      view: cleanText(input.view || currentView(), 100),
      operation: cleanText(input.operation || interaction?.operation || '', 140),
      elementId: cleanText(input.elementId || interaction?.elementId || '', 120),
      elementText: cleanText(input.elementText || interaction?.elementText || '', 160),
      elementTag: cleanText(input.elementTag || interaction?.elementTag || '', 40),
      message: cleanText(input.message || error?.message || String(input.reason || 'Unknown renderer error'), 1600),
      stack: String(input.stack || error?.stack || '').slice(0, 12000),
      time: new Date().toISOString()
    });
    return { reported: true };
  }

  function subscribeInvokeSuccess(callback) {
    if (typeof callback !== 'function') return () => {};
    invokeSuccessListeners.add(callback);
    return () => invokeSuccessListeners.delete(callback);
  }

  function notifyInvokeSuccess(channel) {
    const event = Object.freeze({
      channel: cleanText(channel, 140),
      time: new Date().toISOString()
    });
    for (const listener of [...invokeSuccessListeners]) {
      try { listener(event); } catch {}
    }
  }

  async function invoke(channel, payload) {
    try {
      const result = await ipcRenderer.invoke(channel, payload);
      notifyInvokeSuccess(channel);
      return result;
    } catch (error) {
      if (!REPORT_EXCLUDED_CHANNELS.has(channel) && !isExpectedAccessDenial(error)) {
        reportRendererActionError({ source: 'ipc', channel, error, interaction: lastInteraction });
      }
      throw error;
    }
  }

  function interfaceSnapshot() {
    const href = String(window.location?.href || '');
    const shell = document.querySelector('.app-shell');
    const sidebar = document.querySelector('.sidebar');
    const content = document.querySelector('.content');
    const activeView = document.querySelector('.view.active');
    return {
      href,
      readyState: document.readyState,
      expectedDocument: href.startsWith('file:') && /\/renderer\/index\.html(?:[?#]|$)/i.test(href.replace(/\\/g, '/')),
      hasShell: Boolean(shell),
      hasSidebar: Boolean(sidebar),
      hasContent: Boolean(content),
      hasActiveView: Boolean(activeView),
      activeViewId: cleanText(activeView?.id || '', 100),
      bodyChildCount: Number(document.body?.children?.length || 0),
      bodyTextLength: cleanText(document.body?.innerText || '', 20000).length
    };
  }

  function reportRendererReadyWhenInterfaceExists() {
    if (rendererReadyReported) return;
    const snapshot = interfaceSnapshot();
    if (snapshot.href === 'about:blank' || !snapshot.href) return;

    const valid = snapshot.expectedDocument && snapshot.hasShell && snapshot.hasSidebar && snapshot.hasContent && snapshot.hasActiveView;
    if (!valid) {
      const error = new Error(`The Khaos Nexus interface document did not contain the required application shell. URL: ${snapshot.href || 'unknown'}`);
      reportRendererActionError({
        source: 'startup-interface',
        channel: 'startup-health:renderer-ready',
        operation: 'verify-main-interface',
        view: snapshot.activeViewId || 'unavailable',
        error
      });
      reportPreloadFailure(error, 'interface-verification', snapshot);
      return;
    }

    rendererReadyReported = true;
    ipcRenderer.invoke('startup-health:renderer-ready', snapshot).catch((error) => {
      rendererReadyReported = false;
      reportRendererActionError({ source: 'startup-health', channel: 'startup-health:renderer-ready', error });
      reportPreloadFailure(error, 'renderer-ready-acknowledgement', snapshot);
    });
  }

  try {
    window.addEventListener('click', (event) => {
      lastInteraction = elementContext(event.target);
    }, true);
  } catch {}

  contextBridge.exposeInMainWorld('khaos', {
    invoke,
    onInvokeSuccess: (callback) => subscribeInvokeSuccess(callback),
    reportRendererActionError: (payload) => reportRendererActionError(payload || {}),
    isExpectedAccessDenial: (value) => isExpectedAccessDenial(value),
    reportBootStage: (stage, detail = {}) => ipcRenderer.send('renderer-boot:stage', {
      stage: String(stage || 'unknown').slice(0, 80),
      detail: detail && typeof detail === 'object' ? detail : {},
      time: new Date().toISOString()
    }),
    onState: (callback) => subscribe('state:update', callback),
    onStartupHealth: (callback) => subscribe('startup-health:update', callback),
    onLog: (callback) => subscribe('log:entry', callback),
    onUpdate: (callback) => subscribe('update:state', callback),
    onDiscordAutomation: (callback) => subscribe('discord-automation:update', callback),
    onDiscordObservability: (callback) => subscribe('discord-observability:state', callback),
    onStatusPanels: (callback) => subscribe('status-panels:update', callback),
    onServerScheduler: (callback) => subscribe('server-scheduler:update', callback),
    onPlayerConsole: (callback) => subscribe('player-console:update', callback),
    onHostedServer: (callback) => subscribe('hosted-server:update', callback),
    onRendererErrors: (callback) => subscribe('renderer-errors:update', callback)
  });

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', reportRendererReadyWhenInterfaceExists, { once: true });
  } else {
    queueMicrotask(reportRendererReadyWhenInterfaceExists);
  }
} catch (error) {
  reportPreloadFailure(error, 'preload-initialization');
}
