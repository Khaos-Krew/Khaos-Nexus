'use strict';

(function bootstrapUiPerformance(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root?.document) api.install(root);
})(typeof window !== 'undefined' ? window : null, function uiPerformanceFactory() {
  const VIEW_RENDERERS = Object.freeze({
    renderActivity: 'dashboard',
    renderServers: 'servers',
    renderModules: 'modules',
    renderMonitor: 'monitor',
    renderLogs: 'logs'
  });

  function isViewActive(doc, viewName) {
    return Boolean(doc?.getElementById?.(`view-${viewName}`)?.classList?.contains?.('active'));
  }

  function createFrameScheduler(win, callback) {
    let frame = null;
    let requested = false;
    const run = () => {
      frame = null;
      if (!requested) return;
      requested = false;
      callback();
    };
    return {
      request() {
        requested = true;
        if (frame !== null) return;
        frame = win.requestAnimationFrame(run);
      },
      flush() {
        if (frame !== null) win.cancelAnimationFrame(frame);
        frame = null;
        if (!requested) return;
        requested = false;
        callback();
      },
      cancel() {
        if (frame !== null) win.cancelAnimationFrame(frame);
        frame = null;
        requested = false;
      }
    };
  }

  function install(win) {
    if (!win?.document || win.__khaosUiPerformance) return win?.__khaosUiPerformance || null;

    const originals = new Map();
    const schedulers = new Map();
    const pending = new Set();
    const lastLongTaskByName = new Map();

    for (const [functionName, viewName] of Object.entries(VIEW_RENDERERS)) {
      const original = win[functionName];
      if (typeof original !== 'function') continue;
      originals.set(functionName, original);
      const scheduler = createFrameScheduler(win, () => original.call(win));
      schedulers.set(functionName, scheduler);
      win[functionName] = function scheduledViewRender(...args) {
        if (!isViewActive(win.document, viewName)) {
          pending.add(functionName);
          return undefined;
        }
        if (args.length) {
          scheduler.cancel();
          return original.apply(this, args);
        }
        scheduler.request();
        return undefined;
      };
    }

    const originalShowView = typeof win.showView === 'function' ? win.showView : null;
    if (originalShowView) {
      originals.set('showView', originalShowView);
      win.showView = function optimizedShowView(name, ...args) {
        const result = originalShowView.call(this, name, ...args);
        win.queueMicrotask(() => {
          for (const [functionName, viewName] of Object.entries(VIEW_RENDERERS)) {
            if (viewName !== name || !pending.has(functionName)) continue;
            pending.delete(functionName);
            schedulers.get(functionName)?.request();
          }
        });
        return result;
      };
    }

    let observer = null;
    if (typeof win.PerformanceObserver === 'function') {
      try {
        observer = new win.PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration < 120) continue;
            const name = String(entry.name || 'renderer-task');
            const now = Date.now();
            if (now - (lastLongTaskByName.get(name) || 0) < 30000) continue;
            lastLongTaskByName.set(name, now);
            console.warn('[Khaos Nexus] Slow renderer task detected.', {
              name,
              durationMs: Math.round(entry.duration),
              activeView: win.document.querySelector('.view.active')?.id || 'unknown'
            });
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      } catch {
        observer = null;
      }
    }

    const api = {
      pending,
      flush(viewName) {
        for (const [functionName, targetView] of Object.entries(VIEW_RENDERERS)) {
          if (targetView !== viewName) continue;
          pending.delete(functionName);
          schedulers.get(functionName)?.flush();
        }
      },
      disconnect() {
        observer?.disconnect?.();
        for (const scheduler of schedulers.values()) scheduler.cancel();
        for (const [name, original] of originals) win[name] = original;
        delete win.__khaosUiPerformance;
      }
    };

    win.__khaosUiPerformance = api;
    win.document.documentElement.classList.add('nexus-ui-performance-active');
    return api;
  }

  return { VIEW_RENDERERS, isViewActive, createFrameScheduler, install };
});
