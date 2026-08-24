'use strict';

const ALLOWED_MILESTONES = new Set([66, 100]);
const PUBLIC_DENYLIST = [/\bthora\b/i];

const ROADMAP_PATCH_NOTES = Object.freeze([
  Object.freeze({
    key: 'community-safety-reporting:100',
    section: 'Community Safety & Reporting',
    percent: 100,
    title: 'Community Safety & Reporting Complete',
    summary: 'The community safety and private reporting section has reached its 100% roadmap milestone.',
    highlights: Object.freeze([
      'Updated Community Rules with safe-space and anti-harassment expectations.',
      'Added the Open Private Report button and /report command.',
      'Added private case channels with staff claim, participant, escalation, resolve, and close controls.',
      'Added a restricted report archive and privacy safeguards that keep report details out of routine Nexus logs/state.'
    ])
  })
]);

function normalizeChannelName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function publicText(note) {
  return [note.section, note.title, note.summary, ...(note.highlights || [])].join('\n');
}

function assertPublicSafePatchNote(note) {
  if (!note || typeof note !== 'object') throw new Error('Patch note is required.');
  if (!ALLOWED_MILESTONES.has(Number(note.percent))) throw new Error('Roadmap patch notes may only publish at 66% or 100%.');
  if (!String(note.key || '').trim()) throw new Error('Patch note key is required.');
  const text = publicText(note);
  for (const pattern of PUBLIC_DENYLIST) {
    if (pattern.test(text)) throw new Error(`Public patch note ${note.key} contains restricted private-edition content.`);
  }
  return true;
}

function patchNotePayload(note) {
  assertPublicSafePatchNote(note);
  const highlights = (note.highlights || []).map((item) => `• ${item}`).join('\n').slice(0, 1024);
  return {
    embeds: [{
      title: `Khaos Nexus • ${note.percent}% Milestone`,
      description: `**${note.title}**\n${note.summary}`.slice(0, 4096),
      fields: highlights ? [{ name: 'What changed', value: highlights, inline: false }] : [],
      footer: { text: `Nexus Sentinal • Roadmap milestone • ${note.key}` }
    }],
    allowedMentions: { parse: [] }
  };
}

function patchNoteMarker(note) {
  return `Roadmap milestone • ${note.key}`;
}

function messageHasMarker(message, note) {
  const marker = patchNoteMarker(note);
  return Boolean((message?.embeds || []).some((embed) => String(embed?.footer?.text || '').includes(marker)));
}

async function fetchGuildChannels(guild) {
  const fetched = await guild.channels.fetch();
  return fetched?.values ? [...fetched.values()].filter(Boolean) : [...(fetched || [])].map((entry) => entry?.[1]).filter(Boolean);
}

async function resolvePatchNotesChannel(guild, configuredChannelId = '') {
  const configured = String(configuredChannelId || '').trim();
  if (configured) {
    const channel = await guild.channels.fetch(configured).catch(() => null);
    if (channel?.isTextBased?.()) return channel;
  }
  const channels = await fetchGuildChannels(guild);
  return channels.find((channel) => channel?.isTextBased?.() && ['patch-notes', 'patchnotes'].includes(normalizeChannelName(channel.name))) || null;
}

async function recentChannelHasPatchNote(channel, note) {
  if (!channel?.messages?.fetch) return false;
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const values = messages?.values ? [...messages.values()] : [];
  return values.some((message) => messageHasMarker(message, note));
}

class RoadmapPatchNotePublisher {
  constructor({ state, config = {}, logger = console, notes = ROADMAP_PATCH_NOTES } = {}) {
    if (!state) throw new Error('RoadmapPatchNotePublisher requires a state store.');
    this.state = state;
    this.config = config;
    this.logger = logger;
    this.notes = [...notes];
  }

  async publishPending(guild) {
    const result = { posted: [], adopted: [], skipped: [], warnings: [] };
    const channel = await resolvePatchNotesChannel(guild, this.config.discord?.patchNotesChannelId || '');
    if (!channel) {
      result.warnings.push('No #patch-notes channel was found; milestone notes remain pending.');
      this.logger.warn?.('[Nexus Sentinal] roadmap patch notes: no #patch-notes channel found; pending notes were not marked posted.');
      return result;
    }

    for (const note of this.notes) {
      try {
        assertPublicSafePatchNote(note);
        if (this.state.getRoadmapPatchNote(note.key)) {
          result.skipped.push(note.key);
          continue;
        }
        if (await recentChannelHasPatchNote(channel, note)) {
          this.state.setRoadmapPatchNote(note.key, {
            key: note.key,
            section: note.section,
            percent: note.percent,
            channelId: String(channel.id),
            adoptedExistingMessage: true,
            postedAt: new Date().toISOString()
          });
          result.adopted.push(note.key);
          continue;
        }
        const message = await channel.send(patchNotePayload(note));
        this.state.setRoadmapPatchNote(note.key, {
          key: note.key,
          section: note.section,
          percent: note.percent,
          channelId: String(channel.id),
          messageId: String(message.id),
          postedAt: new Date().toISOString()
        });
        result.posted.push(note.key);
        this.logger.log?.(`[Nexus Sentinal] roadmap patch note posted: ${note.key} -> #${channel.name}`);
      } catch (error) {
        const warning = `${note.key}: ${String(error?.message || error)}`;
        result.warnings.push(warning);
        this.logger.error?.(`[Nexus Sentinal] roadmap patch note failed: ${warning}`);
      }
    }
    return result;
  }
}

module.exports = {
  ALLOWED_MILESTONES,
  PUBLIC_DENYLIST,
  ROADMAP_PATCH_NOTES,
  RoadmapPatchNotePublisher,
  assertPublicSafePatchNote,
  messageHasMarker,
  normalizeChannelName,
  patchNoteMarker,
  patchNotePayload,
  recentChannelHasPatchNote,
  resolvePatchNotesChannel
};
