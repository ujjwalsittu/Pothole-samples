-- 005_incentive_rework.sql
-- Submission-platform signup fields, admin-assigned collectors, per-track
-- package payouts, upcoming/active earning states, withdrawal requests,
-- model kinds.

ALTER TABLE users
  ADD COLUMN is_collector boolean NOT NULL DEFAULT false,
  ADD COLUMN organization text,
  ADD COLUMN mobile text,
  ADD COLUMN whatsapp_available boolean NOT NULL DEFAULT false,
  ADD COLUMN signup_lat double precision,
  ADD COLUMN signup_lng double precision,
  ADD COLUMN signup_acc double precision,
  ADD COLUMN device_fingerprint jsonb;

ALTER TABLE users DROP CONSTRAINT users_collector_status_check;
ALTER TABLE users ADD CONSTRAINT users_collector_status_check
  CHECK (collector_status IN ('student', 'professional', 'self', 'owner'));

-- Per-track payouts replace the single payout (existing rows: both = old value).
ALTER TABLE packages
  ADD COLUMN video_payout_inr int,
  ADD COLUMN photo_payout_inr int;
UPDATE packages SET video_payout_inr = payout_inr, photo_payout_inr = payout_inr;
ALTER TABLE packages
  ALTER COLUMN video_payout_inr SET NOT NULL,
  ALTER COLUMN photo_payout_inr SET NOT NULL;
ALTER TABLE packages DROP COLUMN payout_inr;

-- Earning lifecycle: 'upcoming' until the media track's quota completes.
-- Pre-existing earnings were granted under the old immediate rules → active.
ALTER TABLE ledger_entries
  ADD COLUMN earning_state text CHECK (earning_state IN ('upcoming', 'active'));
UPDATE ledger_entries SET earning_state = 'active' WHERE type = 'earning';

CREATE TABLE withdrawal_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_inr    numeric(12, 2) NOT NULL,
  upi_id        text NOT NULL,
  state         text NOT NULL DEFAULT 'requested'
                CHECK (state IN ('requested', 'approved', 'rejected', 'paid')),
  note          text,
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  settlement_id uuid REFERENCES settlements(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_withdrawal_requests_user_id ON withdrawal_requests (user_id);

ALTER TABLE model_releases
  ADD COLUMN kind text NOT NULL DEFAULT 'road-binary'
  CHECK (kind IN ('road-binary', 'ssd-coco'));
