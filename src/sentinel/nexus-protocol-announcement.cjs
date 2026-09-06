'use strict';

const path = require('node:path');
const CHANNEL_ID = '1545126905643147264';
const MESSAGE_ID = '1546061402979180698';
const BANNER_NAME = 'nexus-protocol-banner.png';

// Reconcile the known message, never delete it or create a replacement.
async function updateProtocolAnnouncement(client) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const message = await channel.messages.fetch(MESSAGE_ID);
  if (message.author.id !== client.user.id) throw new Error('Protocol announcement belongs to another author');
  if (!message.embeds.length) throw new Error('Protocol announcement has no embed to preserve');
  const existing = message.attachments.find((item) => item.name === BANNER_NAME);
  if (existing && message.embeds[0].image?.url === existing.url) return { unchanged: true, messageId: MESSAGE_ID };
  const embeds = message.embeds.map((embed) => embed.toJSON());
  embeds[0].image = { url: `attachment://${BANNER_NAME}` };
  const payload = { embeds, allowedMentions: { parse: [] },
    attachments: [...message.attachments.values()].filter((item) => item.name !== BANNER_NAME).map((item) => ({ id: item.id })),
    files: [{ attachment: path.join(__dirname, 'assets', BANNER_NAME), name: BANNER_NAME }] };
  await message.edit(payload);
  const verified = await channel.messages.fetch({ message: MESSAGE_ID, force: true });
  if (verified.content !== message.content || !verified.attachments.some((item) => item.name === BANNER_NAME) || !verified.embeds[0]?.image) {
    throw new Error('Protocol announcement verification failed');
  }
  console.log(`[Nexus Protocol] banner verified channel=${CHANNEL_ID} message=${MESSAGE_ID}`);
  return { updated: true, messageId: MESSAGE_ID };
}

module.exports = { updateProtocolAnnouncement };
