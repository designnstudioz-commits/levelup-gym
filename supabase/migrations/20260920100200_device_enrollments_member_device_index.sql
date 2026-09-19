-- Restore idx_device_enrollments_member_device to production.
--
-- Defined in 20260707000001_backfill_device_enrollments.sql but absent from
-- production — that migration documented a table which already existed
-- (created by hand in Supabase Studio), and the evidence says it was never
-- actually run there, so its index never materialised.
--
-- The index is NOT redundant. The only other index on this table leads with
-- device_serial (device_enrollments_serial_uid_active_key), so it cannot
-- serve a member_id lookup. These call sites all filter on member_id first:
--   src/lib/server/devicePush.ts        pushAccessToAllDevices
--   src/app/api/devices/push-user       member enrolment push
--   src/app/api/devices/delete-user     enrolment removal
--   src/app/dashboard/members/page.tsx  bulk enrol
--
-- At 679 rows the planner may still choose a sequential scan; this is about
-- restoring the intended, reproducible state, not an urgent win.
CREATE INDEX IF NOT EXISTS idx_device_enrollments_member_device
  ON public.device_enrollments USING btree (member_id, device_serial);
