'use strict';

let installed = false;

function forceLocalModuleAuthority() {
  const foundation = require('./module-foundation-extension.cjs');
  const refs = foundation?.refs;
  if (!refs || refs.__khaosLocalModuleAuthority) return;

  // Module management is a recovery surface owned by the person running this
  // desktop installation. It must never depend on Discord authentication or a
  // Discord role, otherwise a broken/offline Discord session can lock the
  // local owner out of their own application.
  for (const key of ['autonomy', 'discordAuth']) {
    Object.defineProperty(refs, key, {
      configurable: false,
      enumerable: true,
      get: () => null,
      set: () => {}
    });
  }

  Object.defineProperty(refs, '__khaosLocalModuleAuthority', { value: true });
}

function install() {
  if (installed) return;
  installed = true;
  forceLocalModuleAuthority();
}

module.exports = { install, forceLocalModuleAuthority };
