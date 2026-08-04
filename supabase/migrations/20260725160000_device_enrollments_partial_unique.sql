-- device_enrollments had a plain UNIQUE(device_serial, device_user_id)
-- constraint (created directly in Supabase Studio, not in a tracked
-- migration — same as the table itself, see 20260707000001). Because it's
-- not scoped to active rows, once a member is enrolled then removed
-- (soft-deleted via deleted_at), that device_serial+device_user_id pair is
-- permanently blocked from ever being reused — even by the same member
-- re-enrolling — which breaks the "Remove" action on the member profile.
--
-- Replace it with a partial unique index scoped to active rows only,
-- matching the pattern already used for trainer_member_commissions.

ALTER TABLE device_enrollments
  DROP CONSTRAINT IF EXISTS device_enrollments_device_serial_device_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS device_enrollments_serial_uid_active_key
  ON device_enrollments(device_serial, device_user_id)
  WHERE deleted_at IS NULL;
