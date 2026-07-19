-- 004_model_releases.sql
-- OTA distribution of on-device TFLite models + export format tracking.

CREATE TABLE model_releases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version     int NOT NULL UNIQUE,
  filename    text NOT NULL,
  sha256      text NOT NULL,
  size_bytes  bigint NOT NULL,
  notes       text,
  active      boolean NOT NULL DEFAULT false,
  uploaded_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Which label formats a training export was generated with.
ALTER TABLE dataset_exports
  ADD COLUMN formats jsonb NOT NULL DEFAULT '["coco","yolo","voc"]'::jsonb;
