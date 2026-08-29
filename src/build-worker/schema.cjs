'use strict';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS nexus_worker_nodes (
  node_id text PRIMARY KEY,
  lane text NOT NULL,
  capabilities text[] NOT NULL,
  status text NOT NULL,
  active_job_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS nexus_releases (
  release_id text PRIMARY KEY,
  target text NOT NULL,
  artifact_type text NOT NULL,
  commit_sha text NOT NULL,
  build_status text NOT NULL DEFAULT 'pending',
  test_status text NOT NULL DEFAULT 'pending',
  validation_status text NOT NULL DEFAULT 'pending',
  approval_status text NOT NULL DEFAULT 'pending',
  deployment_status text NOT NULL DEFAULT 'not_requested',
  deployed_by text,
  deployed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nexus_build_jobs (
  job_id text PRIMARY KEY,
  release_id text REFERENCES nexus_releases(release_id) ON DELETE SET NULL,
  stage text NOT NULL CHECK (stage IN ('build', 'test', 'validation', 'deploy')),
  lane text NOT NULL DEFAULT 'general' CHECK (lane IN ('forge', 'ark', 'general')),
  repository text NOT NULL,
  git_ref text NOT NULL,
  commit_sha text,
  artifact_type text NOT NULL DEFAULT 'GENERAL',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'running', 'passed', 'failed', 'blocked', 'cancelled')),
  priority integer NOT NULL DEFAULT 100,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  leased_by text REFERENCES nexus_worker_nodes(node_id) ON DELETE SET NULL,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nexus_build_jobs_lease_idx
  ON nexus_build_jobs (status, stage, lane, priority, created_at);

CREATE TABLE IF NOT EXISTS nexus_production_locks (
  lock_name text PRIMARY KEY,
  release_id text NOT NULL,
  node_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);
`;

module.exports = { SCHEMA_SQL };
