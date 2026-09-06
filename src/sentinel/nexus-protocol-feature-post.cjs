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
const EVIDENCE_FEATURE = Object.freeze({ id: 'protocol-evidence-gate-v1', content: [
  '**NEXUS PROTOCOL // EVIDENCE GATE CALIBRATED**', '',
  'Sentinel now has a protected intake for verified game evidence—the next piece of the Protocol participation network.', '',
  '**VALIDATION SYSTEMS ONLINE**',
  '• Game evidence must come from an authorized source and match a verified ARK account.',
  '• Map and objective checks keep credit attached to the correct Protocol.',
  '• Duplicate events cannot award extra progress, including after a restart.',
  '• Active-time reports must identify active, living players outside spectator mode.', '',
  '**FIELD LINK — STAGING**',
  'The intake is built and tested. Live game exporters are not connected yet, so participation still uses staff-verified evidence. Display names and chat messages are not treated as proof.', '',
  'Staff can check connection readiness with **/protocol telemetry**.', '',
  '**DARK ZONE — CONTAINED**',
  'PvP enrollment stays offline until game-side damage protection is verified.', '',
  '*The network evolves. Verified actions become lasting records.*'
].join('\n') });

async function postProtocolMilestone(client, { store = new ProtocolStore(), feature = { id: FEATURE_ID, content: FEATURE_POST } } = {}) {
  if (!/^[a-z0-9-]{1,80}$/.test(feature.id) || typeof feature.content !== 'string' || !feature.content.length || feature.content.length > 2000) throw new Error('Invalid feature announcement');
  const key = `feature-post:${CHANNEL_ID}:${feature.id}`;
  const prior = store.read().receipts.find((r) => r.key === key);
  if (prior?.state === 'published') return { unchanged: true, messageId: prior.messageId };
  if (prior) throw new Error(`Feature post ${feature.id} has an uncertain previous send; reconcile Discord before retrying`);
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel?.isTextBased?.()) throw new Error('Feature announcement channel is not text-capable');
  const reserved = store.transact('sentinel', `feature.reserve:${feature.id}`, (state) => {
    if (state.receipts.some((r) => r.key === key)) return false;
    state.receipts.push({ key, state: 'pending', channelId: CHANNEL_ID, featureId: feature.id, at: Date.now() });
    return true;
  });
  if (!reserved) return { pending: true };
  const message = await channel.send({ content: feature.content, allowedMentions: { parse: [] } });
  store.transact('sentinel', `feature.publish:${feature.id}:${message.id}`, (state) => {
    const receipt = state.receipts.find((r) => r.key === key);
    receipt.state = 'published'; receipt.messageId = message.id; receipt.publishedAt = Date.now();
  });
  const verified = await channel.messages.fetch({ message: message.id, force: true });
  if (verified.author.id !== client.user.id || verified.content !== feature.content) throw new Error(`Feature post verification failed: message=${message.id}`);
  console.log(`[Nexus Protocol] feature post verified feature=${feature.id} channel=${CHANNEL_ID} message=${message.id}`);
  return { published: true, messageId: message.id };
}
module.exports = { postProtocolMilestone, FEATURE_POST, FEATURE_ID, EVIDENCE_FEATURE };
