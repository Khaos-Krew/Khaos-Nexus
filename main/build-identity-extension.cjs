'use strict';

const electron = require('electron');
const pkg = require('../package.json');

let installed = false;

function buildIdentity() {
  return Object.freeze({
    displayVersion: String(pkg.khaosRelease?.displayVersion || pkg.version || 'unknown'),
    internalVersion: String(pkg.version || 'unknown'),
    channel: String(pkg.khaosRelease?.channel || 'unknown'),
    versionScheme: String(pkg.khaosRelease?.versionScheme || 'release.beta.test.hotfix')
  });
}

function install() {
  if (installed) return;
  installed = true;

  const prototype = electron.BrowserWindow?.prototype;
  if (!prototype || prototype.__khaosBuildIdentityPatched) return;
  const previousLoadFile = prototype.loadFile;
  const identity = buildIdentity();
  const serialized = JSON.stringify(identity);

  prototype.loadFile = function patchedBuildIdentityLoadFile(...args) {
    const window = this;
    const webContentsId = window.webContents.id;
    window.webContents.once('did-finish-load', () => {
      if (window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.id !== webContentsId) return;
      window.webContents.executeJavaScript(`(() => {
        const identity = Object.freeze(${serialized});
        window.__khaosBuildIdentity = identity;
        document.documentElement.dataset.khaosDisplayVersion = identity.displayVersion;
        document.documentElement.dataset.khaosBuildChannel = identity.channel;
        const label = document.getElementById('versionLabel');
        if (label) {
          const enforce = () => {
            const expected = 'Version ' + identity.displayVersion;
            if (label.textContent !== expected) label.textContent = expected;
            label.title = 'Internal updater version ' + identity.internalVersion + ' • ' + identity.channel;
          };
          enforce();
          const observer = new MutationObserver(enforce);
          observer.observe(label, { childList: true, characterData: true, subtree: true });
          window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
        }
        window.dispatchEvent(new CustomEvent('khaos:build-identity', { detail: identity }));
      })();`).catch((error) => console.error('[Khaos Nexus] Build identity renderer injection failed.', error));
    });
    return previousLoadFile.apply(window, args);
  };

  Object.defineProperty(prototype, '__khaosBuildIdentityPatched', { value: true });
}

module.exports = { install, buildIdentity };
