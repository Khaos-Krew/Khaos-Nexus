'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { StateStore } = require('./state-store.cjs');
const { ROADMAP_PATCH_NOTES, RoadmapPatchNotePublisher } = require('./roadmap-patch-notes.cjs');

const INSTALLED = Symbol.for('khaos.nexus.roadmapPatchNotes.extension');
const ABOUT_PATCH_NOTE = Object.freeze({
  key: 'community-about-sharing:100',
  section: 'Community About & Sharing',
  percent: 100,
  title: 'Community About & Sharing Complete',
  summary: 'The Khaos Nexus About and community-sharing section has reached its 100% roadmap milestone.',
  highlights: Object.freeze([
    'Added a dedicated read-only #about channel under INFORMATION with a clear overview of the Khaos Nexus community and its major features.',
    'Added Gaming, Nexus Sentinal, Community Progression, suggestions, Content Creators, Nexus D&D, and safe-space community guidance to the managed About panel.',
    'Added a permanent unlimited-use Discord invite and a Share Khaos Nexus link button so members can easily invite others.',
    'Sentinal now reconciles the About channel, permissions, share invite, and pinned panel automatically without creating duplicate managed posts.'
  ])
});
const COMMUNITY_SUGGESTIONS_PATCH_NOTE = Object.freeze({
  key: 'community-suggestions:66',
  section: 'Community Suggestions',
  percent: 66,
  title: 'Community Suggestions Core Ready',
  summary: 'The community suggestion intake, voting, and durable development-queue core has reached its 66% roadmap milestone and is live for acceptance.',
  highlights: Object.freeze([
    'Added a managed #suggestions intake with durable SUG identifiers so member ideas remain tracked instead of disappearing into chat or roadmap notes.',
    'Added persistent community voting with self-vote prevention, one changeable vote per member, and configurable voting-window, turnout, and approval gates.',
    'Passed suggestions move into a durable development-review queue and remain retryable if the GitHub handoff is temporarily unavailable.',
    'Community passage does not automatically authorize implementation; the protected Owner review and development-plan decision loop remains the final acceptance stage.'
  ])
});
const SENTINEL_SHIELD_PATCH_NOTE = Object.freeze({
  key: 'sentinel-shield:100',
  section: 'Sentinel Shield',
  percent: 100,
  title: 'Sentinel Shield Complete',
  summary: 'Sentinel Shield has reached its 100% roadmap milestone and is now protecting the Khaos Nexus community with layered security and staff review controls.',
  highlights: Object.freeze([
    'Added automated scam, phishing, suspicious-link, spam, and raid-awareness protections with conservative safeguards against false positives.',
    'Added private security cases, staff alerts, evidence-preserving review controls, and clear escalation paths for suspicious activity.',
    'Added reversible quarantine isolation that protects community and game spaces without stripping a member’s normal Nexus roles or unrelated permissions.',
    'Added a controlled verification-help path and automatic reconciliation so security restrictions can be safely reviewed and restored by staff.'
  ])
});

function installRoadmapPatchNoteExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;

  const config = loadConfig();
  const guildId = String(config.discord?.guildId || '');
  const state = new StateStore();
  const publisher = new RoadmapPatchNotePublisher({ state, config, notes: [...ROADMAP_PATCH_NOTES, ABOUT_PATCH_NOTE, COMMUNITY_SUGGESTIONS_PATCH_NOTE, SENTINEL_SHIELD_PATCH_NOTE] });
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

module.exports = { ABOUT_PATCH_NOTE, COMMUNITY_SUGGESTIONS_PATCH_NOTE, SENTINEL_SHIELD_PATCH_NOTE, installRoadmapPatchNoteExtension };
