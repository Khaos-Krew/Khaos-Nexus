# Veyra — Lore Master

Veyra is the hosted D&D lore / Co-DM service identity for Khaos Nexus.

This Railway wrapper deliberately runs the existing `packages/ai/dnd-ai` engine instead of duplicating its campaign, retrieval, encounter, authentication, or provider logic.

## Railway configuration

Use the repository root as the build context and set the Dockerfile path to:

`services/veyra/Dockerfile`

Health check:

`/health`

The production runtime requires authenticated Supabase mode and the pinned OpenAI launch model enforced by `packages/ai/dnd-ai/src/runtime-config.js`.

Required production variables include:

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `AI_PROVIDER=openai`
- `CAMPAIGN_STORE=supabase`
- `AUTH_REQUIRED=true`
- `CORS_ORIGIN=<approved Nexus origin>`
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-5-mini-2025-08-07`
- `OPENAI_BASE_URL=https://api.openai.com/v1`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`

Railway supplies `PORT` automatically.

Do not use a Supabase service-role key as `SUPABASE_PUBLISHABLE_KEY`; the D&D AI runtime rejects secret/service-role keys for that variable.
