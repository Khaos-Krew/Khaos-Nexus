'use strict';

function insufficientNpCopy({ price, balance } = {}) {
  const priceText = Number.isFinite(Number(price)) ? `${Number(price)} NP` : 'this quote';
  const balanceText = Number.isFinite(Number(balance)) ? `${Number(balance)} NP` : 'your current balance';
  return `Not enough Nexus Points. This order needs ${priceText} and the wallet has ${balanceText}. Nothing was charged. Check \`/bal\` on Nexus Sentinal.`;
}

function deliveryStatusCopy(status) {
  const key = String(status || '').toUpperCase();
  if (key === 'PAID_QUEUED') return 'Paid. Waiting for ARK delivery.';
  if (key === 'DELIVERING') return 'ARK delivery is in progress.';
  if (key === 'DELIVERED') return 'ARK delivery is complete.';
  if (key === 'AWAITING_ITEM_REMOVAL') return 'Waiting for ARK to confirm the items were removed. Nexus Points are credited after that confirmation.';
  return 'The order was recorded. Check the status line before you pay again.';
}

function quoteCopy({ action, quote }) {
  const lines = [
    action === 'sell' ? '**Sell quote**' : '**Purchase quote**',
    `**Item:** ${quote.name}`,
    `**Bundles:** ${quote.bundles}`,
    `**Amount:** ${quote.totalQuantity}`,
    `**Price per bundle:** ${quote.unitPrice} NP`,
    `**Total:** ${quote.totalPrice} NP`,
    '',
    'Nothing is charged until you press Confirm.'
  ];
  if (action === 'sell') lines.push('Nexus Points are credited only after ARK confirms the items were removed. Dinos cannot be sold.');
  else lines.push('After you confirm, delivery status stays on this order. Offline players remain queued.');
  return lines.join('\n');
}

function orderCopy({ action, order, balance }) {
  const lines = [
    '**Order confirmed**',
    `**Order:** ${order.orderId}`,
    `**Item:** ${order.quote?.name || 'Item'}`,
    `**Amount:** ${order.quote?.totalQuantity ?? ''}`,
    `**Total:** ${order.quote?.totalPrice ?? ''} NP`,
    `**Delivery:** ${deliveryStatusCopy(order.status)}`
  ];
  if (action === 'buy' && Number.isFinite(Number(balance))) lines.push(`**Wallet balance:** ${balance} NP`);
  lines.push('', 'Wallet and ranks stay on Nexus Sentinal.');
  return lines.filter((line) => line !== '**Amount:** ' && line !== '**Total:**  NP').join('\n');
}

module.exports = { insufficientNpCopy, deliveryStatusCopy, quoteCopy, orderCopy };
