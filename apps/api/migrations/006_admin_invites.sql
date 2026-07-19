-- Admin invites: grant admin/owner by email before (or after) signup.
CREATE TABLE admin_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'owner')),
  invited_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id),
  revoked_at  timestamptz
);

-- Only one live (pending) invite per email.
CREATE UNIQUE INDEX admin_invites_pending_email
  ON admin_invites (lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
