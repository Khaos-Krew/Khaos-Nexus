'use strict';

function required(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  return text.replace(/\/+$/, '');
}

function rowToPurchase(row = {}) {
  return {
    cacheId: row.cache_id,
    discordId: row.discord_id,
    eosId: row.eos_id,
    cacheType: row.cache_type,
    cacheName: row.cache_name,
    source: row.source,
    cost: Number(row.cost) || 0,
    announce: Boolean(row.announce),
    eligibleMaps: Array.isArray(row.eligible_maps) ? row.eligible_maps : [],
    status: row.status,
    purchasedAt: row.purchased_at,
    reward: {
      speciesId: row.species_id,
      speciesName: row.species_name,
      variant: row.variant,
      blueprintPath: row.blueprint_path,
      level: Number(row.level),
      sex: row.sex,
    },
  };
}

function purchaseToRow(purchase, status = 'ROLLING') {
  return {
    cache_id: purchase.cacheId,
    discord_id: purchase.discordId,
    eos_id: purchase.eosId,
    cache_type: purchase.cacheType,
    cache_name: purchase.cacheName,
    source: purchase.source || 'SHOP',
    cost: purchase.cost || 0,
    species_id: purchase.reward.speciesId,
    species_name: purchase.reward.speciesName,
    variant: purchase.reward.variant,
    blueprint_path: purchase.reward.blueprintPath,
    level: purchase.reward.level,
    sex: purchase.reward.sex,
    announce: Boolean(purchase.announce),
    eligible_maps: Array.isArray(purchase.eligibleMaps) ? purchase.eligibleMaps : [],
    status,
    purchased_at: purchase.purchasedAt,
    purchase_metadata: purchase.metadata || {},
  };
}

class SupabaseDinoCacheStore {
  constructor(options = {}) {
    this.url = required(options.url || process.env.SUPABASE_URL, 'SUPABASE_URL');
    this.key = required(options.key || process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
    this.fetch = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new Error('A fetch implementation is required.');
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.url}${path}`, {
      ...options,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }
    if (!response.ok) {
      const error = new Error(`Supabase dino-cache request failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async createPurchase(purchase) {
    const rows = await this.request('/rest/v1/ark_dino_cache_purchases', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(purchaseToRow(purchase, 'ROLLING')),
    });
    return rowToPurchase(Array.isArray(rows) ? rows[0] : rows);
  }

  async markAwaiting(cacheId) {
    return this.transition(cacheId, 'ROLLING', 'AWAITING_LOGIN');
  }

  async listAwaiting(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const rows = await this.request(`/rest/v1/ark_dino_cache_purchases?status=eq.AWAITING_LOGIN&order=purchased_at.asc&limit=${safeLimit}&select=*`);
    return (Array.isArray(rows) ? rows : []).map(rowToPurchase);
  }

  async lockDelivery(cacheId) {
    const rows = await this.request('/rest/v1/rpc/lock_ark_dino_cache_delivery', {
      method: 'POST',
      body: JSON.stringify({ p_cache_id: cacheId }),
    });
    return Array.isArray(rows) && rows.length ? rowToPurchase(rows[0]) : null;
  }

  async markDelivered(cacheId, details = {}) {
    return this.patchLocked(cacheId, {
      status: 'DELIVERED',
      delivery_map: details.mapName || null,
      delivery_response: details.response == null ? null : String(details.response).slice(0, 8000),
      delivered_at: new Date().toISOString(),
    });
  }

  async markFailed(cacheId, details = {}) {
    return this.patchLocked(cacheId, {
      status: 'DELIVERY_FAILED',
      delivery_map: details.mapName || null,
      delivery_error: String(details.reason || 'Definite pre-send failure').slice(0, 4000),
    });
  }

  async markUnknown(cacheId, details = {}) {
    return this.patchLocked(cacheId, {
      status: 'DELIVERY_UNKNOWN',
      delivery_map: details.mapName || null,
      delivery_error: String(details.reason || 'Delivery result is ambiguous').slice(0, 4000),
      delivery_response: details.response == null ? null : String(details.response).slice(0, 8000),
    });
  }

  async transition(cacheId, expected, next) {
    const id = encodeURIComponent(String(cacheId));
    const rows = await this.request(`/rest/v1/ark_dino_cache_purchases?cache_id=eq.${id}&status=eq.${encodeURIComponent(expected)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: next }),
    });
    return Array.isArray(rows) && rows.length ? rowToPurchase(rows[0]) : null;
  }

  async patchLocked(cacheId, patch) {
    const id = encodeURIComponent(String(cacheId));
    const rows = await this.request(`/rest/v1/ark_dino_cache_purchases?cache_id=eq.${id}&status=eq.DELIVERY_LOCKED`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    return Array.isArray(rows) && rows.length ? rowToPurchase(rows[0]) : null;
  }
}

module.exports = {
  SupabaseDinoCacheStore,
  rowToPurchase,
  purchaseToRow,
};
