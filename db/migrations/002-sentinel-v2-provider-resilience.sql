BEGIN;

CREATE TABLE IF NOT EXISTS sentinel_dead_letters (
  dead_letter_id bigserial PRIMARY KEY,
  provider text NOT NULL,
  operation text NOT NULL,
  subject text,
  status text NOT NULL DEFAULT 'quarantined',
  attempts integer NOT NULL DEFAULT 1,
  correlation_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text
);
CREATE INDEX IF NOT EXISTS sentinel_dead_letters_status_provider_failed_idx
  ON sentinel_dead_letters (status, provider, last_failed_at DESC);

COMMIT;
