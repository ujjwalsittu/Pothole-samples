-- 003_growth_ops.sql
-- Packages CRUD/auto-enroll, campaigns, push tokens, audit log, dataset
-- export versioning, two-admin settlements, map-matching corrections,
-- campaign boosts on samples.

ALTER TABLE packages
  ADD COLUMN active boolean NOT NULL DEFAULT true,
  ADD COLUMN next_package_code text;

CREATE TABLE campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  polygon     jsonb NOT NULL,
  boost       numeric(6, 2) NOT NULL DEFAULT 1.5,
  active      boolean NOT NULL DEFAULT true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_tokens (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text PRIMARY KEY,
  platform   text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_created_at ON audit_log (created_at DESC);

CREATE TABLE dataset_exports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by       uuid REFERENCES users(id),
  bundle_sha256    text,
  sample_count     int NOT NULL DEFAULT 0,
  annotation_count int NOT NULL DEFAULT 0,
  label_counts     jsonb NOT NULL DEFAULT '{}'::jsonb,
  split_counts     jsonb NOT NULL DEFAULT '{}'::jsonb,
  samples          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE settlements
  ADD COLUMN confirm_state text
    CHECK (confirm_state IN ('awaiting_confirmation', 'confirmed', 'cancelled')),
  ADD COLUMN initiated_by uuid REFERENCES users(id),
  ADD COLUMN confirmed_by uuid REFERENCES users(id),
  ADD COLUMN confirmed_at timestamptz;

ALTER TABLE annotations
  ADD COLUMN corrected_lat double precision,
  ADD COLUMN corrected_lng double precision,
  ADD COLUMN correction_source text;

ALTER TABLE samples
  ADD COLUMN boost_applied numeric(6, 2),
  ADD COLUMN campaign_id uuid REFERENCES campaigns(id);
