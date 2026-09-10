'use strict';

const { ArkClusterRegistry } = require('../sentinel/ark-cluster-registry.cjs');

class ArkServerRegistry {
  constructor({ registry } = {}) {
    this.registry = registry || new ArkClusterRegistry();
  }

  list({ includeDisabled = false } = {}) {
    return this.registry.list({ includeDisabled }).map(cloneServer);
  }

  get(id) {
    const record = this.registry.get(id);
    return record ? cloneServer(record) : null;
  }
}

function cloneServer(server) {
  return JSON.parse(JSON.stringify(server));
}

module.exports = { ArkServerRegistry, cloneServer };
