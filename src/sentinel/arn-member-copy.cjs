'use strict';

const { arnFlags } = require('../shared/arn-flags.cjs');

function tokenText(balance, env = process.env) {
  const flags = arnFlags(env);
  const lines = [
    `ARN tokens: ${Number(balance || 0)}.`,
    'ARN tokens are a trial reward for shiny tames and shiny kills.',
    'Taming a shiny has a 25% chance to earn 1 token. Defeating one has a 10% chance.',
    'The cap is 3 tokens a day and 10 a week, Central time.',
    'Your in-game name has to match one linked ARK account exactly.',
    'A held account does not earn tokens, and missed chances are not paid later.',
    'Tokens are not Points, Coins, or the old cache currency.',
    'Redeem a cache in #dino-box-shop.'
  ];
  if (!flags.creditsEnabled) lines.push('Nothing is being paid out yet.');
  return lines.join('\n');
}

function poolNames(rotation) {
  return [...new Set((rotation?.entries || []).map((entry) => entry.name).filter(Boolean))];
}

function poolLine(rotation) {
  const names = poolNames(rotation);
  return names.length ? `This week: ${names.join(', ')}.` : 'This week\'s list is not available.';
}

function trialLine(env = process.env) {
  if (arnFlags(env).creditsEnabled) return '';
  return 'This is a test run. Payouts are off.';
}

function arnShopLines({ balance, rotation, redeemed = false, drawn = null, env = process.env } = {}) {
  const lines = [
    trialLine(env),
    'An ARN cache costs 1 ARN token.',
    'Accepted currency: ARN tokens only.',
    poolLine(rotation),
    'The list changes every Monday at 12:00 AM Central time.',
    `Your ARN tokens: ${Number(balance || 0)}.`
  ];
  if (redeemed && drawn) lines.push(`Redeemed. The tame is ${drawn.species}, level ${drawn.level}.`);
  else if (redeemed) lines.push('Nothing was opened and no tame was sent.');
  else lines.push('Press Redeem to draw one tame from this list.');
  return lines.filter(Boolean).join('\n');
}

function arnShopPublicLines(rotation, env = process.env) {
  return [
    trialLine(env),
    'An ARN cache costs 1 ARN token.',
    'Accepted currency: ARN tokens only.',
    poolLine(rotation),
    'The list changes every Monday at 12:00 AM Central time.',
    'Your ARN token balance is shown when you redeem.',
    'Nothing is sent while payouts are off.'
  ].filter(Boolean).join('\n');
}

function openPointerText() {
  return 'Redeem an ARN cache in #dino-box-shop. Pick ARN Cache. This command does not open one.';
}

function openText(result = {}) {
  if (result.debited === true && result.drawn && result.raCalled === true) {
    return `Opened an ARN cache. The tame is ${result.drawn.species}, level ${result.drawn.level}.`;
  }
  const names = [...new Set((result.rotation?.entries || []).map((entry) => entry.name).filter(Boolean))].join(', ');
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

module.exports = { tokenText, openText, arnShopLines, arnShopPublicLines, openPointerText, copyHasBotName };
