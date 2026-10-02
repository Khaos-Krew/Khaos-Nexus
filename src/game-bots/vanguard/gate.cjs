'use strict';

const { evaluateChannelCategory, resolveCategoryConfig } = require('../category-gate.cjs');

function evaluateVanguardChannel(channel, env = process.env) {
  return evaluateChannelCategory(channel, 'vanguard', env);
}

function vanguardCategory(env = process.env) {
  return resolveCategoryConfig('vanguard', env);
}

module.exports = { evaluateVanguardChannel, vanguardCategory };
