'use strict';

const { escapeMarkdown } = require('discord.js');

const COPY = Object.freeze({
  savedFirst: 'Birthday saved. The first present waits 14 days.',
  savedChange: 'Birthday saved. The next present waits 30 days.',
  locked: 'You can change your birthday again in 60 days.',
  cleared: 'Birthday cleared.',
  noneSaved: 'No birthday is saved.',
  private: 'Your birthday stays private.',
  shown: 'A celebration can be posted if a private message cannot be delivered. The date stays private.',
  choosePrivacy: 'Choose hidden or shown, or whether a celebration can be posted.',
  invalid: 'Use a real month, day, and timezone.',
  off: 'Birthdays are turned off.',
  waiting: 'A birthday present is waiting. Only you can open it.',
  opened: 'You opened your present.',
  already: 'You already opened this present.',
  expired: 'That present has expired.',
  unavailable: "You can't open a birthday present right now.",
  notReady: 'Birthday presents are not available yet.',
  tomorrow: 'Your present will be ready tomorrow.',
  none: 'No birthday present is waiting.',
  channel: 'A birthday present is waiting. It can be opened with /card birthday gift.',
  staff: "A birthday Coin present was deferred to the next day because today's cap was reached."
});

const NO_MENTIONS = Object.freeze({ parse: [] });

function escapePublicName(value) {
  return escapeMarkdown(String(value ?? ''), {
    codeBlock: true,
    inlineCode: true,
    bold: true,
    italic: true,
    underline: true,
    strikethrough: true,
    spoiler: true,
    heading: true,
    bulletedList: true,
    numberedList: true,
    maskedLink: true
  }).replace(/@(everyone|here)/gi, '@\u200b$1').replace(/<@/g, '<\u200b@');
}

function mentionSafe(payload) {
  return { ...payload, allowedMentions: { parse: [] } };
}

function openedCopy(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) return COPY.opened;
  return `You opened your present. ${amount} Nexus Coins were added.`;
}

function channelCopy(displayName, secrets = []) {
  const name = escapePublicName(displayName || 'A member');
  let content = `A birthday present is waiting for ${name}. They can open it with /card birthday gift.`;
  for (const secret of secrets) {
    const hidden = String(secret || '');
    if (hidden.length >= 3 && content.includes(hidden)) return COPY.channel;
  }
  return content;
}

module.exports = {
  COPY,
  NO_MENTIONS,
  escapePublicName,
  mentionSafe,
  openedCopy,
  channelCopy
};
