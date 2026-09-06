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
  const originalContent = message.content;
  const isBanner = (embed) => String(embed?.image?.url || '').includes(BANNER_NAME);
  const existing = message.attachments.find((item) => item.name === BANNER_NAME);
  if (isBanner(message.embeds[0])) {
    console.log(`[Nexus Protocol] banner verified unchanged channel=${CHANNEL_ID} message=${MESSAGE_ID}`);
    return { unchanged: true, messageId: MESSAGE_ID };
  }
  const embeds = message.embeds.map((embed) => embed.toJSON());
  embeds[0].image = { url: `attachment://${BANNER_NAME}` };
  const payload = { content: originalContent, embeds, allowedMentions: { parse: [] },
    attachments: [...message.attachments.values()].filter((item) => item.name !== BANNER_NAME).map((item) => ({ id: item.id })),
    files: [{ attachment: path.join(__dirname, 'assets', BANNER_NAME), name: BANNER_NAME }] };
  await message.edit(payload);
  const verified = await channel.messages.fetch({ message: MESSAGE_ID, force: true });
  if (verified.content !== originalContent || !isBanner(verified.embeds[0])) {
    throw new Error(`Protocol announcement verification failed: contentPreserved=${verified.content === originalContent} image=${verified.embeds[0]?.image?.url || 'missing'} attachments=${[...verified.attachments.values()].map((a) => a.name).join(',')}`);
  }
  console.log(`[Nexus Protocol] banner verified channel=${CHANNEL_ID} message=${MESSAGE_ID}`);
  return { updated: true, messageId: MESSAGE_ID };
}

async function updateProtocolMilestone(client) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const message = await channel.messages.fetch(MESSAGE_ID);
  if (message.author.id !== client.user.id || !message.embeds.length) throw new Error('Protocol announcement is not editable');
  const name = 'NEXUS SYSTEM EVOLUTION // PARTIAL ACTIVATION';
  const value = '**CORE REGISTRY — ONLINE**\nSix Protocol definitions forged. Participation, verified activity, Protocol Score, seasonal/lifetime records and audit persistence are operational.\n\n**SENTINEL INTERFACE — ONLINE**\nUse /protocol status to access the network. Staff can stage events and validate evidence.\n\n**TELEMETRY — STAGING**\nAutomatic in-game objective detection awaits adapters.\n\n**DARK ZONE — CONTAINED**\nConsent and cooldown policy calibrated. Live PvP enrollment remains offline until game-side damage protection is verified.';
  const embeds = message.embeds.map((e) => e.toJSON());
  const fields = embeds[0].fields || [];
  if (fields.some((f) => f.name === name && f.value === value)) return;
  embeds[0].fields = [...fields.filter((f) => !f.name.startsWith('NEXUS SYSTEM EVOLUTION //')), { name, value }];
  if (embeds[0].fields.length > 25) throw new Error('Protocol milestone exceeds embed field limit');
  await message.edit({ embeds, allowedMentions: { parse: [] } });
  const verified = await channel.messages.fetch({ message: MESSAGE_ID, force: true });
  if (!verified.embeds[0]?.fields?.some((f) => f.name === name && f.value === value)) throw new Error('Protocol milestone verification failed');
  console.log(`[Nexus Protocol] milestone verified channel=${CHANNEL_ID} message=${MESSAGE_ID}`);
}
module.exports = { updateProtocolAnnouncement, updateProtocolMilestone };
