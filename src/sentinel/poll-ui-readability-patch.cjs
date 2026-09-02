'use strict';

const pollUi = require('./poll-ui.cjs');
const { paragraphs, spacedItems, statRows } = require('./embed-layout.cjs');
const { installNexusGuideExtension } = require('./nexus-guide-extension.cjs');

const INSTALLED = Symbol.for('khaos.nexus.pollUi.readability');

function readableChoiceLine(line = '') {
  const text = String(line || '').trim();
  const match = text.match(/^(\*\*.+?\*\*)\s+—\s+(.+)$/);
  if (!match) return text;
  return `${match[1]}\n${match[2]}`;
}

function readablePollCardFrom(basePayload = {}, poll = {}) {
  const embed = { ...(basePayload.embeds?.[0] || {}) };
  const originalFields = Array.isArray(embed.fields) ? embed.fields : [];
  const byName = new Map(originalFields.map((field) => [String(field.name || ''), field]));
  const detailRows = [];
  const status = byName.get('Status')?.value;
  const profile = byName.get('Profile')?.value;
  const closes = byName.get('Closes')?.value;
  if (status) detailRows.push(['Status', status]);
  if (profile) detailRows.push(['Profile', String(profile).replace(/-/g, ' ')]);
  if (closes) detailRows.push(['Closes', closes]);

  const fields = [];
  if (detailRows.length) fields.push({ name: '🧭 Poll Details', value: statRows(detailRows), inline: false });

  const choices = byName.get('Choices');
  if (choices) {
    const choiceRows = String(choices.value || '').split('\n').map(readableChoiceLine).filter(Boolean);
    fields.push({ name: '🗳️ Choices', value: spacedItems(choiceRows).slice(0, 1024) || 'No choices available.', inline: false });
  }

  const quorum = byName.get('Quorum');
  if (quorum) fields.push({ name: '👥 Quorum', value: String(quorum.value || ''), inline: false });
  const result = byName.get('Result');
  if (result) fields.push({ name: '✅ Result', value: paragraphs(String(result.value || '')), inline: false });

  const passthrough = originalFields.filter((field) => !['Status', 'Profile', 'Closes', 'Choices', 'Quorum', 'Result'].includes(String(field.name || '')));
  fields.push(...passthrough);

  embed.description = paragraphs(
    String(embed.description || 'Vote using the managed controls below.'),
    `**Poll ID**\n${String(poll.id || '').toUpperCase()}`
  ).slice(0, 4096);
  embed.fields = fields.slice(0, 25);
  return { ...basePayload, embeds: [embed, ...(basePayload.embeds || []).slice(1)] };
}

function readablePollStatusText(poll, result = null) {
  const original = pollUi.__nexusOriginalPollStatusText(poll, result);
  const lines = String(original || '').split('\n');
  const question = lines.slice(1).join('\n').trim() || String(poll?.question || '');
  const voterCount = result?.totalVoters ?? Object.keys(poll?.votes || {}).length;
  const closesUnix = Math.floor(Date.parse(poll?.closesAt) / 1000);
  return paragraphs(
    `**${String(poll?.id || '').toUpperCase()}**`,
    statRows([
      ['Status', pollUi.pollStatusLabel(poll?.status)],
      ['Voters', `${voterCount}`],
      ...(Number.isFinite(closesUnix) ? [['Closes', `<t:${closesUnix}:R>`]] : [])
    ]),
    question
  );
}

function installPollUiReadabilityPatch() {
  if (pollUi[INSTALLED]) return pollUi;
  pollUi[INSTALLED] = true;
  pollUi.__nexusOriginalRenderPollCard = pollUi.renderPollCard;
  pollUi.__nexusOriginalPollStatusText = pollUi.pollStatusText;
  pollUi.renderPollCard = function readableRenderPollCard(poll) {
    return readablePollCardFrom(pollUi.__nexusOriginalRenderPollCard(poll), poll);
  };
  pollUi.pollStatusText = readablePollStatusText;
  return pollUi;
}

// entry.cjs loads this patch before bot.cjs. Install the public guide here so
// its Discord command/panel hooks are registered before the client logs in.
installNexusGuideExtension();
installPollUiReadabilityPatch();

module.exports = {
  readableChoiceLine,
  readablePollCardFrom,
  readablePollStatusText,
  installPollUiReadabilityPatch
};
