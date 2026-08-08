'use strict';

const core = require('./dnd-group-core.cjs');
const { runtime } = core;

function queueDelivery(state, input = {}) {
  core.ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const session = core.groupSessionById(state, input.sessionId);
  if (!session) runtime.fail('Group session not found.', 'DND_GROUP_SESSION_NOT_FOUND');
  const clientDeliveryId = runtime.clean(input.clientDeliveryId, 160);
  if (clientDeliveryId) {
    const duplicate = state.groupDeliveries.find((item) => item.sessionId === session.id && item.clientDeliveryId === clientDeliveryId);
    if (duplicate) return { delivery: runtime.clone(duplicate), duplicate: true };
  }
  const audience = ['party', 'selected_seats', 'dm_only'].includes(input.audience) ? input.audience : 'party';
  const selectedSeatIds = [...new Set((input.selectedSeatIds || []).map((item) => runtime.clean(item, 100)).filter(Boolean))];
  if (audience === 'selected_seats' && (!selectedSeatIds.length || selectedSeatIds.some((seatId) => !session.participants.some((item) => item.seatId === seatId)))) {
    runtime.fail('Selected delivery seats must be session participants.', 'DND_GROUP_DELIVERY_AUDIENCE_INVALID');
  }
  const delivery = {
    id: runtime.makeId('group_delivery'), clientDeliveryId, campaignId: session.campaignId, sessionId: session.id,
    roundId: runtime.clean(input.roundId, 100), type: runtime.clean(input.type || 'narration', 80),
    audience, selectedSeatIds, content: runtime.clean(input.content, 12000),
    status: 'review', automatic: false, discordPublished: false, releaseAuthorized: false,
    createdBy: runtime.clean(input.createdBy || 'runtime', 100), createdAt: runtime.nowIso(), reviewedAt: '', discardedAt: ''
  };
  if (!delivery.content) runtime.fail('Delivery content is required.', 'DND_GROUP_DELIVERY_CONTENT_REQUIRED');
  state.groupDeliveries.push(delivery);
  return { delivery: runtime.clone(delivery), duplicate: false };
}

function reviewDelivery(state, input = {}) {
  core.ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const delivery = state.groupDeliveries.find((item) => item.id === input.deliveryId);
  if (!delivery || !['review', 'approved'].includes(delivery.status)) runtime.fail('Reviewable group delivery not found.', 'DND_GROUP_DELIVERY_NOT_FOUND');
  if (input.action === 'discard') {
    delivery.status = 'discarded';
    delivery.discardedAt = runtime.nowIso();
  } else {
    delivery.status = 'approved';
    delivery.reviewedAt = runtime.nowIso();
  }
  delivery.automatic = false;
  delivery.discordPublished = false;
  delivery.releaseAuthorized = false;
  return runtime.clone(delivery);
}

function createPrivateRecaps(state, input = {}) {
  core.ensureGroupState(state);
  runtime.assertOwnerPreview(state);
  const session = core.groupSessionById(state, input.sessionId);
  if (!session) runtime.fail('Group session not found.', 'DND_GROUP_SESSION_NOT_FOUND');
  const deliveries = [];
  for (const recap of input.recaps || []) {
    const seatId = runtime.clean(recap.seatId, 100);
    if (!session.participants.some((item) => item.seatId === seatId)) runtime.fail('Recap seat is not a participant.', 'DND_GROUP_RECAP_SEAT_INVALID');
    deliveries.push(queueDelivery(state, {
      sessionId: session.id, roundId: input.roundId, type: 'private_recap', audience: 'selected_seats',
      selectedSeatIds: [seatId], content: recap.content,
      clientDeliveryId: runtime.clean(recap.clientDeliveryId, 160), createdBy: input.createdBy || 'runtime'
    }).delivery);
  }
  return deliveries;
}

module.exports = { queueDelivery, reviewDelivery, createPrivateRecaps };
