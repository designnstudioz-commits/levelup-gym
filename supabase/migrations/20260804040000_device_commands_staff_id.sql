-- Staff pushes to a device previously left member_id null with no way to
-- attribute the command back to a specific staff member (see push-user
-- route's original comment). This blocked building a real per-device
-- enrollment status view for staff, unlike members which already have one
-- via device_enrollments. Add the missing attribution going forward.
ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS staff_id UUID REFERENCES staff_members(id);

CREATE INDEX IF NOT EXISTS idx_device_commands_staff ON device_commands(staff_id);

-- Historical rows (before this migration) still have staff_id = null and
-- can't be retroactively attributed via a join — the app falls back to
-- matching the command's PIN=<device_user_id> text for those older rows.
