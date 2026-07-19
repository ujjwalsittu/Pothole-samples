-- 001_init.sql — full schema for the pothole data-collection platform.
-- Matches packages/shared/src/types.ts.

CREATE TABLE packages (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  video_quota int  NOT NULL,
  photo_quota int  NOT NULL,
  payout_inr  int  NOT NULL
);

INSERT INTO packages (code, name, video_quota, photo_quota, payout_inr)
VALUES ('STARTER_1000', 'Starter Package', 10, 20, 1000)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_sub        text NOT NULL UNIQUE,
  email            text NOT NULL,
  full_name        text NOT NULL,
  photo_url        text,
  role             text NOT NULL DEFAULT 'collector'
                   CHECK (role IN ('collector', 'admin', 'owner')),
  collector_status text NOT NULL DEFAULT 'student'
                   CHECK (collector_status IN ('student', 'professional', 'owner')),
  upi_id           text,
  account_state    text NOT NULL DEFAULT 'pending_approval'
                   CHECK (account_state IN ('pending_approval', 'approved', 'rejected', 'suspended')),
  package_code     text NOT NULL DEFAULT 'STARTER_1000' REFERENCES packages(code),
  created_at       timestamptz NOT NULL DEFAULT now(),
  approved_at      timestamptz
);

CREATE TABLE samples (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_type             text NOT NULL CHECK (media_type IN ('photo', 'video')),
  state                  text NOT NULL DEFAULT 'uploading'
                         CHECK (state IN ('draft', 'uploading', 'uploaded', 'auto_rejected',
                                          'pending_review', 'accepted', 'rejected')),
  sha256                 text NOT NULL UNIQUE,
  phash                  text,
  captured_at            timestamptz NOT NULL,
  duration_sec           double precision,
  avg_speed_kmph         double precision,
  max_speed_kmph         double precision,
  lat                    double precision NOT NULL,
  lng                    double precision NOT NULL,
  gps_accuracy_m         double precision NOT NULL,
  mock_location_detected boolean NOT NULL DEFAULT false,
  pothole_count          int NOT NULL DEFAULT 0,
  rejection_reason       text,
  reviewed_by            uuid REFERENCES users(id),
  reviewed_at            timestamptz,
  media_path             text,
  media_mime             text,
  size_bytes             bigint,
  uploaded_bytes         bigint NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_samples_lat_lng ON samples (lat, lng);
CREATE INDEX idx_samples_state   ON samples (state);
CREATE INDEX idx_samples_user_id ON samples (user_id);

CREATE TABLE gps_tracks (
  sample_id          uuid PRIMARY KEY REFERENCES samples(id) ON DELETE CASCADE,
  recording_start_ms bigint NOT NULL,
  points             jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE annotations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id      uuid NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
  label          text NOT NULL,
  polygon        jsonb NOT NULL,
  video_time_sec double precision,
  lat            double precision NOT NULL,
  lng            double precision NOT NULL,
  estimate       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_annotations_sample_id ON annotations (sample_id);

CREATE TABLE settlements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_inr    numeric(12, 2) NOT NULL,
  state         text NOT NULL DEFAULT 'initiated' CHECK (state IN ('initiated', 'settled')),
  settled_by    uuid REFERENCES users(id),
  settled_at    timestamptz,
  proof_path    text,
  utr_reference text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_settlements_user_id ON settlements (user_id);

CREATE TABLE ledger_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('earning', 'settlement')),
  amount_inr    numeric(12, 2) NOT NULL,
  sample_id     uuid REFERENCES samples(id),
  settlement_id uuid REFERENCES settlements(id),
  note          text,
  balance_inr   numeric(12, 2) NOT NULL,
  settled       boolean NOT NULL DEFAULT false,
  settled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ledger_entries_user_id_created_at ON ledger_entries (user_id, created_at);
