'use strict';

const { arnFlags } = require('../shared/arn-flags.cjs');

function tokenText(balance, env = process.env) {
  const flags = arnFlags(env);
  const lines = [
    `ARN tokens: ${Number(balance || 0)}.`,
    'Taming a shiny has a 25% chance to earn 1 token. Defeating one has a 10% chance.',
    'The cap is 3 tokens a day and 10 a week, Central time.',
    'Your in-game name has to match one linked ARK account exactly.',
    'A held account does not earn tokens, and missed chances are not paid later.',
    'Tokens are not Points, Coins, or the old cache currency.'
  ];
  if (!flags.creditsEnabled) lines.push('Nothing is being paid out yet.');
  return lines.join('\n');
}

function openText(result = {}) {
  if (result.debited === true && result.drawn && result.raCalled === true) {
    return `Opened an ARN cache. The tame is ${result.drawn.species}, level ${result.drawn.level}.`;
  }
  const names = (result.rotation?.entries || []).map((entry) => entry.name).join(', ');
  return [
    'Opening an ARN cache costs 1 token and draws one tame from a list of 8.',
    names ? `This week: ${names}.` : 'This week\'s list is not available.',
    'The list changes every Monday at 12:00 AM Central time.',
    'Nothing was opened and no tame was sent.'
  ].join('\n');
}

function copyHasBotName(value) {
  return /sentinal|sentinel|cephalon/i.test(String(value || ''));
}

module.exports = { tokenText, openText, copyHasBotName };
