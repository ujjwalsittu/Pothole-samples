-- 002_annotation_review.sql
-- Per-annotation review status + author, partial sample acceptance, and
-- pluggable media storage driver.

ALTER TABLE annotations
  ADD COLUMN status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  ADD COLUMN created_by text NOT NULL DEFAULT 'collector'
    CHECK (created_by IN ('collector', 'admin'));

ALTER TABLE samples DROP CONSTRAINT samples_state_check;
ALTER TABLE samples ADD CONSTRAINT samples_state_check
  CHECK (state IN ('draft', 'uploading', 'uploaded', 'auto_rejected',
                   'pending_review', 'accepted', 'partially_accepted', 'rejected'));

ALTER TABLE samples
  ADD COLUMN storage_driver text NOT NULL DEFAULT 'local'
    CHECK (storage_driver IN ('local', 's3'));
