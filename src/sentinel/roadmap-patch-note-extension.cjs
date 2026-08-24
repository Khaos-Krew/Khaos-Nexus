'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const { RoadmapPatchNotePublisher } = require('./roadmap-patch-notes.cjs');

const INSTALLED = Symbol.for('khaos.nexus.roadmapPatchNotes.extension');

function installRoadmapPatchNoteExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const state = new StateStore();
  const publisher = new RoadmapPatchNotePublisher({ state, config });
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusRoadmapPatchNoteLogin(...args) {
    this.once(Events.ClientReady, async () => {
      if (!guildId) return;
      try {
        const guild = await this.guilds.fetch(guildId);
        const result = await publisher.publishPending(guild);
        if (result.posted.length || result.adopted.length) {
          console.log(`[Nexus Sentinal] roadmap patch notes reconciled: posted=${result.posted.length} adopted=${result.adopted.length} skipped=${result.skipped.length} warnings=${result.warnings.length}`);
        }
      } catch (error) {
        console.error('[Nexus Sentinal] roadmap patch-note startup:', error);
      }
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { installRoadmapPatchNoteExtension };
