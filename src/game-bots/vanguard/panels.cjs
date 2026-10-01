'use strict';

const { upsertEmbed, embedFooter } = require('../panel-message.cjs');

const BRAND = 'Many Worlds One Nexus';
const DISCLAIMER = 'Not affiliated with or endorsed by Bungie';
const PANEL_VERSION = 'v1';

function panelFooter(panelId) {
  return `${BRAND} • Nexus Vanguard • ${panelId} • ${PANEL_VERSION} • ${DISCLAIMER}`;
}

function postFooter() {
  return `${BRAND} • ${DISCLAIMER}`;
}

function ownsFooter(message, botId, footer) {
  const author = String(message?.author?.id || '');
  if (!botId || author !== String(botId)) return false;
  return embedFooter(message) === footer;
}

async function upsertOwnedPanel(client, { channelId, messageId, panelId, embed, botId } = {}) {
  const footer = panelFooter(panelId);
  const ownerId = String(botId || client?.user?.id || '');
  const body = {
    embeds: [{
      ...(embed || {}),
      footer: { text: footer }
    }],
    allowedMentions: { parse: [] }
  };
  return upsertEmbed(client, channelId, messageId, body, {
    botId: ownerId,
    matches: (message) => ownsFooter(message, ownerId, footer),
    banner: false
  });
}

function degradedEmbed({ title, detail, asOf } = {}) {
  const when = String(asOf || 'unknown');
  const extra = String(detail || 'Last good content is not available yet.');
  return {
    title: title || 'Vanguard • Status',
    description: `Bungie data unavailable (as of ${when}).\n${extra}`.slice(0, 4000)
  };
}

module.exports = {
  BRAND,
  DISCLAIMER,
  PANEL_VERSION,
  panelFooter,
  postFooter,
  ownsFooter,
  upsertOwnedPanel,
  degradedEmbed
};
