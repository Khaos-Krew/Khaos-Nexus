BEGIN;

CREATE TABLE IF NOT EXISTS sentinel_events (
  event_id uuid PRIMARY KEY,
  source text NOT NULL,
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  subject text,
  severity text,
  correlation_id text,
  idempotency_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS sentinel_events_idempotency_idx
  ON sentinel_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS sentinel_jobs (
  name text PRIMARY KEY,
  owner text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  trigger jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms integer NOT NULL DEFAULT 30000,
  concurrency integer NOT NULL DEFAULT 1,
  retry jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sentinel_job_runs (
  run_id uuid PRIMARY KEY,
  job_name text NOT NULL REFERENCES sentinel_jobs(name) ON DELETE CASCADE,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  attempt integer NOT NULL DEFAULT 1,
  correlation_id text,
  result jsonb,
  error jsonb
);
CREATE INDEX IF NOT EXISTS sentinel_job_runs_job_started_idx
  ON sentinel_job_runs (job_name, started_at DESC);

CREATE TABLE IF NOT EXISTS sentinel_incidents (
  fingerprint text PRIMARY KEY,
  source text NOT NULL,
  code text NOT NULL,
  subject text,
  message text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  recovered_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by text,
  occurrences integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sentinel_incidents_status_seen_idx
  ON sentinel_incidents (status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS sentinel_actions (
  action_id uuid PRIMARY KEY,
  capability text NOT NULL,
  source text NOT NULL,
  actor text,
  subject text,
  destructive boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  idempotency_key text,
  correlation_id text,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS sentinel_actions_idempotency_idx
  ON sentinel_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS sentinel_action_attempts (
  attempt_id bigserial PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES sentinel_actions(action_id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL,
  error jsonb,
  UNIQUE(action_id, attempt)
);

CREATE TABLE IF NOT EXISTS sentinel_approvals (
  approval_id uuid PRIMARY KEY,
  action_id uuid NOT NULL REFERENCES sentinel_actions(action_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by text,
  decision_reason text
);

CREATE TABLE IF NOT EXISTS sentinel_audit_log (
  audit_id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor text,
  action text NOT NULL,
  subject text,
  correlation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS sentinel_audit_log_occurred_idx
  ON sentinel_audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS sentinel_audit_log_action_subject_occurred_idx
  ON sentinel_audit_log (action, subject, occurred_at ASC);

CREATE TABLE IF NOT EXISTS sentinel_policy_versions (
  policy_name text NOT NULL,
  version integer NOT NULL,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  policy jsonb NOT NULL,
  PRIMARY KEY (policy_name, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS sentinel_policy_one_active_idx
  ON sentinel_policy_versions (policy_name)
  WHERE active = true;

COMMIT;