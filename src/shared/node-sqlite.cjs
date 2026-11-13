'use strict';

// node:sqlite prints "ExperimentalWarning: SQLite is an experimental feature"
// on first load. Sentinal only uses it for read-only ArkShop files, so drop
// that single warning and pass every other warning through unchanged.
const FILTERED = Symbol.for('khaos.nexus.sqliteWarningFiltered');

function isSqliteExperimentalWarning(warning, typeOrOptions) {
  const type = typeof typeOrOptions === 'string' ? typeOrOptions : typeOrOptions?.type;
  const name = type || warning?.name || '';
  return name === 'ExperimentalWarning' && /SQLite/i.test(String(warning?.message ?? warning));
}

function installSqliteWarningFilter() {
  if (process[FILTERED]) return;
  process[FILTERED] = true;
  const original = process.emitWarning;
  process.emitWarning = function nexusEmitWarning(warning, ...rest) {
    if (isSqliteExperimentalWarning(warning, rest[0])) return undefined;
    return original.call(this, warning, ...rest);
  };
}

function loadNodeSqlite() {
  installSqliteWarningFilter();
  return require('node:sqlite');
}

module.exports = { isSqliteExperimentalWarning, installSqliteWarningFilter, loadNodeSqlite };
