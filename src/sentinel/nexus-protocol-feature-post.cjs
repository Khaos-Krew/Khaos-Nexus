'use strict';

const { ProtocolStore } = require('./protocol/store.cjs');
const CHANNEL_ID = '1545126905643147264';
const FEATURE_ID = 'protocol-core-registry-v1';
const FEATURE_POST = [
  '**NEXUS PROTOCOL // CORE REGISTRY ONLINE**',
  '',
  'The first Nexus Protocol systems have awakened. Sentinel can now keep a lasting record of your participation across the Protocol network.',
  '',
  '**NOW OPERATIONAL**',
  '• Join active Protocols and view your objective progress.',
  '• Earn **Protocol Score** through qualified, verified participation.',
  '• Track seasonal and lifetime records, completions, and leaderboards.',
  '• Staff can stage events, validate contributions, and record outcomes with an audit trail.',
  '',
  '**ENTER THE NETWORK**',
  'Use **/protocol status** to explore, **/protocol list** to find active runs, and **/protocol stats** to view your record. Link your ARK account with **/ark link** before joining.',
  '',
  '**SIGNALS STILL FORMING**',
  'Game activity is currently verified by staff; automatic tracking is still being built. Dark Zone PvP enrollment remains **CONTAINED** until server-side damage protection is verified.',
  '',
  '*Connection creates evolution. More completed systems will be announced here as they come online.*'
].join('\n');

// A durable reservation is written before contacting Discord. An uncertain send
// stays pending for operator reconciliation; automatic retries cannot duplicate it.
async function postProtocolMilestone(client, { store = new ProtocolStore() } = {}) {
  const key = `feature-post:${CHANNEL_ID}:${FEATURE_ID}`;
  const prior = store.read().receipts.find((r) => r.key === key);
  if (prior?.state === 'published') return { unchanged: true, messageId: prior.messageId };
  if (prior) throw new Error(`Feature post ${FEATURE_ID} has an uncertain previous send; reconcile Discord before retrying`);
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel?.isTextBased?.()) throw new Error('Feature announcement channel is not text-capable');
  const reserved = store.transact('sentinel', `feature.reserve:${FEATURE_ID}`, (state) => {
    if (state.receipts.some((r) => r.key === key)) return false;
    state.receipts.push({ key, state: 'pending', channelId: CHANNEL_ID, featureId: FEATURE_ID, at: Date.now() });
    return true;
  });
  if (!reserved) return { pending: true };
  const message = await channel.send({ content: FEATURE_POST, allowedMentions: { parse: [] } });
  store.transact('sentinel', `feature.publish:${FEATURE_ID}:${message.id}`, (state) => {
    const receipt = state.receipts.find((r) => r.key === key);
    receipt.state = 'published'; receipt.messageId = message.id; receipt.publishedAt = Date.now();
  });
  const verified = await channel.messages.fetch({ message: message.id, force: true });
  if (verified.author.id !== client.user.id || verified.content !== FEATURE_POST) throw new Error(`Feature post verification failed: message=${message.id}`);
  console.log(`[Nexus Protocol] feature post verified feature=${FEATURE_ID} channel=${CHANNEL_ID} message=${message.id}`);
  return { published: true, messageId: message.id };
}
module.exports = { postProtocolMilestone, FEATURE_POST, FEATURE_ID };
