'use strict';

const { SellQuotaStore } = require('./ark-nexus-sell-market.cjs');
const { buildDynamicMarket } = require('./ark-nexus-sell-market-dynamic.cjs');
const { NexusEconomyBridgeClient } = require('./ark-nexus-economy-bridge-client.cjs');

function enabledFromEnv() {
  return String(process.env.NEXUS_ARK_DYNAMIC_SELL_ENABLED || 'false').trim().toLowerCase() === 'true';
}

class ArkNexusSellService {
  constructor({ store, bridge, now = () => Date.now(), enabled = enabledFromEnv } = {}) {
    this.store = store || new SellQuotaStore();
    this.bridge = bridge || new NexusEconomyBridgeClient();
    this.now = now;
    this.enabled = typeof enabled === 'function' ? enabled : () => Boolean(enabled);
  }

  market() {
    const state = this.store.read();
    return buildDynamicMarket({ history: state.history, now: this.now() });
  }

  quote(assetId) {
    const market = this.market();
    const listing = market.listings[String(assetId || '').toLowerCase()];
    if (!listing) return null;
    return {
      assetId: listing.assetId,
      amount: listing.amount,
      payout: listing.price,
      dailyLimit: listing.dailyLimit,
      weeklyLimit: listing.weeklyLimit,
      demandBoosted: listing.demandBoosted,
      dynamicRatio: listing.dynamicRatio,
      periodStart: market.periodStart,
      demandAsset: market.demandAsset
    };
  }

  async health() {
    if (!this.enabled()) return { ok: false, state: 'disabled' };
    const ping = await this.bridge.ping();
    return { ok: ping.ok, state: ping.ok ? 'ready' : 'bridge-unavailable', bridge: ping.response };
  }

  async sell({ eosId, assetId, bundles = 1 } = {}) {
    if (!this.enabled()) return { ok: false, reason: 'disabled' };

    const market = this.market();
    const listing = market.listings[String(assetId || '').toLowerCase()];
    if (!listing) return { ok: false, reason: 'unknown-asset' };

    const reserved = this.store.reserve({ eosId, listing, bundles, now: this.now() });
    if (!reserved.ok) return { ok: false, reason: reserved.reason, usage: reserved.usage, listing };

    const tx = reserved.reservation;
    try {
      const result = await this.bridge.sell({
        eosId,
        blueprint: listing.blueprint,
        amount: tx.amount,
        payout: tx.payout,
        transactionId: tx.id
      });

      if (result.state === 'completed') {
        this.store.finalize(tx.id, 'completed');
        return {
          ok: true,
          transactionId: tx.id,
          assetId: listing.assetId,
          amount: tx.amount,
          payout: tx.payout,
          demandBoosted: listing.demandBoosted,
          dynamicRatio: listing.dynamicRatio,
          duplicate: Boolean(result.duplicate)
        };
      }

      const code = result.code || 'bridge-error';
      if (code === 'not-enough-items' || code === 'player-offline' || (code === 'credit-failed' && result.restored === true)) {
        this.store.finalize(tx.id, 'cancelled', code);
        return { ok: false, reason: code, transactionId: tx.id };
      }

      this.store.finalize(tx.id, 'manual_review', `${code} restored=${result.restored}`);
      return { ok: false, reason: 'manual-review', bridgeCode: code, transactionId: tx.id };
    } catch (error) {
      const ambiguous = error?.code === 'NEXUS_BRIDGE_AMBIGUOUS';
      this.store.finalize(tx.id, ambiguous ? 'manual_review' : 'cancelled', error?.message || error);
      if (ambiguous) return { ok: false, reason: 'manual-review', transactionId: tx.id };
      throw error;
    }
  }
}

module.exports = {
  enabledFromEnv,
  ArkNexusSellService
};
