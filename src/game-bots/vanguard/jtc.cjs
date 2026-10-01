'use strict';

const { installJoinToCreate, resolveJtcConfig } = require('../join-to-create.cjs');

function vanguardJtcConfig(env = process.env) {
  return resolveJtcConfig('vanguard', env);
}

function installVanguardJtc(client, env = process.env) {
  return installJoinToCreate(client, { bot: 'vanguard', env });
}

function applyJtcLobby(controller, env = process.env) {
  if (!controller) return vanguardJtcConfig(env);
  controller.config = vanguardJtcConfig(env);
  return controller.config;
}

module.exports = { vanguardJtcConfig, installVanguardJtc, applyJtcLobby };
