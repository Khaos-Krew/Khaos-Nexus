'use strict';

const path = require('node:path');
const { app } = require('electron');

let installed = false;

function install() {
  if (installed) return;
  installed = true;

  const target = require('./services/bot-supervisor.cjs');
  const Original = target.BotSupervisor;
  if (!Original || Original.__nexusDndStandaloneWorkerBoundary) return;

  class DndStandaloneBotSupervisor extends Original {
    botPath() {
      return app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar', 'bot', 'entry.cjs')
        : path.join(__dirname, '..', 'bot', 'entry.cjs');
    }
  }

  Object.defineProperty(DndStandaloneBotSupervisor, '__nexusDndStandaloneWorkerBoundary', { value: true });
  target.BotSupervisor = DndStandaloneBotSupervisor;
}

module.exports = { install };
