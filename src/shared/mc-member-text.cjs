'use strict';

const { MEMBER_HOLD_MESSAGE } = require('../sentinel/nexus-economy-identity-hold.cjs');

const MESSAGES = Object.freeze({
  'mc-points-disabled': 'Minecraft Points are turned off. Ask a staff member when you can link your account.',
  'mc-shop-disabled': 'The Minecraft shop is turned off. Ask a staff member when it opens in Sentinal.',
  'mc-starter-kit-disabled': 'The free Starter Kit is turned off. Ask a staff member when claims open in Sentinal.',
  'player-offline': 'That player is not on Nexus Craft right now. Join the server, then run `/mc link start` again.',
  'uuid-not-premium': 'That name is not a paid Java account. Use the name you play with on Nexus Craft, then run `/mc link start` again.',
  'mojang-mismatch': 'That name does not match the player who is online. Check the spelling and run `/mc link start` again.',
  'mojang-unavailable': 'Mojang did not answer. Wait a minute, then run `/mc link start` again.',
  'whisper-failed': 'I could not whisper the code in game. Stay online on Nexus Craft and run `/mc link start` again.',
  'rcon-failed': 'The game server did not answer. Nothing was changed. Wait a minute, then try again.',
  'rcon-unparseable': 'I could not read who is online. Nothing was changed. Wait a minute, then run `/mc link start` again.',
  'invalid-player-name': 'Use your in-game name: 3 to 16 letters, numbers, or underscores. Then run `/mc link start` again.',
  'code-expired': 'That code expired. Run `/mc link start` again while you are online in game.',
  'code-mismatch': 'That code does not match the whisper. Check the message in game, or run `/mc link start` for a new code.',
  'code-locked': 'Too many wrong codes. Wait 10 minutes, then run `/mc link start` again.',
  'link-rate-limited': 'That Minecraft account has asked for too many codes this hour. Wait an hour, then run `/mc link start` again.',
  'unlink-cooldown': 'You unlinked recently. You can link again 30 days after that. Check `/mc link status` for the date.',
  'not-linked': 'This Discord account is not linked to Minecraft. Be online in game, then run `/mc link start`.',
  'already-linked': 'This Discord account is already linked. Run `/mc unlink` first. You can link a different account 30 days later.',
  'uuid-taken': 'That Minecraft account is already linked to someone else. Use a different account, or ask them to unlink.',
  'verified-identity-required': 'Your Nexus identity is not verified yet. Finish verification in Sentinal, then run `/mc link start`.',
  'verified-minecraft-link-required': 'Link Minecraft first. Be online in game, run `/mc link start`, then confirm the whispered code.',
  'account-too-new': 'Your Discord account needs to be at least 30 days old. Come back after that and claim the Starter Kit in Sentinal.',
  'tenure-too-short': 'You need 7 days in this Discord first. Come back after that and claim the Starter Kit in Sentinal.',
  'playtime-too-short': 'Play on Nexus Craft for 15 counted minutes, then claim the Starter Kit in Sentinal.',
  'already-claimed': 'The Starter Kit was already claimed for this Discord account or this Minecraft account. It can only be claimed once.',
  'not-eligible': 'This account cannot claim the Starter Kit. Link Minecraft with `/mc link start`, then try again in Sentinal.',
  'economy-worker-unconfigured': 'Minecraft Points are not set up on this bot yet. Ask a staff member to finish setup.',
  'link-status-unavailable': 'I could not check your Minecraft link. Try `/mc link status` again in a minute. If it still fails, ask a staff member.',
  'staff-not-authorized': 'Only a Discord Administrator can refund a Minecraft order, unless staff ids are configured. You cannot refund your own order.',
  'refund-reason-required': 'Add a short reason, then run `/mcadmin refund` again.',
  'order-not-found': 'That Minecraft order was not found. Check the order id and try again.',
  'refund-not-allowed': 'That order cannot be refunded from here. Refunds are for unconfirmed or failed deliveries.',
  'staff-refund-sentinal-only': 'Use `/mcadmin refund` with the order id and a short reason. You cannot refund your own order.',
  'staff-resolve-sentinal-only': 'Mark this order delivered or unconfirmed in Sentinal. This command does not change it.',
  'account-age-unknown': 'I could not read how old this Discord account is. Try the claim again in Sentinal. If it still fails, ask a staff member.',
  'tenure-unknown': 'I could not read when you joined this Discord. Try the claim again in Sentinal. If it still fails, ask a staff member.',
  'insufficient-funds': 'You do not have enough Nexus Points. Earn more by playing, then open the Minecraft shop again.',
  'invalid-qty': 'Choose 1 to 5 bundles, then open the Minecraft shop again.',
  'account-hold': MEMBER_HOLD_MESSAGE,
  'quarantined': MEMBER_HOLD_MESSAGE,
  'mc-schema-unavailable': 'Minecraft Points could not be saved. ARK Points are unchanged. Try again later, or ask a staff member.'
});

function mcMemberText(reason, fallback = 'That did not finish. Try again in a minute. If it still fails, ask a staff member.') {
  return MESSAGES[reason] || fallback;
}

module.exports = { mcMemberText };
