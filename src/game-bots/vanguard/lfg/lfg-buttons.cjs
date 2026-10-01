'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { findActivity } = require('./activities-static.cjs');
const { snowflake } = require('../config.cjs');
const { postFooter } = require('../panels.cjs');

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

function renderPost(post, { lobbyId = '', ping = false } = {}) {
  const activity = findActivity(post.activityKey);
  const label = activity?.label || 'Fireteam';
  const members = Array.isArray(post.members) ? post.members : [];
  const roster = members.map((id) => `<@${id}>`).join('\n') || 'Empty';
  const unix = Math.floor(Date.parse(post.expiresAt) / 1000);
  const when = post.when ? `\nWhen: ${post.when}` : '';
  const note = post.note ? `\nNote: ${post.note}` : '';
  let title = `Fireteam • ${label}`;
  let statusLine = `Open · ${members.length}/${post.slots}`;
  if (post.status === 'closed') {
    title = 'Fireteam • Closed';
    statusLine = 'Closed';
  } else if (post.status === 'expired') {
    title = 'Fireteam • Expired';
    statusLine = 'Expired';
  } else if (post.voiceOffered || members.length >= post.slots) {
    statusLine = `Full · ${members.length}/${post.slots}`;
  }
  const offered = Boolean(post.voiceOffered || (post.status === 'open' && members.length >= post.slots));
  const voice = offered ? `\n${voiceOffer(lobbyId || post.voiceId)}` : '';
  const description = `${statusLine}${when}${note}\n\nRoster:\n${roster}${voice}\n\n${Number.isFinite(unix) ? `Expires <t:${unix}:R>` : 'Expires soon'}`.slice(0, 4000);
  const content = offered
    ? `${members.map((id) => `<@${id}>`).join(' ')}\n${voiceOffer(lobbyId || post.voiceId)}`.slice(0, 1800)
    : '';
  return {
    content,
    embeds: [{
      title,
      description,
      footer: { text: postFooter() }
    }],
    components: post.status === 'open' ? [buttonRow(post)] : [],
    allowedMentions: ping ? { users: members.slice(), parse: [] } : { parse: [] }
  };
}

function boardEmbed(posts = []) {
  const lines = posts.slice(0, 20).map((post) => {
    const label = findActivity(post.activityKey)?.label || post.activityKey;
    const unix = Math.floor(Date.parse(post.expiresAt) / 1000);
    const when = Number.isFinite(unix) ? `<t:${unix}:R>` : 'soon';
    return `**${label}** ${post.members.length}/${post.slots} · <@${post.hostId}> · ${when} · \`${post.id}\``;
  });
  if (posts.length > 20) lines.push(`…and ${posts.length - 20} more`);
  return {
    title: 'Vanguard • Fireteam Board',
    description: lines.length ? lines.join('\n').slice(0, 4000) : 'No open fireteams.'
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
  await message.edit(renderPost(post, options));
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
