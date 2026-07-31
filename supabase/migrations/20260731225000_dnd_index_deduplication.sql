-- Keep the intentionally named campaign indexes and remove duplicate generated copies.
drop index if exists public.dnd_campaign_members_dnd_campaign_members_campaign_id_fkey_idx;
drop index if exists public.dnd_campaigns_dnd_campaigns_tenant_id_fkey_idx;
