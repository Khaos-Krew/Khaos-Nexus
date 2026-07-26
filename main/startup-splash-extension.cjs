'use strict';

const electron = require('electron');

const STARTUP_TIMEOUT_MS = 45000;
let installed = false;

function splashSource() {
  return `(() => {
    if (window.__khaosStartupSplashInstalled) return;
    window.__khaosStartupSplashInstalled = true;

    const TIMEOUT_MS = ${STARTUP_TIMEOUT_MS};
    const stages = new Map([
      ['coordinator-ready', ['Preparing startup coordinator…', 12]],
      ['document-loaded', ['Loading command center…', 24]],
      ['feature-loading', ['Loading desktop modules…', 35]],
      ['feature-ready', ['Initializing services…', 72]],
      ['feature-failed', ['A module reported a startup warning…', 82]],
      ['features-ready', ['Khaos Nexus is ready', 100]]
    ]);

    const style = document.createElement('style');
    style.id = 'khaosStartupSplashStyles';
    style.textContent = \`
      html.khaos-starting, body.khaos-starting { overflow: hidden !important; }
      body.khaos-starting > *:not(#khaosStartupSplash):not(script):not(style) { pointer-events: none !important; user-select: none !important; }
      #khaosStartupSplash {
        position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center;
        background:
          radial-gradient(circle at 50% 38%, rgba(196, 24, 58, .18), transparent 31%),
          linear-gradient(145deg, #050608 0%, #090b10 52%, #030405 100%);
        color: #f6f7f9; font-family: "Segoe UI", Arial, sans-serif;
        opacity: 1; transition: opacity .42s ease, visibility .42s ease;
      }
      #khaosStartupSplash.is-closing { opacity: 0; visibility: hidden; }
      .khaos-splash-shell { width: min(520px, calc(100vw - 48px)); text-align: center; }
      .khaos-splash-logo-wrap { position: relative; width: 178px; height: 178px; margin: 0 auto 22px; display: grid; place-items: center; }
      .khaos-splash-logo-wrap::before, .khaos-splash-logo-wrap::after {
        content: ""; position: absolute; inset: 8px; border-radius: 50%; border: 1px solid rgba(230, 41, 78, .28);
        box-shadow: 0 0 38px rgba(213, 28, 62, .24), inset 0 0 34px rgba(213, 28, 62, .12);
        animation: khaosPulse 2.2s ease-in-out infinite;
      }
      .khaos-splash-logo-wrap::after { inset: -4px; opacity: .42; animation-delay: -.8s; }
      .khaos-splash-logo { width: 142px; height: 142px; object-fit: contain; filter: drop-shadow(0 0 24px rgba(226, 35, 72, .42)); }
      .khaos-splash-title { margin: 0; font-size: 30px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
      .khaos-splash-subtitle { margin: 8px 0 28px; color: #a9afb9; font-size: 12px; letter-spacing: .24em; text-transform: uppercase; }
      .khaos-splash-status { min-height: 22px; margin-bottom: 14px; color: #e4e7ec; font-size: 14px; }
      .khaos-splash-track { height: 8px; overflow: hidden; border: 1px solid rgba(239, 55, 90, .26); border-radius: 999px; background: rgba(255,255,255,.055); box-shadow: inset 0 1px 5px rgba(0,0,0,.65); }
      .khaos-splash-progress { width: 6%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #721226, #e3264f 65%, #ff6a83); box-shadow: 0 0 18px rgba(227,38,79,.7); transition: width .32s ease; }
      .khaos-splash-meta { display: flex; justify-content: space-between; gap: 18px; margin-top: 10px; color: #777f8b; font-size: 11px; }
      .khaos-splash-error { display: none; margin-top: 20px; padding: 14px; border: 1px solid rgba(239,55,90,.35); border-radius: 12px; background: rgba(93,10,28,.2); text-align: left; }
      .khaos-splash-error.is-visible { display: block; }
      .khaos-splash-error strong { display: block; margin-bottom: 5px; color: #ff9bad; }
      .khaos-splash-actions { display: flex; gap: 10px; margin-top: 12px; }
      .khaos-splash-button { border: 1px solid rgba(239,55,90,.48); border-radius: 8px; padding: 9px 13px; background: rgba(227,38,79,.13); color: #fff; cursor: pointer; }
      .khaos-splash-button:hover { background: rgba(227,38,79,.25); }
      @keyframes khaosPulse { 0%,100% { transform: scale(.97); opacity: .48; } 50% { transform: scale(1.035); opacity: 1; } }
      @media (prefers-reduced-motion: reduce) { .khaos-splash-logo-wrap::before, .khaos-splash-logo-wrap::after { animation: none; } }
    \`;
    (document.head || document.documentElement).appendChild(style);

    document.documentElement.classList.add('khaos-starting');
    document.body?.classList.add('khaos-starting');

    const splash = document.createElement('div');
    splash.id = 'khaosStartupSplash';
    splash.setAttribute('role', 'status');
    splash.setAttribute('aria-live', 'polite');
    splash.innerHTML = \`
      <main class="khaos-splash-shell">
        <div class="khaos-splash-logo-wrap"><img class="khaos-splash-logo" src="../assets/icon.png" alt="Khaos Nexus logo"></div>
        <h1 class="khaos-splash-title">Khaos Nexus</h1>
        <p class="khaos-splash-subtitle">Desktop Control Center</p>
        <div id="khaosSplashStatus" class="khaos-splash-status">Preparing application…</div>
        <div class="khaos-splash-track"><div id="khaosSplashProgress" class="khaos-splash-progress"></div></div>
        <div class="khaos-splash-meta"><span id="khaosSplashStep">Startup lock active</span><span id="khaosSplashPercent">6%</span></div>
        <section id="khaosSplashError" class="khaos-splash-error">
          <strong>Startup is taking longer than expected.</strong>
          <span>The interface remains locked to prevent incomplete actions. You can retry the interface or open in limited mode.</span>
          <div class="khaos-splash-actions">
            <button id="khaosSplashRetry" class="khaos-splash-button" type="button">Retry Interface</button>
            <button id="khaosSplashContinue" class="khaos-splash-button" type="button">Open Limited Mode</button>
          </div>
        </section>
      </main>\`;
    (document.body || document.documentElement).appendChild(splash);

    const status = splash.querySelector('#khaosSplashStatus');
    const progress = splash.querySelector('#khaosSplashProgress');
    const percent = splash.querySelector('#khaosSplashPercent');
    const step = splash.querySelector('#khaosSplashStep');
    const errorPanel = splash.querySelector('#khaosSplashError');
    let completed = false;
    let currentProgress = 6;

    const update = (message, value, detail = '') => {
      currentProgress = Math.max(currentProgress, Math.min(100, Number(value) || currentProgress));
      status.textContent = message;
      progress.style.width = currentProgress + '%';
      percent.textContent = Math.round(currentProgress) + '%';
      if (detail) step.textContent = detail;
    };

    const unlock = (limited = false) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      update(limited ? 'Opened in limited mode' : 'Khaos Nexus is ready', 100, limited ? 'Some modules may still be loading' : 'All startup modules loaded');
      setTimeout(() => {
        splash.classList.add('is-closing');
        document.documentElement.classList.remove('khaos-starting');
        document.body?.classList.remove('khaos-starting');
        setTimeout(() => { splash.remove(); style.remove(); }, 460);
      }, limited ? 150 : 420);
    };

    const receiveStage = (stage, detail = {}) => {
      if (completed) return;
      if (stage === 'features-ready') return unlock(false);
      const mapped = stages.get(stage);
      if (!mapped) return;
      let [message, value] = mapped;
      if (stage === 'feature-loading') {
        const position = Number(detail.position) || 0;
        const remaining = Number(detail.remaining) || 0;
        const total = Math.max(1, position + remaining);
        value = 28 + (position / total) * 58;
        message = detail.source ? 'Loading ' + detail.source + '…' : message;
      }
      if (stage === 'feature-ready' && detail.source) message = detail.source + ' ready';
      update(message, value, stage.replaceAll('-', ' '));
    };

    window.addEventListener('khaos:features-ready', (event) => receiveStage('features-ready', event.detail || {}), { once: true });
    window.addEventListener('khaos:boot-stage', (event) => receiveStage(event.detail?.stage, event.detail?.detail || {}));

    const originalReport = window.khaos?.reportBootStage;
    if (window.khaos && typeof originalReport === 'function' && !originalReport.__khaosSplashWrapped) {
      const wrapped = function(stage, detail) {
        receiveStage(stage, detail || {});
        return originalReport.call(this, stage, detail);
      };
      wrapped.__khaosSplashWrapped = true;
      try { window.khaos.reportBootStage = wrapped; } catch {}
    }

    splash.querySelector('#khaosSplashRetry').addEventListener('click', () => location.reload());
    splash.querySelector('#khaosSplashContinue').addEventListener('click', () => unlock(true));

    const timeout = setTimeout(() => {
      if (completed) return;
      update('Startup needs attention', Math.max(currentProgress, 88), 'Waiting for remaining modules');
      errorPanel.classList.add('is-visible');
    }, TIMEOUT_MS);

    update('Loading command center…', 10, 'Startup lock active');
  })();`;
}

function attach(window) {
  if (!window || window.isDestroyed() || window.__khaosStartupSplashAttached) return;
  window.__khaosStartupSplashAttached = true;
  window.webContents.on('dom-ready', () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    window.webContents.executeJavaScript(splashSource()).catch((error) => {
      console.error('[Khaos Nexus] Could not install the startup splash.', error);
    });
  });
}

function install() {
  if (installed) return;
  installed = true;
  electron.app.on('browser-window-created', (_event, window) => attach(window));
  electron.app.whenReady().then(() => {
    for (const window of electron.BrowserWindow.getAllWindows()) attach(window);
  }).catch((error) => console.error('[Khaos Nexus] Startup splash initialization failed.', error));
}

module.exports = { STARTUP_TIMEOUT_MS, splashSource, install, attach };
