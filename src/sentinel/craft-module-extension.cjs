'use strict';

const { Client } = require('discord.js');
const { errorClass } = require('../game-bots/command-failure.cjs');
const { attachCraftModule } = require('./craft-module.cjs');

const INSTALLED = Symbol.for('khaos.nexus.sentinal.craft.extension');

function installCraftModuleExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusCraftModuleLogin(...args) {
    try {
      attachCraftModule(this, { env: process.env });
    } catch (error) {
      console.warn(`[Nexus Sentinal] craft module attach class=${errorClass(error)}`);
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = { installCraftModuleExtension };
