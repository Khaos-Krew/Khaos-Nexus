'use strict';

function required(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

class SupabaseNexusSpinStore {
  constructor(options = {}) {
    this.url = required(options.url || process.env.SUPABASE_URL, 'SUPABASE_URL').replace(/\/+$/, '');
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
      const error = new Error(`Nexus Spin datastore request failed (${response.status}).`);
      error.status = response.status;
      error.details = body;
      throw error;
    }
    return body;
  }

  async resolveVerifiedLink(discordId) {
    const id = encodeURIComponent(String(discordId || '').trim());
    const rows = await this.request(`/rest/v1/ark_account_links?discord_id=eq.${id}&verified=eq.true&select=discord_id,eos_id,player_name,verified&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    return row ? { discordId: row.discord_id, eosId: row.eos_id, playerName: row.player_name || null, verified: true } : null;
  }

  async createSpinIfCooldownReady(spin, cooldownSeconds) {
    const reward = spin.reward;
    const rows = await this.request('/rest/v1/rpc/create_nexus_spin_attempt', {
      method: 'POST',
      body: JSON.stringify({
        p_spin_id: spin.spinId,
        p_discord_id: spin.discordId,
        p_eos_id: spin.eosId,
        p_reward_type: reward.type,
        p_reward_key: reward.id,
        p_reward_label: reward.label,
        p_resource_key: reward.resourceKey || null,
        p_amount: reward.amount || null,
        p_tier: reward.tier || 'COMMON',
        p_weight: reward.weight,
        p_created_at: spin.createdAt,
        p_cooldown_seconds: Math.max(1, Math.ceil(Number(cooldownSeconds) || 86400)),
      }),
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) throw new Error('Nexus Spin create RPC returned no result.');
    return {
      allowed: Boolean(row.allowed),
      retryAfterSeconds: Math.max(0, Number(row.retry_after_seconds) || 0),
      nextAllowedAt: row.next_allowed_at || null,
      spinId: row.spin_id || null,
    };
  }

  async createPaidSpin(spin, cost, payment = {}) {
    const reward = spin.reward;
    const amount = Number(cost);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('Paid Nexus Spin cost must be a positive integer.');
    const rows = await this.request('/rest/v1/nexus_spin_attempts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        spin_id: spin.spinId,
        discord_id: spin.discordId,
        eos_id: spin.eosId,
        spin_source: 'POINTS',
        spin_cost: amount,
        reward_type: reward.type,
        reward_key: reward.id,
        reward_label: reward.label,
        resource_key: reward.resourceKey || null,
        amount: reward.amount || null,
        tier: reward.tier || 'COMMON',
        weight: reward.weight,
        status: 'ROLLED',
        reward_metadata: { payment },
        created_at: spin.createdAt,
      }),
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async createPaymentReview({ spin, cost, error }) {
    const rows = await this.request('/rest/v1/nexus_spin_payment_reviews', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        spin_id: spin.spinId,
        discord_id: spin.discordId,
        eos_id: spin.eosId,
        point_cost: Number(cost),
        status: 'OPEN',
        error_code: String(error?.code || 'UNKNOWN'),
        error_message: String(error?.message || 'Unknown point debit state').slice(0, 2000),
        diagnostic: {
          before: error?.before ?? null,
          after: error?.after ?? null,
          expected: error?.expected ?? null,
        },
        created_at: spin.createdAt,
      }),
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async setStatus(spinId, expected, next, metadata = {}) {
    const id = encodeURIComponent(String(spinId));
    const rows = await this.request(`/rest/v1/nexus_spin_attempts?spin_id=eq.${id}&status=eq.${encodeURIComponent(expected)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: next,
        reward_metadata: metadata,
        rewarded_at: next === 'REWARDED' ? new Date().toISOString() : null,
      }),
    });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async createCacheToken(spin) {
    const rows = await this.request('/rest/v1/ark_cache_tokens', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        discord_id: spin.discordId,
        eos_id: spin.eosId,
        source_spin_id: spin.spinId,
        token_type: 'DINO_CACHE',
        status: 'ACTIVE',
      }),
    });
    return Array.isArray(rows) ? rows[0] : rows;
  }

  async listPending(discordId, limit = 20) {
    const id = encodeURIComponent(String(discordId || '').trim());
    const statuses = encodeURIComponent('(PENDING_RESOURCE,PENDING_POINTS,PENDING_TOKEN)');
    const rows = await this.request(`/rest/v1/nexus_spin_attempts?discord_id=eq.${id}&status=in.${statuses}&order=created_at.asc&limit=${Math.max(1, Math.min(50, Number(limit) || 20))}&select=*`);
    return Array.isArray(rows) ? rows : [];
  }

  async lockPending(spinId, expectedStatus) {
    const rows = await this.request('/rest/v1/rpc/lock_nexus_spin_reward', {
      method: 'POST',
      body: JSON.stringify({ p_spin_id: String(spinId), p_expected_status: String(expectedStatus) }),
    });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
}

module.exports = { SupabaseNexusSpinStore };
