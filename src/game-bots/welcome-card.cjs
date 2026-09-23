'use strict';

function welcomeCard(bot) {
  if (bot === 'ascended') {
    return {
      title: 'Welcome to Nexus Ascended',
      description: 'This bot runs ARK commands in the ARK Ascended category. Wallet, verify, and ranks stay on Nexus Sentinal.',
      fields: [
        { name: 'Start here', value: '`/nexushelp` lists this bot’s commands.\n`/rates` shows the tribe rate card.\n`/welcome` shows this card again.', inline: false },
        { name: 'Nexus Sentinal', value: 'Use `/bal` for your wallet, `/o9verify` to verify, and Sentinal for ranks. Those are not ARK RCON commands.', inline: false }
      ]
    };
  }
  return {
    title: 'Welcome to Cephalon Nexus',
    description: 'This bot runs Warframe commands in the Warframe category. Wallet, verify, and ranks stay on Nexus Sentinal.',
    fields: [
      { name: 'Start here', value: '`/nexushelp` lists this bot’s commands.\n`/worldstate` shows cycles.\n`/market` is a price snapshot, not a trade.', inline: false },
      { name: 'Nexus Sentinal', value: 'Use `/bal` for your wallet, `/o9verify` to verify, and Sentinal for ranks. Cosmetic roles from `/cosmetic` do not change those ranks.', inline: false }
    ]
  };
}

function welcomeText(bot) {
  const card = welcomeCard(bot);
  return [`**${card.title}**`, card.description, ...card.fields.map((field) => `**${field.name}**\n${field.value}`)].join('\n\n').slice(0, 1800);
}

module.exports = { welcomeCard, welcomeText };
