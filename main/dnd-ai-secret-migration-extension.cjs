'use strict';

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndAiSecretMigration) return;

  class DndAiSecretMigrationStore extends Original {
    constructor(...args) {
      super(...args);
      if (Object.prototype.hasOwnProperty.call(this.secrets || {}, 'dndCoDmOpenAiKey')) {
        delete this.secrets.dndCoDmOpenAiKey;
        this.saveSecrets();
      }
    }
  }

  Object.defineProperty(DndAiSecretMigrationStore, '__khaosDndAiSecretMigration', { value: true });
  target.ConfigStore = DndAiSecretMigrationStore;
}

module.exports = { install };
