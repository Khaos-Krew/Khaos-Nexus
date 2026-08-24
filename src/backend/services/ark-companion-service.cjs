'use strict';

const {
  ArkTamingDataSource,
  TRANQ_METHODS,
  calculateTame,
  formatDuration,
  mergeTamingData,
  normalizeName,
  positiveInteger,
  positiveNumber
} = require('./ark-taming-engine.cjs');

class ArkCompanionService {
  constructor(options = {}) {
    this.dataSource = options.dataSource || new ArkTamingDataSource(options);
    this.supportedActions = Object.freeze(['taming']);
  }

  async listSpecies() {
    return this.dataSource.species();
  }

  async invoke(moduleId, actionId, payload = {}) {
    if (moduleId !== 'ark' || actionId !== 'taming') throw new Error('Unsupported ARK companion action.');
    return this.dataSource.calculate(payload);
  }
}

module.exports = {
  ArkCompanionService,
  ArkTamingDataSource,
  TRANQ_METHODS,
  calculateTame,
  formatDuration,
  mergeTamingData,
  normalizeName,
  positiveInteger,
  positiveNumber
};
