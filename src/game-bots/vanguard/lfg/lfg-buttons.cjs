'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { findActivity } = require('./activities-static.cjs');
const { snowflake } = require('../config.cjs');
const { appendDisclaimer, applyChrome, postFooter, withAssets } = require('../panels.cjs');
const { boundedLines, clipLine } = require('../style.cjs');

function voiceOffer(lobbyId) {
  if (snowflake(lobbyId)) return `Fireteam is full. Join <#${lobbyId}> and a voice channel will open.`;
  return 'Fireteam is full. A voice lobby is not configured yet.';
}

function buttonRow(post) {
  const full = (post.members || []).length >= post.slots;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vanguard:lfg:join:${post.id}`)
      .setLabel('Join')
      .setStyle(ButtonStyle.Success)
      .setDisabled(full),
    new ButtonBuilder()
      .setCustomId(`vanguard:lfg:leave:${post.id}`)
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`vanguard:lfg:close:${post.id}`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger)
  );
}

function renderPost(post, { lobbyId = '', ping = false, client = null } = {}) {
  const activity = findActivity(post.activityKey);
  const label = post.activityLabel || activity?.label || 'Fireteam';
  const members = Array.isArray(post.members) ? post.members : [];
  const unix = Math.floor(Date.parse(post.expiresAt) / 1000);
  let title = '🎮 Fireteam';
  let slots = `${members.length}/${post.slots}`;
  if (post.status === 'closed') {
    title = '🔒 Fireteam closed';
    slots = 'Closed';
  } else if (post.status === 'expired') {
    title = '⏰ Fireteam expired';
    slots = 'Expired';
  } else if (post.voiceOffered || members.length >= post.slots) {
    slots = `Full ${members.length}/${post.slots}`;
  }
  const offered = Boolean(post.voiceOffered || (post.status === 'open' && members.length >= post.slots));
  const timeLines = [];
  if (post.when) timeLines.push(clipLine(post.when, 60));
  if (Number.isFinite(unix)) timeLines.push(`<t:${unix}:R>`);
  const lines = [];
  if (post.note) lines.push(clipLine(post.note, 200));
  if (offered) lines.push(voiceOffer(lobbyId || post.voiceId));
  const content = offered
    ? `${members.map((id) => `<@${id}>`).join(' ')}\n${voiceOffer(lobbyId || post.voiceId)}`.slice(0, 1800)
    : '';
  const embed = applyChrome({
    title,
    description: appendDisclaimer(lines.join('\n'), { maxLines: 4 }),
    fields: [
      { name: 'Activity', value: clipLine(label, 60) || 'Fireteam', inline: true },
      { name: 'Time', value: timeLines.join('\n') || 'Not set', inline: true },
      { name: 'Slots', value: clipLine(slots, 60), inline: true },
      { name: 'Roster', value: boundedLines(members.length ? members.map((id) => `<@${id}>`) : ['Empty']).join('\n'), inline: false }
    ]
  }, { client, footerText: postFooter(), mode: 'icon' });
  return withAssets({
    content,
    embeds: [embed],
    components: post.status === 'open' ? [buttonRow(post)] : [],
    allowedMentions: ping ? { users: members.slice(), parse: [] } : { parse: [] }
  }, null, 'icon');
}

function boardEmbed(posts = []) {
  const lines = posts.map((post) => {
    const label = clipLine(post.activityLabel || findActivity(post.activityKey)?.label || post.activityKey, 24);
    const unix = Math.floor(Date.parse(post.expiresAt) / 1000);
    const when = Number.isFinite(unix) ? `<t:${unix}:R>` : 'soon';
    return clipLine(`**${label}** ${post.members.length}/${post.slots} • ${when}`, 60);
  });
  const shown = lines.length > 3 ? [...lines.slice(0, 2), `+${lines.length - 2} more`] : lines;
  return {
    title: '🎮 Fireteam board',
    description: shown.length ? shown.join('\n') : 'No open fireteams.'
  };
}

function parseLfgButton(customId) {
  const match = String(customId || '').match(/^vanguard:lfg:(join|leave|close):([a-f0-9]{8,32})$/);
  if (!match) return null;
  return { action: match[1], postId: match[2] };
}

async function deliverPost(client, post, options = {}) {
  if (!post?.channelId || !post?.messageId || typeof client?.channels?.fetch !== 'function') {
    return { updated: false, reason: 'unlinked' };
  }
  const channel = await client.channels.fetch(post.channelId).catch(() => null);
  if (!channel || typeof channel.messages?.fetch !== 'function') return { updated: false, reason: 'missing' };
  const message = await channel.messages.fetch(post.messageId).catch(() => null);
  if (!message || typeof message.edit !== 'function') return { updated: false, reason: 'missing' };
  const rendered = renderPost(post, { ...options, client });
  await message.edit(withAssets(rendered, message, 'icon'));
  return { updated: true };
}

module.exports = {
  voiceOffer,
  buttonRow,
  renderPost,
  boardEmbed,
  parseLfgButton,
  deliverPost
};
