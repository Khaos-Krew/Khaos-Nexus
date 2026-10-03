'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const { findActivity } = require('./activities-static.cjs');
const { snowflake } = require('../config.cjs');
const { appendDisclaimer, applyChrome, postFooter, withAssets } = require('../panels.cjs');
const { clipLine } = require('../style.cjs');
const { packSections } = require('../panels/layout.cjs');

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
  const packed = packSections({
    title,
    description: appendDisclaimer(lines.join('\n'), { maxLines: 4 }),
    sections: [
      { name: 'Activity', lines: [label || 'Fireteam'] },
      { name: 'Time', lines: timeLines.length ? timeLines : ['Not set'] },
      { name: 'Slots', lines: [slots || 'Not set'] },
      { name: 'Roster', lines: members.length ? members.map((id) => `<@${id}>`) : ['Empty'] }
    ]
  });
  const embeds = packed.embeds.map((page, index) => applyChrome(page, {
    client,
    footerText: postFooter(),
    mode: index === 0 ? 'icon' : ''
  }));
  return withAssets({
    content,
    embeds,
    components: post.status === 'open' ? [buttonRow(post)] : [],
    allowedMentions: ping ? { users: members.slice(), parse: [] } : { parse: [] }
  }, null, 'icon');
}

function boardEmbed(posts = []) {
  const lines = (Array.isArray(posts) ? posts : []).map((post) => {
    const label = String(post.activityLabel || findActivity(post.activityKey)?.label || post.activityKey || 'Fireteam').replace(/\s+/g, ' ').trim();
    const unix = Math.floor(Date.parse(post.expiresAt) / 1000);
    const when = Number.isFinite(unix) ? `<t:${unix}:R>` : 'soon';
    const count = Array.isArray(post.members) ? post.members.length : 0;
    return `**${label || 'Fireteam'}** ${count}/${post.slots} • ${when}`;
  });
  if (!lines.length) return { title: '🎮 Fireteam board', description: 'No open fireteams.', fields: [] };
  return packSections({
    title: '🎮 Fireteam board',
    description: 'Open fireteams.',
    sections: [{ name: 'Open fireteams', lines }]
  });
}

const ICON_FILE = 'icon-vanguard.png';

function isIconFile(file) {
  const name = file?.name || file?.filename || '';
  return name === ICON_FILE;
}

function withoutIcon(payload) {
  const next = { ...(payload || {}) };
  if (Array.isArray(next.files)) {
    const files = next.files.filter((file) => !isIconFile(file));
    if (files.length) next.files = files;
    else delete next.files;
  }
  if (Array.isArray(next.attachments)) {
    next.attachments = next.attachments.filter((file) => !isIconFile(file));
  }
  if (Array.isArray(next.embeds)) {
    next.embeds = next.embeds.map((embed) => {
      if (!String(embed?.thumbnail?.url || '').includes(ICON_FILE)) return embed;
      const copy = { ...embed };
      delete copy.thumbnail;
      return copy;
    });
  }
  return next;
}

function canAttachFiles(channel) {
  if (!channel || typeof channel.permissionsFor !== 'function') return true;
  const me = channel.guild?.members?.me || channel.client?.user;
  if (!me) return false;
  let perms = null;
  try {
    perms = channel.permissionsFor(me);
  } catch {
    return false;
  }
  if (!perms || typeof perms.has !== 'function') return false;
  try {
    return Boolean(perms.has(PermissionFlagsBits.AttachFiles));
  } catch {
    return false;
  }
}

function payloadForChannel(payload, channel) {
  return canAttachFiles(channel) ? payload : withoutIcon(payload);
}

async function sendOrEdit(target, method, payload, channel) {
  const first = payloadForChannel(payload, channel);
  try {
    return await target[method](first);
  } catch (error) {
    if (first.files) return target[method](withoutIcon(first));
    throw error;
  }
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
  await sendOrEdit(message, 'edit', withAssets(rendered, message, 'icon'), channel);
  return { updated: true };
}

module.exports = {
  voiceOffer,
  buttonRow,
  renderPost,
  boardEmbed,
  withoutIcon,
  canAttachFiles,
  payloadForChannel,
  sendOrEdit,
  parseLfgButton,
  deliverPost
};
